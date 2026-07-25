/**
 * Classify provider/SDK error strings already stored on timeline items
 * (JSONL `errorMessage` or turn result). Pure display helper — no SDK imports.
 */

export type ClassifiedTimelineError = {
  title: string;
  detail: string;
  kind:
    | "auth"
    | "rate_limit"
    | "quota"
    | "overflow"
    | "network"
    | "server"
    | "model"
    | "unknown";
};

export function classifyTimelineError(
  raw: string | null | undefined,
): ClassifiedTimelineError {
  const detail = (raw ?? "").trim() || "Unknown error";
  const lower = detail.toLowerCase();

  if (
    /\b401\b/.test(detail) ||
    /\b403\b/.test(detail) ||
    /unauthorized|authentication|unauthenticated|invalid.?api.?key|api.?key.*(invalid|missing|expired)|token.*(expired|invalid|revoked)|not.?logged|credentials?/i.test(
      lower,
    )
  ) {
    return {
      kind: "auth",
      title: "Authentication failed",
      detail: withHint(
        detail,
        "Provider rejected credentials — key/OAuth may be missing, invalid, or expired. Re-login or refresh the API key.",
      ),
    };
  }

  if (/\b429\b/.test(detail) || /rate.?limit|too many requests|throttl/i.test(lower)) {
    return {
      kind: "rate_limit",
      title: "Rate limited",
      detail: withHint(detail, "Wait and retry, or switch model/provider."),
    };
  }

  if (/quota|billing|payment|insufficient.?funds|credit|balance|usage.?limit/i.test(lower)) {
    return {
      kind: "quota",
      title: "Quota / billing",
      detail: withHint(detail, "Check provider balance, prepaid credit, or plan limits."),
    };
  }

  if (
    /context.?length|prompt is too long|maximum context|token limit|request_too_large|overflow/i.test(
      lower,
    )
  ) {
    return {
      kind: "overflow",
      title: "Context too large",
      detail: withHint(detail, "Compact history or start a shorter branch."),
    };
  }

  if (
    /\b5\d\d\b/.test(detail) ||
    /internal.?server|service.?unavailable|bad gateway|gateway timeout/i.test(lower)
  ) {
    return {
      kind: "server",
      title: "Provider server error",
      detail: withHint(detail, "Temporary provider failure — retry shortly."),
    };
  }

  if (/model.?not.?found|unknown model|does not exist|unsupported model/i.test(lower)) {
    return {
      kind: "model",
      title: "Model unavailable",
      detail: withHint(detail, "Pick another model in the session header."),
    };
  }

  if (
    /^connection error\.?$/i.test(detail.trim()) ||
    /fetch failed|econnreset|etimedout|enotfound|network|socket/i.test(lower)
  ) {
    return {
      kind: "network",
      title: "Connection failed",
      detail: withHint(
        detail,
        "Could not reach the provider (network, proxy/VPN, TLS, or auth that the SDK only reports as a connection error). Try re-login and retry.",
      ),
    };
  }

  if (/^model request failed$/i.test(detail) || /^request failed$/i.test(detail)) {
    return {
      kind: "unknown",
      title: "Request failed",
      detail: "No further detail from the provider. Check network, login, and model.",
    };
  }

  return { kind: "unknown", title: "Request failed", detail };
}

function withHint(detail: string, hint: string): string {
  if (detail.toLowerCase().includes(hint.slice(0, 20).toLowerCase())) return detail;
  return `${detail}\n\n${hint}`;
}
