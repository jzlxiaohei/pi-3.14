import { fetchProviderQuotas } from "./fetch-quotas.js";
import { loadPiAuthCredentials, type LoadPiAuthOptions } from "./auth.js";
import type { FetchProviderQuotasOptions, ProviderQuotaSnapshot } from "./types.js";

export { loadPiAuthCredentials, type LoadPiAuthOptions };

/** Load PI auth.json then fetch every available meter. */
export async function fetchPiProviderQuotas(
  options: FetchProviderQuotasOptions & Pick<LoadPiAuthOptions, "authPath"> = {},
): Promise<ProviderQuotaSnapshot[]> {
  const credentials = await loadPiAuthCredentials({
    authPath: options.authPath,
    providers: options.providers,
  });
  return fetchProviderQuotas(credentials, options);
}
