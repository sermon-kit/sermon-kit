export type GeminiFallbackSuccess = {
  ok: true;
  data: any;
  model: string;
  mode: 'agentic' | 'static';
  tried: string[];
};

export type GeminiFallbackFailure = {
  ok: false;
  status: number;
  detail: string;
  tried: string[];
};

export type GeminiFallbackResult = GeminiFallbackSuccess | GeminiFallbackFailure;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readableError(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
}

function isTemporary(status: number, detail: string) {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /high demand|overload|temporar|resource[_ ]?exhausted|unavailable|try again|capacity/i.test(detail);
}

function isAgenticUnsupported(detail: string) {
  return /agentic.*(not enabled|not supported|unsupported)|media_processing.*not supported|media processing.*not enabled/i.test(detail);
}

function isModelUnavailable(status: number, detail: string) {
  return status === 404 || /model.*(not found|does not exist|not available|unsupported)/i.test(detail);
}

function agenticModels() {
  const preferred = process.env.GEMINI_MODEL?.trim();
  return Array.from(new Set([
    preferred,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter(Boolean) as string[]));
}

function staticModels() {
  // Static video processing works across Gemini video-capable models.
  // Keep the newest Flash models first for quality and speed.
  return Array.from(new Set([
    process.env.GEMINI_MODEL?.trim(),
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter(Boolean) as string[]));
}

function asStaticBody(body: Record<string, any>) {
  // Deep clone so the caller's body is not mutated.
  const cloned = JSON.parse(JSON.stringify(body));
  const contents = Array.isArray(cloned?.contents) ? cloned.contents : [];
  for (const content of contents) {
    if (!Array.isArray(content?.parts)) continue;
    for (const part of content.parts) {
      if (part && typeof part === 'object') {
        // Omitting media_processing makes video processing static (default).
        delete part.media_processing;
        delete part.mediaProcessing;
      }
    }
  }
  return cloned;
}

async function callModel(
  apiKey: string,
  model: string,
  body: Record<string, any>
): Promise<{ ok: true; data: any } | { ok: false; status: number; detail: string }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });

    if (res.ok) {
      return { ok: true, data: await res.json() };
    }

    const raw = await res.text();
    return { ok: false, status: res.status, detail: readableError(raw) };
  } catch (error: any) {
    return { ok: false, status: 503, detail: error?.message || String(error) };
  }
}

/**
 * Reliable Gemini video call.
 *
 * 1) Try only models documented to support agentic video.
 * 2) If agentic is unavailable/unsupported or all agentic models are busy,
 *    automatically retry in static video mode (media_processing omitted).
 * 3) Authentication and clearly malformed requests are returned immediately.
 */
export async function generateContentWithFallback(
  apiKey: string,
  body: Record<string, any>
): Promise<GeminiFallbackResult> {
  const tried: string[] = [];
  let lastStatus = 503;
  let lastDetail = 'Gemini 요청에 실패했습니다.';

  // Phase 1: agentic video processing.
  for (let i = 0; i < agenticModels().length; i++) {
    const model = agenticModels()[i];
    const attempts = i === 0 ? 2 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      tried.push(`${model}:agentic`);
      const result = await callModel(apiKey, model, body);
      if (result.ok) {
        return { ok: true, data: result.data, model, mode: 'agentic', tried };
      }

      lastStatus = result.status;
      lastDetail = result.detail;

      // A model can exist but not have agentic enabled for a given account/endpoint.
      // Skip it instead of surfacing that error to the user.
      if (isAgenticUnsupported(result.detail) || isModelUnavailable(result.status, result.detail)) {
        break;
      }

      // Invalid API key / permission / malformed payload: fallback will not fix it.
      if (!isTemporary(result.status, result.detail)) {
        return { ok: false, status: result.status, detail: result.detail, tried };
      }

      if (attempt < attempts - 1) await sleep(1200);
    }

    if (i < agenticModels().length - 1) await sleep(350);
  }

  // Phase 2: static fallback. This is less token-efficient for long videos,
  // but is much more broadly available and keeps the app usable during
  // agentic capacity/availability issues.
  const staticBody = asStaticBody(body);
  for (let i = 0; i < staticModels().length; i++) {
    const model = staticModels()[i];
    tried.push(`${model}:static`);
    const result = await callModel(apiKey, model, staticBody);

    if (result.ok) {
      return { ok: true, data: result.data, model, mode: 'static', tried };
    }

    lastStatus = result.status;
    lastDetail = result.detail;

    if (isModelUnavailable(result.status, result.detail)) continue;

    if (!isTemporary(result.status, result.detail)) {
      return { ok: false, status: result.status, detail: result.detail, tried };
    }

    if (i < staticModels().length - 1) await sleep(350);
  }

  return {
    ok: false,
    status: lastStatus,
    detail: `Gemini가 현재 영상을 처리하지 못했습니다. 에이전트 모드와 일반(Static) 모드를 모두 자동으로 시도했습니다. 잠시 후 다시 시도해 주세요. (${lastDetail})`,
    tried
  };
}
