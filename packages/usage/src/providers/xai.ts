import { asRecord, asString, fetchJson } from "../http.js";
import type {
  ProviderAuthCredential,
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "../types.js";

const MANAGEMENT_BASE = "https://management-api.x.ai";
const VALIDATION_URL = `${MANAGEMENT_BASE}/auth/management-keys/validation`;

/**
 * xAI prepaid / postpaid meters via official Management API.
 * Requires a Management Key (Console → Settings → Management Keys), not the
 * inference API key and not the grok-cli OAuth token.
 *
 * @see https://docs.x.ai/developers/rest-api-reference/management/billing
 */
export async function fetchXaiQuota(
  credential: ProviderAuthCredential,
  options: { includeRaw?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ProviderQuotaSnapshot> {
  const fetchedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: "application/json",
  };

  const validation = await fetchJson(
    VALIDATION_URL,
    { method: "GET", headers },
    fetchImpl,
  );

  if (!validation.ok) {
    return authishFailure(fetchedAt, validation.status, validation.error, [
      "xAI usage needs a Management Key (console.x.ai → Settings → Management Keys).",
      "Store it as xai.managementKey in ~/.pi/agent/auth.json.",
      "OAuth / inference API keys cannot call the Management billing API.",
    ]);
  }

  const validationRoot = asRecord(validation.data);
  const teamId =
    credential.teamId ??
    asString(validationRoot?.scopeId) ??
    asString(validationRoot?.teamId);

  if (!teamId) {
    return {
      provider: "xai",
      status: "unavailable",
      fetchedAt,
      error: "Management key validation did not include a team id",
      notes: [
        "Set xai.teamId in auth.json, or use a team-scoped Management Key.",
      ],
    };
  }

  const planLabel = asString(validationRoot?.name);

  const [balanceResult, limitsResult, previewResult] = await Promise.all([
    fetchJson(
      `${MANAGEMENT_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
      { method: "GET", headers },
      fetchImpl,
    ),
    fetchJson(
      `${MANAGEMENT_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/postpaid/spending-limits`,
      { method: "GET", headers },
      fetchImpl,
    ),
    fetchJson(
      `${MANAGEMENT_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/postpaid/invoice/preview`,
      { method: "GET", headers },
      fetchImpl,
    ),
  ]);

  if (!balanceResult.ok) {
    return authishFailure(fetchedAt, balanceResult.status, balanceResult.error, [
      "Failed to read prepaid credit balance from Management API.",
      "Confirm the Management Key has billing read permission for this team.",
    ]);
  }

  const balanceRoot = asRecord(balanceResult.data);
  if (!balanceRoot) {
    return {
      provider: "xai",
      status: "unavailable",
      fetchedAt,
      error: "Unexpected prepaid balance payload",
    };
  }

  // Accounting is inverted: PURCHASE amounts are negative, SPEND positive.
  // Remaining prepaid USD cents ≈ -total.val when total is negative.
  const totalCents = parseUsdCentsField(balanceRoot.total);
  const remainingCents = totalCents != null ? -totalCents : null;
  const remainingUsd = centsToUsd(remainingCents);

  const limitsRoot = limitsResult.ok ? asRecord(limitsResult.data) : null;
  const spendingLimits = asRecord(limitsRoot?.spendingLimits);
  const softSlCents = parseUsdCentsField(spendingLimits?.softSl ?? spendingLimits?.effectiveSl);

  const previewRoot = previewResult.ok ? asRecord(previewResult.data) : null;
  const coreInvoice = asRecord(previewRoot?.coreInvoice);
  const postpaidCents = parseUsdCentsScalar(coreInvoice?.amountAfterVat)
    ?? parseUsdCentsScalar(coreInvoice?.amountBeforeVat)
    ?? 0;
  const prepaidUsedCents = parseUsdCentsField(coreInvoice?.prepaidCreditsUsed) ?? 0;
  // prepaidCreditsUsed may also use inverted sign; take absolute spend magnitude.
  const prepaidUsedAbs = Math.abs(prepaidUsedCents);
  const periodUsageCents = Math.max(0, postpaidCents) + prepaidUsedAbs;
  const periodUsageUsd = centsToUsd(periodUsageCents);

  const windows: QuotaWindow[] = [];
  let usedPercent: number | null = null;

  if (softSlCents != null && softSlCents > 0) {
    // Soft postpaid cap — percent of monthly postpaid spend against the soft limit.
    usedPercent = (Math.max(0, postpaidCents) / softSlCents) * 100;
    windows.push({
      id: "month",
      label: "month",
      usedPercent,
      resetAtMs: endOfUtcMonthMs(fetchedAt),
      windowSeconds: null,
    });
  } else if (remainingCents != null && periodUsageCents + Math.max(0, remainingCents) > 0) {
    // Prepaid-only: share of (spent this period + remaining) already consumed.
    const tank = periodUsageCents + Math.max(0, remainingCents);
    usedPercent = (periodUsageCents / tank) * 100;
    windows.push({
      id: "credits",
      label: "credits",
      usedPercent,
      resetAtMs: null,
      windowSeconds: null,
    });
  } else {
    windows.push({
      id: "credits",
      label: "credits",
      usedPercent: null,
      resetAtMs: null,
      windowSeconds: null,
    });
  }

  const notes: string[] = [
    "xAI Management API prepaid balance / postpaid limits (official).",
    "Requires Management Key in auth.json as xai.managementKey.",
  ];
  if (!limitsResult.ok) {
    notes.push(`Spending limits unavailable: ${limitsResult.error}`);
  }
  if (!previewResult.ok) {
    notes.push(`Invoice preview unavailable: ${previewResult.error}`);
  }
  if (remainingUsd != null && remainingUsd <= 0) {
    notes.push("Prepaid balance is zero or exhausted.");
  }

  return {
    provider: "xai",
    status: "ok",
    fetchedAt,
    planLabel,
    windows,
    credits: {
      limit: softSlCents != null && softSlCents > 0 ? centsToUsd(softSlCents) : null,
      remaining: remainingUsd,
      usage: periodUsageUsd,
      unlimited: softSlCents == null || softSlCents <= 0 ? null : false,
    },
    notes,
    ...(options.includeRaw
      ? {
          raw: {
            validation: validation.data,
            balance: balanceResult.data,
            spendingLimits: limitsResult.ok ? limitsResult.data : limitsResult.error,
            invoicePreview: previewResult.ok ? previewResult.data : previewResult.error,
          },
        }
      : {}),
  };
}

function authishFailure(
  fetchedAt: number,
  status: number | null,
  error: string,
  notes: string[],
): ProviderQuotaSnapshot {
  if (status === 401 || status === 403) {
    return {
      provider: "xai",
      status: "unauthenticated",
      fetchedAt,
      error,
      notes,
    };
  }
  return {
    provider: "xai",
    status: "error",
    fetchedAt,
    error,
    notes,
  };
}

/** Parse `{ val: "123" }` USD-cents fields from Management API. */
function parseUsdCentsField(value: unknown): number | null {
  const record = asRecord(value);
  if (record && "val" in record) return parseUsdCentsScalar(record.val);
  return parseUsdCentsScalar(value);
}

function parseUsdCentsScalar(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function centsToUsd(cents: number | null): number | null {
  if (cents == null) return null;
  return Math.round(cents) / 100;
}

function endOfUtcMonthMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}
