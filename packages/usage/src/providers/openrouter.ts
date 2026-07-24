import { asNumber, asRecord, asString, fetchJson } from "../http.js";
import type { ProviderAuthCredential, ProviderQuotaSnapshot } from "../types.js";

const KEY_URL = "https://openrouter.ai/api/v1/key";

export async function fetchOpenRouterQuota(
  credential: ProviderAuthCredential,
  options: { includeRaw?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = Date.now();
  const result = await fetchJson(
    KEY_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
      },
    },
    options.fetchImpl,
  );

  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return {
        provider: "openrouter",
        status: "unauthenticated",
        fetchedAt,
        error: result.error,
      };
    }
    return {
      provider: "openrouter",
      status: "error",
      fetchedAt,
      error: result.error,
    };
  }

  const root = asRecord(result.data);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    return {
      provider: "openrouter",
      status: "unavailable",
      fetchedAt,
      error: "Unexpected OpenRouter key payload",
    };
  }

  const limit = asNumber(data.limit);
  const remaining = asNumber(data.limit_remaining);
  const usage = asNumber(data.usage);
  const unlimited = limit == null && remaining == null;
  let usedPercent: number | null = null;
  if (limit != null && limit > 0 && remaining != null) {
    usedPercent = Math.max(0, ((limit - remaining) / limit) * 100);
  }

  return {
    provider: "openrouter",
    status: "ok",
    fetchedAt,
    planLabel: asString(data.label),
    windows: [
      {
        id: "key_limit",
        label: "key",
        usedPercent,
        resetAtMs: null,
        windowSeconds: null,
      },
    ],
    credits: {
      limit,
      remaining,
      usage,
      unlimited,
    },
    notes: [
      "OpenRouter key credit cap (official /api/v1/key). Account balance may differ.",
      data.limit_reset ? `limit_reset=${String(data.limit_reset)}` : undefined,
    ].filter((note): note is string => Boolean(note)),
    ...(options.includeRaw ? { raw: result.data } : {}),
  };
}
