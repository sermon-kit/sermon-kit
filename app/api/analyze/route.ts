import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { extractYouTubeId } from '@/lib/youtube';

export const runtime = 'nodejs';

type RawCandidate = {
  title: string;
  start: number;
  end: number;
  hook: string;
  reason: string;
  summary: string;
  hookScore: number;
  messageScore: number;
};

function stripJsonFence(text: string) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, youtubeUrl, duration } = await req.json();
    if (!apiKey || !youtubeUrl || !duration) {
      return NextResponse.json({ error: 'API 키, 유튜브 링크, 길이를 모두 입력해 주세요.' }, { status: 400 });
    }

    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) return NextResponse.json({ error: '올바른 YouTube 링크가 아닙니다.' }, { status: 400 });

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript?.length) {
      return NextResponse.json({ error: '이 영상에서 자막/스크립트를 가져오지 못했습니다. 자막이 있는 설교 영상으로 시도해 주세요.' }, { status: 422 });
    }

    const normalized = transcript.map((item: any) => ({
      start: Math.round(Number(item.offset || 0) / 1000),
      duration: Math.max(1, Math.round(Number(item.duration || 0) / 1000)),
      text: String(item.text || '').replace(/\s+/g, ' ').trim()
    }));

    const transcriptText = normalized
      .map((t: any) => `[${t.start}s] ${t.text}`)
      .join('\n')
      .slice(0, 180000);

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `당신은 한국 교회 설교 쇼츠 편집자다. 아래는 한 편의 설교 타임스탬프 자막이다.\n\n목표: ${duration}초 안팎의 쇼츠 후보 5개를 찾는다.\n\n선정 원칙:\n1. 설교자의 원래 의미를 왜곡하지 않는다.\n2. 문맥 없이 자극적으로 잘라내지 않는다.\n3. 시작 3초 안에 관심을 끌 수 있는 문장이 있는 구간을 우선한다.\n4. 한 구간 안에서 문제 제기-핵심 메시지-적용 또는 결론이 최대한 완결되어야 한다.\n5. 성경 본문과 설교 핵심을 우선한다.\n6. 후보끼리 가능한 한 겹치지 않게 한다.\n7. start/end는 반드시 초 단위 숫자로 반환한다. 길이는 목표 ${duration}초에서 ±15초 이내를 우선한다.\n\n반드시 아래 JSON 배열만 반환한다. 마크다운 금지.\n[\n  {\n    "title":"쇼츠 제목",\n    "start":123,\n    "end":181,\n    "hook":"첫 3초에 쓸 핵심 문장",\n    "reason":"선정 이유",\n    "summary":"구간 핵심 요약",\n    "hookScore":5,\n    "messageScore":5\n  }\n]\n\n설교 자막:\n${transcriptText}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json({ error: 'Gemini 호출에 실패했습니다.', detail: errText.slice(0, 500) }, { status: 502 });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return NextResponse.json({ error: 'Gemini 응답을 읽지 못했습니다.' }, { status: 502 });

    let candidates: RawCandidate[];
    try {
      candidates = JSON.parse(stripJsonFence(text));
    } catch {
      return NextResponse.json({ error: 'AI 응답 형식을 해석하지 못했습니다.', detail: text.slice(0, 1200) }, { status: 502 });
    }

    const safe = candidates
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .slice(0, 5)
      .map((c, index) => ({
        id: index + 1,
        ...c,
        start: Math.max(0, Math.floor(c.start)),
        end: Math.max(1, Math.floor(c.end)),
        hookScore: Math.min(5, Math.max(1, Number(c.hookScore || 3))),
        messageScore: Math.min(5, Math.max(1, Number(c.messageScore || 3)))
      }));

    return NextResponse.json({ videoId, transcript: normalized, candidates: safe });
  } catch (error: any) {
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다.', detail: error?.message || String(error) }, { status: 500 });
  }
}
