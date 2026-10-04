import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

function stripJsonFence(text: string) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function modelText(data: any) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, candidate } = await req.json();
    if (!apiKey || !candidate) {
      return NextResponse.json({ error: 'API 키와 선택된 쇼츠 구간이 필요합니다.' }, { status: 400 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `당신은 한국 교회 설교 쇼츠 SNS 편집자다. 아래 선택 구간의 의미를 왜곡하지 말고 유튜브 쇼츠/인스타 릴스 게시용 문구를 만든다. 과장, 자극적 신학 단정, 설교자가 하지 않은 말은 금지한다.

선택 구간:
제목: ${candidate.title}
시간: ${candidate.start}초 ~ ${candidate.end}초
후킹: ${candidate.hook}
요약: ${candidate.summary}
선정 이유: ${candidate.reason}

반드시 JSON 객체만 반환한다.
{
  "titleOptions":["제목1","제목2","제목3","제목4","제목5"],
  "description":"2~4문장의 게시글 설명",
  "hashtags":["#설교","#말씀"],
  "thumbnailText":"썸네일에 들어갈 12자 안팎 문구",
  "openingCaption":"영상 첫 2~3초에 띄울 짧은 문구"
}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.45, responseMimeType: 'application/json' }
      })
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return NextResponse.json({ error: 'SNS 문구 생성에 실패했습니다.', detail: detail.slice(0, 700) }, { status: 502 });
    }

    const data = await geminiRes.json();
    const text = modelText(data);
    if (!text) return NextResponse.json({ error: 'Gemini 응답을 읽지 못했습니다.' }, { status: 502 });

    try {
      return NextResponse.json(JSON.parse(stripJsonFence(text)));
    } catch {
      return NextResponse.json({ error: 'SNS 문구 응답 형식을 해석하지 못했습니다.', detail: text.slice(0, 1200) }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: 'SNS 문구 생성 중 오류가 발생했습니다.', detail: error?.message || String(error) }, { status: 500 });
  }
}
