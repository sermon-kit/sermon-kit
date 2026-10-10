import { NextRequest, NextResponse } from 'next/server';
import { extractYouTubeId } from '@/lib/youtube';
import { generateContentWithFallback } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 300;

function stripJsonFence(text: string) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}
function modelText(data: any) {
  return (data?.candidates?.[0]?.content?.parts || []).map((p: any) => typeof p?.text === 'string' ? p.text : '').join('').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, youtubeUrl, candidate, duration = 60 } = await req.json();
    if (!apiKey || !youtubeUrl || !candidate) return NextResponse.json({ error: 'API 키, 영상 주소, 선택 후보가 필요합니다.' }, { status: 400 });
    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) return NextResponse.json({ error: '올바른 YouTube 링크가 아닙니다.' }, { status: 400 });
    const target = Number(duration) || 60;
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const prompt = `당신은 한국어 설교 쇼츠 전문 편집자다. 첨부된 설교 전체와 아래 선택 구간의 앞뒤 문맥을 확인하여, 원문을 단순히 잘라 붙이지 말고 ${target}초 분량의 쇼츠 대본으로 재구성하라.

선택 구간: ${candidate.start}초~${candidate.end}초
현재 후보 제목: ${candidate.title}
현재 핵심: ${candidate.summary}

목표:
- 영상의 핵심 신학과 설교자의 의도를 절대 왜곡하지 않는다.
- 설교에서 실제로 말한 주장과 적용만 사용하고, 새로운 교리나 사실을 만들어내지 않는다.
- 첫 2~3초에 시청자가 멈출 질문/긴장/공감 문장을 둔다.
- 공감 가능한 문제 → 본문/핵심 메시지 → 구체적 적용 또는 결론 순으로 빠르게 전개한다.
- 반복, 인사, 군더더기, 긴 설명은 제거한다.
- 조회수를 보장한다고 말하지 않되, 유튜브 쇼츠에서 유지율이 높아질 가능성이 있는 구조를 우선한다.
- 자극적 낚시 제목, 과장, 설교자가 하지 않은 단정은 금지한다.
- 한국어 음성으로 읽었을 때 약 ${target}초가 되도록 분량을 조절한다.
- captionChunks는 화면 자막용으로 8~28자 정도씩 자연스럽게 끊는다.

반드시 JSON 객체만 반환한다.
{
  "title":"재구성 쇼츠 제목",
  "hook":"첫 2~3초 문구",
  "script":"처음부터 끝까지 읽을 완성 대본",
  "summary":"핵심 한 문장",
  "reason":"이 구조가 시청 유지에 유리한 이유",
  "captionChunks":["자막1","자막2","자막3"]
}`;

    const gemini = await generateContentWithFallback(apiKey, {
      contents: [{ role: 'user', parts: [
        { file_data: { file_uri: canonicalUrl, mime_type: 'video/mp4' }, media_processing: 'AGENTIC' },
        { text: prompt }
      ] }],
      generationConfig: { temperature: 0.45, responseMimeType: 'application/json' }
    });
    if (!gemini.ok) return NextResponse.json({ error: '쇼츠 대본 재구성에 실패했습니다.', detail: gemini.detail.slice(0, 900) }, { status: 502 });
    const text = modelText(gemini.data);
    try {
      const parsed = JSON.parse(stripJsonFence(text));
      return NextResponse.json({
        title: String(parsed.title || candidate.title),
        hook: String(parsed.hook || candidate.hook),
        script: String(parsed.script || '').trim(),
        summary: String(parsed.summary || ''),
        reason: String(parsed.reason || ''),
        captionChunks: Array.isArray(parsed.captionChunks) ? parsed.captionChunks.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 80) : []
      });
    } catch {
      return NextResponse.json({ error: '재구성 결과 형식을 해석하지 못했습니다.', detail: text.slice(0, 1200) }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: '재구성 중 오류가 발생했습니다.', detail: error?.message || String(error) }, { status: 500 });
  }
}
