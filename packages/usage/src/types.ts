/** Providers with a known subscription / credit meter we can query. */
export type UsageProviderId = "openai-codex" | "anthropic" | "openrouter";

export type QuotaWindow = {
  /** Stable id within the provider payload. */
  id: string;
  /** Short UI label, e.g. `5h`, `7d`, `credits`. */
  label: string;
  /** Consumed share in 0–100. May exceed 100 from upstream; UI may clamp. */
  usedPercent: number | null;
  /** Unix epoch ms when the window resets, if known. */
  resetAtMs: number | null;
  /** Sliding / fixed window length in seconds, if known. */
  windowSeconds: number | null;
};

export type ProviderCredits = {
  limit: number | null;
  remaining: number | null;
  usage: number | null;
  unlimited: boolean | null;
};

export type ProviderQuotaOk = {
  provider: UsageProviderId;
  status: "ok";
  fetchedAt: number;
  /** Plan / tier label when the provider reports one. */
  planLabel: string | null;
  windows: QuotaWindow[];
  credits?: ProviderCredits;
  /** Non-fatal caveats for UI copy. */
  notes?: string[];
  /** Raw payload kept for debugging; never required by UI. */
  raw?: unknown;
};

export type ProviderQuotaFailure = {
  provider: UsageProviderId;
  status: "unavailable" | "unauthenticated" | "error";
  fetchedAt: number;
  error?: string;
  notes?: string[];
};

export type ProviderQuotaSnapshot = ProviderQuotaOk | ProviderQuotaFailure;

export type ProviderAuthCredential = {
  provider: UsageProviderId;
  /** OAuth access token or API key, depending on provider. */
  accessToken: string;
  /** ChatGPT account id for Codex WHAM; optional (JWT may carry it). */
  accountId?: string;
  /** Optional expires-at (ms) for UI stale hints. */
  expiresAtMs?: number;
};

export type FetchProviderQuotasOptions = {
  providers?: UsageProviderId[];
  /** Include `raw` on ok snapshots. Default false. */
  includeRaw?: boolean;
  fetchImpl?: typeof fetch;
  /** Override Anthropic User-Agent (defaults to a Claude-Code-like value). */
  anthropicUserAgent?: string;
};

export type ContextCompositionBucketId =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "thinking"
  | "other";

export type ContextCompositionBucket = {
  id: ContextCompositionBucketId;
  label: string;
  estimatedTokens: number;
  percent: number;
};

export type ContextCompositionEstimate = {
  /** Honest method label — not provider-billed tokens. */
  method: "chars/4";
  totalEstimatedTokens: number;
  buckets: ContextCompositionBucket[];
};

export type ContextCompositionInput = {
  systemPrompt?: string;
  messages?: Array<{
    role?: string;
    text?: string;
    content?: unknown;
    thinking?: string;
  }>;
  /** Extra unlabeled blobs (e.g. tool schemas) attributed to `other`. */
  extras?: Array<{ label?: string; text: string }>;
};
