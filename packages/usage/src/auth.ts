import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderAuthCredential, UsageProviderId } from "./types.js";

const SUPPORTED: UsageProviderId[] = ["openai-codex", "anthropic", "openrouter", "xai"];

export type LoadPiAuthOptions = {
  /** Defaults to `~/.pi/agent/auth.json`. */
  authPath?: string;
  providers?: UsageProviderId[];
};

/**
 * Read PI `auth.json` credentials for providers that expose a quota meter.
 * Does not refresh expired OAuth tokens — callers should rely on PI login/refresh.
 */
export async function loadPiAuthCredentials(
  options: LoadPiAuthOptions = {},
): Promise<ProviderAuthCredential[]> {
  const authPath = options.authPath ?? join(homedir(), ".pi", "agent", "auth.json");
  const wanted = new Set(options.providers ?? SUPPORTED);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(authPath, "utf8")) as unknown;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
    if (code === "ENOENT") return [];
    throw err;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const file = raw as Record<string, unknown>;
  const out: ProviderAuthCredential[] = [];

  for (const provider of SUPPORTED) {
    if (!wanted.has(provider)) continue;
    const entry = file[provider];
    if (provider === "xai") {
      const credential = parseXaiManagementCredential(entry);
      if (credential) out.push(credential);
      continue;
    }
    const credential = parseAuthEntry(provider, entry);
    if (credential) out.push(credential);
  }
  return out;
}

function parseAuthEntry(
  provider: UsageProviderId,
  entry: unknown,
): ProviderAuthCredential | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "oauth" || (!type && typeof record.access === "string")) {
    const access = typeof record.access === "string" ? record.access : "";
    if (!access) return null;
    return {
      provider,
      accessToken: access,
      accountId: typeof record.accountId === "string" ? record.accountId : undefined,
      expiresAtMs: typeof record.expires === "number" ? record.expires : undefined,
    };
  }

  if (type === "api_key" || typeof record.key === "string") {
    const key = typeof record.key === "string" ? record.key : "";
    if (!key || isDeferredSecret(key)) {
      // Shell / env deferred keys are not resolved here.
      return null;
    }
    return {
      provider,
      accessToken: key,
    };
  }

  return null;
}

/**
 * xAI billing is Management-API only. Prefer `managementKey` on the `xai`
 * auth entry; OAuth access tokens and inference API keys are rejected upstream.
 */
function parseXaiManagementCredential(entry: unknown): ProviderAuthCredential | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;

  const managementKey =
    (typeof record.managementKey === "string" && record.managementKey) ||
    (typeof record.management_key === "string" && record.management_key) ||
    "";

  if (!managementKey || isDeferredSecret(managementKey)) return null;

  const teamId =
    (typeof record.teamId === "string" && record.teamId) ||
    (typeof record.team_id === "string" && record.team_id) ||
    undefined;

  return {
    provider: "xai",
    accessToken: managementKey,
    teamId: teamId || undefined,
  };
}

function isDeferredSecret(value: string): boolean {
  return value.startsWith("!") || value.includes("$");
}
