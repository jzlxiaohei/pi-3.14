import { asNumber, asRecord, fetchJson, toEpochMs } from "../http.js";
import type {
  ProviderAuthCredential,
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "../types.js";

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_UA = "claude-code/2.1.72";

/**
 * Anthropic subscription meters via undocumented OAuth usage endpoint.
 * Requires a Claude Pro/Max OAuth access token (not a plain API key).
 * Sensitive to User-Agent; wrong UA often yields persistent 429.
 */
export async function fetchAnthropicQuota(
  credential: ProviderAuthCredential,
  options: {
    includeRaw?: boolean;
    fetchImpl?: typeof fetch;
    userAgent?: string;
  } = {},
): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = Date.now();
  if (looksLikeApiKey(credential.accessToken)) {
    return {
      provider: "anthropic",
      status: "unauthenticated",
      fetchedAt,
      error: "Anthropic subscription meters require Claude OAuth, not an API key",
      notes: [
        "PI third-party harness usage may bill against extra usage, not plan windows.",
      ],
    };
  }

  const result = await fetchJson(
    OAUTH_USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": options.userAgent ?? DEFAULT_UA,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    options.fetchImpl,
  );

  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return {
        provider: "anthropic",
        status: "unauthenticated",
        fetchedAt,
        error: result.error,
      };
    }
    return {
      provider: "anthropic",
      status: "error",
      fetchedAt,
      error: result.error,
      notes: [
        "Undocumented Anthropic OAuth usage endpoint; 429 is common — poll sparingly.",
      ],
    };
  }

  const root = asRecord(result.data);
  if (!root) {
    return {
      provider: "anthropic",
      status: "unavailable",
      fetchedAt,
      error: "Unexpected Anthropic usage payload",
    };
  }

  const windows: QuotaWindow[] = [];
  pushBucket(windows, root.five_hour, "five_hour", "5h");
  pushBucket(windows, root.seven_day, "seven_day", "7d");
  pushBucket(windows, root.seven_day_sonnet, "seven_day_sonnet", "7d Sonnet");
  pushBucket(windows, root.seven_day_opus, "seven_day_opus", "7d Opus");

  const extra = asRecord(root.extra_usage);
  const credits = extra
    ? {
        limit: asNumber(extra.monthly_limit),
        remaining:
          asNumber(extra.monthly_limit) != null && asNumber(extra.used_credits) != null
            ? asNumber(extra.monthly_limit)! - asNumber(extra.used_credits)!
            : null,
        usage: asNumber(extra.used_credits),
        unlimited: null,
      }
    : undefined;

  return {
    provider: "anthropic",
    status: "ok",
    fetchedAt,
    planLabel: null,
    windows,
    credits,
    notes: [
      "Undocumented Anthropic OAuth usage — not billing-grade.",
      "PI harness traffic may use extra usage rather than these plan windows.",
    ],
    ...(options.includeRaw ? { raw: result.data } : {}),
  };
}

function pushBucket(
  windows: QuotaWindow[],
  value: unknown,
  id: string,
  label: string,
): void {
  const record = asRecord(value);
  if (!record) return;
  const usedPercent =
    asNumber(record.utilization) ?? asNumber(record.used_percentage) ?? asNumber(record.used_percent);
  windows.push({
    id,
    label,
    usedPercent,
    resetAtMs: toEpochMs(record.resets_at ?? record.reset_at),
    windowSeconds: null,
  });
}

function looksLikeApiKey(token: string): boolean {
  return token.startsWith("sk-ant-api") || (!token.startsWith("sk-ant-oat") && token.startsWith("sk-ant-"));
}
