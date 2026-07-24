import { fetchAnthropicQuota } from "./providers/anthropic.js";
import { fetchCodexQuota } from "./providers/codex.js";
import { fetchOpenRouterQuota } from "./providers/openrouter.js";
import type {
  FetchProviderQuotasOptions,
  ProviderAuthCredential,
  ProviderQuotaSnapshot,
  UsageProviderId,
} from "./types.js";

const ALL: UsageProviderId[] = ["openai-codex", "anthropic", "openrouter"];

/**
 * Fetch subscription / credit meters for the credentials supplied by the caller.
 * Missing providers are omitted (not fabricated as errors).
 */
export async function fetchProviderQuotas(
  credentials: ProviderAuthCredential[],
  options: FetchProviderQuotasOptions = {},
): Promise<ProviderQuotaSnapshot[]> {
  const wanted = new Set(options.providers ?? ALL);
  const byProvider = new Map<UsageProviderId, ProviderAuthCredential>();
  for (const credential of credentials) {
    if (!wanted.has(credential.provider)) continue;
    byProvider.set(credential.provider, credential);
  }

  const tasks: Array<Promise<ProviderQuotaSnapshot>> = [];
  for (const provider of ALL) {
    if (!wanted.has(provider)) continue;
    const credential = byProvider.get(provider);
    if (!credential) continue;
    tasks.push(fetchOne(credential, options));
  }
  return Promise.all(tasks);
}

async function fetchOne(
  credential: ProviderAuthCredential,
  options: FetchProviderQuotasOptions,
): Promise<ProviderQuotaSnapshot> {
  switch (credential.provider) {
    case "openai-codex":
      return fetchCodexQuota(credential, {
        includeRaw: options.includeRaw,
        fetchImpl: options.fetchImpl,
      });
    case "anthropic":
      return fetchAnthropicQuota(credential, {
        includeRaw: options.includeRaw,
        fetchImpl: options.fetchImpl,
        userAgent: options.anthropicUserAgent,
      });
    case "openrouter":
      return fetchOpenRouterQuota(credential, {
        includeRaw: options.includeRaw,
        fetchImpl: options.fetchImpl,
      });
    default: {
      const _exhaustive: never = credential.provider;
      return _exhaustive;
    }
  }
}
