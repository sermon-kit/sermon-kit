import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

function readableError(raw: string) {
  try { return JSON.parse(raw)?.error?.message || raw; } catch { return raw; }
}

function findVoiceKey(data: any): string | null {
  const direct = [data?.key, data?.voice_key, data?.voiceKey, data?.voice?.key, data?.replicated_voice?.key].find((x) => typeof x === 'string' && x.startsWith('voicekey_'));
  if (direct) return direct;
  const stack: any[] = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    for (const value of Object.values(cur)) {
      if (typeof value === 'string' && value.startsWith('voicekey_')) return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const apiKey = String(form.get('apiKey') || '').trim();
    const source = form.get('source');
    const consent = form.get('consent');
    if (!apiKey || !(source instanceof File) || !(consent instanceof File)) {
      return NextResponse.json({ error: 'API 키와 두 개의 음성 녹음이 필요합니다.' }, { status: 400 });
    }
    if (source.size > 4_000_000 || consent.size > 2_000_000) {
      return NextResponse.json({ error: '녹음 파일이 너무 큽니다. 참조 음성은 10~30초로 다시 녹음해 주세요.' }, { status: 413 });
    }

    const sourceB64 = Buffer.from(await source.arrayBuffer()).toString('base64');
    const consentB64 = Buffer.from(await consent.arrayBuffer()).toString('base64');
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/voices', {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store: false,
        voice: {
          model: 'gemini-3.8-flash-tts',
          type: 'replicated',
          replicated: {
            source_audio: { mime_type: 'audio/wav', data: sourceB64 },
            consent_audio: { mime_type: 'audio/wav', data: consentB64 }
          }
        }
      }),
      cache: 'no-store'
    });

    if (!response.ok) {
      const raw = await response.text();
      return NextResponse.json({ error: '내 목소리 복제에 실패했습니다.', detail: readableError(raw).slice(0, 900) }, { status: response.status });
    }
    const data = await response.json();
    const voiceKey = findVoiceKey(data);
    if (!voiceKey) return NextResponse.json({ error: 'Gemini 응답에서 음성 키를 찾지 못했습니다.' }, { status: 502 });
    return NextResponse.json({ voiceKey });
  } catch (error: any) {
    return NextResponse.json({ error: '내 목소리 생성 중 오류가 발생했습니다.', detail: error?.message || String(error) }, { status: 500 });
  }
}
