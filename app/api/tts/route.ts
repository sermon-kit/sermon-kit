import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const ALLOWED_VOICES = new Set(['Gacrux', 'Charon', 'Sulafat', 'Kore', 'Achird', 'Schedar']);

function readableError(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
}

function findAudioData(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const legacy = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
  if (legacy?.inlineData?.data) return legacy.inlineData.data;
  if (legacy?.inline_data?.data) return legacy.inline_data.data;

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const content = Array.isArray(steps[i]?.content) ? steps[i].content : [];
    for (let j = content.length - 1; j >= 0; j--) {
      if (content[j]?.type === 'audio' && content[j]?.data) return content[j].data;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, text, voice = 'Gacrux', style } = await req.json();
    if (!apiKey || !text) {
      return NextResponse.json({ error: 'API 키와 읽을 문장이 필요합니다.' }, { status: 400 });
    }

    const cleanText = String(text).replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      return NextResponse.json({ error: '읽을 문장이 비어 있습니다.' }, { status: 400 });
    }
    if (cleanText.length > 12000) {
      return NextResponse.json({ error: '한 번에 읽을 문장이 너무 깁니다. 12,000자 이내로 줄여 주세요.' }, { status: 400 });
    }

    const selectedVoice = ALLOWED_VOICES.has(String(voice)) ? String(voice) : 'Gacrux';
    const selectedStyle = String(style || '차분하고 따뜻하며 또렷한 한국어 설교 내레이션. 지나치게 연기하지 말고 자연스럽게 읽는다.');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: cleanText,
            speech_metadata: { style: selectedStyle }
          }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { voice: selectedVoice }
          }
        }
      }),
      cache: 'no-store'
    });

    if (!response.ok) {
      const raw = await response.text();
      return NextResponse.json({
        error: 'AI 음성 생성에 실패했습니다.',
        detail: readableError(raw).slice(0, 900)
      }, { status: response.status });
    }

    const data = await response.json();
    const base64 = findAudioData(data);
    if (!base64) {
      return NextResponse.json({ error: 'Gemini 응답에서 음성 데이터를 찾지 못했습니다.' }, { status: 502 });
    }

    const bytes = Buffer.from(base64, 'base64');
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': 'inline; filename="sermon-ai-voice.wav"',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      error: 'AI 음성 생성 중 오류가 발생했습니다.',
      detail: error?.message || String(error)
    }, { status: 500 });
  }
}
