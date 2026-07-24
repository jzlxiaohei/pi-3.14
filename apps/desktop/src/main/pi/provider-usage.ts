import type { ProviderQuotaSnapshot } from "@pi-3.14/usage";
import { fetchPiProviderQuotas } from "@pi-3.14/usage/node";

const CACHE_TTL_MS = 60_000;

let cache: { at: number; snapshots: ProviderQuotaSnapshot[] } | null = null;
let inFlight: Promise<ProviderQuotaSnapshot[]> | null = null;

/** Cached provider subscription / credit meters for the Context panel. */
export async function getProviderUsageSnapshots(force = false): Promise<ProviderQuotaSnapshot[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.snapshots;
  }
  if (inFlight) return inFlight;

  inFlight = fetchPiProviderQuotas()
    .then((snapshots) => {
      cache = { at: Date.now(), snapshots };
      return snapshots;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
