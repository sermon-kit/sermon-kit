import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeId } from '@/lib/youtube';
import { generateContentWithFallback } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 300;

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

function modelText(data: any) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

function geminiErrorMessage(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, youtubeUrl, duration } = await req.json();
    if (!apiKey || !youtubeUrl || !duration) {
      return NextResponse.json({ error: 'API 키, 유튜브 링크, 길이를 모두 입력해 주세요.' }, { status: 400 });
    }

    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) {
      return NextResponse.json({ error: '올바른 YouTube 링크가 아닙니다.' }, { status: 400 });
    }

    // Vercel에서 YouTube 자막을 직접 긁어오는 방식은 차단/변경에 취약합니다.
    // Gemini의 공식 YouTube URL 입력 기능으로 공개 영상을 직접 분석합니다.
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const prompt = `당신은 한국 교회 설교 쇼츠 편집자다. 첨부된 공개 YouTube 설교 영상을 직접 분석하라.

목표: ${duration}초 안팎의 쇼츠 후보 5개를 찾는다.

선정 원칙:
1. 설교자의 원래 의미를 왜곡하지 않는다.
2. 문맥 없이 자극적으로 잘라내지 않는다.
3. 시작 3초 안에 관심을 끌 수 있는 문장이 있는 구간을 우선한다.
4. 한 구간 안에서 문제 제기-핵심 메시지-적용 또는 결론이 최대한 완결되어야 한다.
5. 성경 본문과 설교 핵심을 우선한다.
6. 후보끼리 가능한 한 겹치지 않게 한다.
7. start/end는 영상 시작부터의 절대 초 단위 숫자다.
8. 각 후보 길이는 목표 ${duration}초에서 ±15초 이내를 우선한다. 단, 의미가 끊기면 최대 ±25초까지 허용한다.
9. 영상의 실제 음성과 타임라인을 근거로 시간을 정한다.

반드시 아래 JSON 배열만 반환한다. 마크다운 금지.
[
  {
    "title":"쇼츠 제목",
    "start":123,
    "end":181,
    "hook":"첫 3초에 쓸 핵심 문장",
    "reason":"선정 이유",
    "summary":"구간 핵심 요약",
    "hookScore":5,
    "messageScore":5
  }
]`;

    const gemini = await generateContentWithFallback(apiKey, {
      contents: [{
        role: 'user',
        parts: [
          {
            file_data: {
              file_uri: canonicalUrl,
              mime_type: 'video/mp4'
            },
            media_processing: 'AGENTIC'
          },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    });

    if (!gemini.ok) {
      return NextResponse.json({
        error: gemini.status === 429 || gemini.status >= 500
          ? 'Gemini 서버가 혼잡해 분석하지 못했습니다.'
          : 'Gemini가 영상을 분석하지 못했습니다.',
        detail: gemini.detail.slice(0, 900)
      }, { status: 502 });
    }

    const data = gemini.data;
    const text = modelText(data);
    if (!text) {
      return NextResponse.json({ error: 'Gemini 응답에서 분석 결과를 읽지 못했습니다.' }, { status: 502 });
    }

    let candidates: RawCandidate[];
    try {
      const parsed = JSON.parse(stripJsonFence(text));
      candidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
      if (!Array.isArray(candidates)) throw new Error('candidate array missing');
    } catch {
      return NextResponse.json({
        error: 'AI 분석 결과 형식을 해석하지 못했습니다.',
        detail: text.slice(0, 1200)
      }, { status: 502 });
    }

    const safe = candidates
      .filter((c) => Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)) && Number(c.end) > Number(c.start))
      .slice(0, 5)
      .map((c, index) => ({
        id: index + 1,
        title: String(c.title || `쇼츠 후보 ${index + 1}`),
        start: Math.max(0, Math.floor(Number(c.start))),
        end: Math.max(1, Math.floor(Number(c.end))),
        hook: String(c.hook || ''),
        reason: String(c.reason || ''),
        summary: String(c.summary || ''),
        hookScore: Math.min(5, Math.max(1, Number(c.hookScore || 3))),
        messageScore: Math.min(5, Math.max(1, Number(c.messageScore || 3)))
      }));

    if (!safe.length) {
      return NextResponse.json({ error: '적절한 쇼츠 구간을 찾지 못했습니다. 다른 영상으로 시도해 주세요.' }, { status: 422 });
    }

    return NextResponse.json({ videoId, transcript: [], candidates: safe });
  } catch (error: any) {
    return NextResponse.json({
      error: '분석 중 오류가 발생했습니다.',
      detail: error?.message || String(error)
    }, { status: 500 });
  }
}
