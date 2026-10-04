export type GeminiFallbackSuccess = {
  ok: true;
  data: any;
  model: string;
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

function retryable(status: number, detail: string) {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /high demand|overload|temporar|resource[_ ]?exhausted|unavailable|try again|capacity/i.test(detail);
}

function modelCandidates() {
  const preferred = process.env.GEMINI_MODEL?.trim();
  return Array.from(new Set([
    preferred,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash'
  ].filter(Boolean) as string[]));
}

/**
 * Calls Gemini generateContent with automatic retry/fallback.
 * - Preferred/3.8 gets one short retry on temporary load errors.
 * - Then older stable Flash models are tried automatically.
 * - Authentication / malformed-request errors are returned immediately.
 */
export async function generateContentWithFallback(
  apiKey: string,
  body: Record<string, any>
): Promise<GeminiFallbackResult> {
  const models = modelCandidates();
  const tried: string[] = [];
  let lastStatus = 503;
  let lastDetail = 'Gemini 요청에 실패했습니다.';

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    const attempts = modelIndex === 0 ? 2 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      tried.push(model);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store'
        });
      } catch (error: any) {
        lastStatus = 503;
        lastDetail = error?.message || String(error);
        if (attempt < attempts - 1) await sleep(1200);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        return { ok: true, data, model, tried };
      }

      const raw = await res.text();
      const detail = readableError(raw);
      lastStatus = res.status;
      lastDetail = detail;

      // Bad API key, permission issue, invalid request, etc. should not be hidden by fallback attempts.
      if (!retryable(res.status, detail)) {
        return { ok: false, status: res.status, detail, tried };
      }

      if (attempt < attempts - 1) {
        await sleep(1400);
      } else if (modelIndex < models.length - 1) {
        await sleep(500);
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    detail: `Google Gemini 서버가 혼잡합니다. 자동 재시도와 대체 모델까지 시도했지만 처리되지 않았습니다. 잠시 후 다시 시도해 주세요. (${lastDetail})`,
    tried
  };
}
