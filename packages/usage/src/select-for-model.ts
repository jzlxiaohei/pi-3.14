import type { ProviderQuotaSnapshot, UsageProviderId } from "./types.js";

const USAGE_PROVIDERS = new Set<UsageProviderId>([
  "openai-codex",
  "anthropic",
  "openrouter",
]);

/**
 * Map a PI model provider id onto a subscription / credit meter, if any.
 * Providers without a known meter (e.g. `xai`) return null — callers must not
 * fall back to another provider's usage.
 */
export function resolveUsageProviderId(
  modelProvider: string | null | undefined,
): UsageProviderId | null {
  if (!modelProvider) return null;
  if (!USAGE_PROVIDERS.has(modelProvider as UsageProviderId)) return null;
  return modelProvider as UsageProviderId;
}

/** Keep only quota snapshots that belong to the active model provider. */
export function selectQuotasForModel(
  quotas: ProviderQuotaSnapshot[],
  modelProvider: string | null | undefined,
): ProviderQuotaSnapshot[] {
  const usageProvider = resolveUsageProviderId(modelProvider);
  if (!usageProvider) return [];
  return quotas.filter((snapshot) => snapshot.provider === usageProvider);
}
