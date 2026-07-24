import {
  accountIdFromJwt,
  asNumber,
  asRecord,
  asString,
  fetchJson,
  toEpochMs,
} from "../http.js";
import type {
  ProviderAuthCredential,
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "../types.js";

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export async function fetchCodexQuota(
  credential: ProviderAuthCredential,
  options: { includeRaw?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = Date.now();
  const accountId = credential.accountId ?? accountIdFromJwt(credential.accessToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const result = await fetchJson(
    WHAM_USAGE_URL,
    { method: "GET", headers },
    options.fetchImpl,
  );

  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return {
        provider: "openai-codex",
        status: "unauthenticated",
        fetchedAt,
        error: result.error,
      };
    }
    return {
      provider: "openai-codex",
      status: "error",
      fetchedAt,
      error: result.error,
      notes: ["Codex WHAM /usage is undocumented and may change."],
    };
  }

  const root = asRecord(result.data);
  if (!root) {
    return {
      provider: "openai-codex",
      status: "unavailable",
      fetchedAt,
      error: "Unexpected WHAM usage payload",
    };
  }

  const rateLimit = asRecord(root.rate_limit);
  const windows: QuotaWindow[] = [];
  const primary = parseWindow(asRecord(rateLimit?.primary_window), "primary", "5h");
  const secondary = parseWindow(asRecord(rateLimit?.secondary_window), "secondary", "7d");
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);

  const creditsRoot = asRecord(root.credits);
  const credits = creditsRoot
    ? {
        limit: null,
        remaining: asNumber(creditsRoot.balance),
        usage: null,
        unlimited: typeof creditsRoot.unlimited === "boolean" ? creditsRoot.unlimited : null,
      }
    : undefined;

  return {
    provider: "openai-codex",
    status: "ok",
    fetchedAt,
    planLabel: asString(root.plan_type),
    windows,
    credits,
    notes: [
      "Undocumented ChatGPT WHAM endpoint — not billing-grade.",
      ...(rateLimit?.limit_reached === true ? ["Rate limit currently reached."] : []),
    ],
    ...(options.includeRaw ? { raw: result.data } : {}),
  };
}

function parseWindow(
  win: Record<string, unknown> | null,
  id: string,
  fallbackLabel: string,
): QuotaWindow | null {
  if (!win) return null;
  const usedPercent = asNumber(win.used_percent);
  const windowSeconds = asNumber(win.limit_window_seconds);
  const resetAtMs =
    toEpochMs(win.reset_at) ??
    (asNumber(win.reset_after_seconds) != null
      ? Date.now() + asNumber(win.reset_after_seconds)! * 1000
      : null);
  const label =
    windowSeconds != null ? labelFromSeconds(windowSeconds) ?? fallbackLabel : fallbackLabel;
  return {
    id,
    label,
    usedPercent,
    resetAtMs,
    windowSeconds,
  };
}

function labelFromSeconds(seconds: number): string | null {
  if (seconds >= 600_000) return `${Math.round(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds)}s`;
}
