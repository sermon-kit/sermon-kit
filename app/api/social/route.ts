import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function stripJsonFence(text: string) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, candidate, transcript } = await req.json();
    if (!apiKey || !candidate) {
      return NextResponse.json({ error: 'API 키와 선택된 쇼츠 구간이 필요합니다.' }, { status: 400 });
    }

    const excerpt = Array.isArray(transcript)
      ? transcript
          .filter((x: any) => x.start < candidate.end && (x.start + x.duration) > candidate.start)
          .map((x: any) => x.text)
          .join(' ')
          .slice(0, 12000)
      : '';

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `당신은 한국 교회 설교 쇼츠 SNS 편집자다. 선택된 설교 구간의 의미를 왜곡하지 말고 유튜브 쇼츠/인스타 릴스 게시용 문구를 만든다. 과장, 자극적 신학 단정, 설교자가 하지 않은 말은 금지한다.\n\n선택 구간:\n제목: ${candidate.title}\n후킹: ${candidate.hook}\n요약: ${candidate.summary}\n자막 원문: ${excerpt}\n\n반드시 JSON 객체만 반환한다.\n{\n  "titleOptions":["제목1","제목2","제목3","제목4","제목5"],\n  "description":"2~4문장의 게시글 설명",\n  "hashtags":["#설교","#말씀"],\n  "thumbnailText":"썸네일에 들어갈 12자 안팎 문구",\n  "openingCaption":"영상 첫 2~3초에 띄울 짧은 문구"\n}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, responseMimeType: 'application/json' }
      })
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return NextResponse.json({ error: 'SNS 문구 생성에 실패했습니다.', detail: detail.slice(0, 500) }, { status: 502 });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
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
