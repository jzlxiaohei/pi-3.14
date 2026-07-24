export type HttpJsonResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number | null; error: string };

export async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpJsonResult> {
  try {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const detail =
        typeof data === "object" && data && "error" in data
          ? JSON.stringify((data as { error: unknown }).error)
          : text.slice(0, 240);
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    return { ok: true, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse Unix seconds or ISO string into epoch ms. */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: values below year ~2001 in ms are treated as seconds.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Best-effort ChatGPT account id from a JWT payload. */
export function accountIdFromJwt(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(base64UrlToUtf8(parts[1]!)) as Record<string, unknown>;
    const authClaim = payload["https://api.openai.com/auth"];
    const candidates = [
      authClaim && typeof authClaim === "object"
        ? (authClaim as Record<string, unknown>).chatgpt_account_id
        : null,
      payload.chatgpt_account_id,
      payload.account_id,
      payload.accountId,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate) return candidate;
    }
  } catch {
    // ignore malformed JWT
  }
  return undefined;
}

function base64UrlToUtf8(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  return binary;
}
