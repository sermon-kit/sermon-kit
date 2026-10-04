import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeId } from '@/lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
    const { apiKey, youtubeUrl, candidate } = await req.json();
    if (!apiKey || !youtubeUrl || !candidate) {
      return NextResponse.json({ error: 'API 키, 유튜브 링크, 선택 구간이 필요합니다.' }, { status: 400 });
    }

    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) return NextResponse.json({ error: '올바른 YouTube 링크가 아닙니다.' }, { status: 400 });

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const start = Math.max(0, Math.floor(Number(candidate.start || 0)));
    const end = Math.max(start + 1, Math.floor(Number(candidate.end || start + 60)));
    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `첨부된 한국어 설교 YouTube 영상에서 ${start}초부터 ${end}초까지만 듣고, 영상 자막용 발화문을 가능한 한 실제 발화 그대로 추출하라.

규칙:
- 요약하거나 문장을 새로 만들지 않는다.
- 명확히 들리는 실제 발화만 기록한다.
- 각 항목 start는 영상 전체 기준 절대 초이다.
- duration은 해당 자막이 화면에 머물 적절한 초 수이다.
- 한 항목의 text는 보통 8~28자 정도로 나눈다.
- 시작/종료 구간 밖의 말은 넣지 않는다.

반드시 JSON 배열만 반환한다.
[
  {"start":123,"duration":2.4,"text":"실제 발화 문장"}
]`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
          temperature: 0.05,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiRes.ok) {
      const raw = await geminiRes.text();
      return NextResponse.json({
        error: '선택 구간 자막을 만들지 못했습니다.',
        detail: geminiErrorMessage(raw).slice(0, 900)
      }, { status: 502 });
    }

    const data = await geminiRes.json();
    const text = modelText(data);
    let captions: any[] = [];
    try {
      const parsed = JSON.parse(stripJsonFence(text));
      captions = Array.isArray(parsed) ? parsed : parsed?.captions;
      if (!Array.isArray(captions)) captions = [];
    } catch {
      return NextResponse.json({ error: '자막 응답 형식을 해석하지 못했습니다.', detail: text.slice(0, 1000) }, { status: 502 });
    }

    const safe = captions
      .map((x) => ({
        start: Number(x.start),
        duration: Math.max(0.8, Number(x.duration || 2)),
        text: String(x.text || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((x) => Number.isFinite(x.start) && x.start >= start - 2 && x.start <= end + 2 && x.text)
      .slice(0, 140);

    return NextResponse.json({ transcript: safe });
  } catch (error: any) {
    return NextResponse.json({ error: '자막 생성 중 오류가 발생했습니다.', detail: error?.message || String(error) }, { status: 500 });
  }
}
