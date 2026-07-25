/**
 * Turn opaque provider/SDK throws into a single human-readable string.
 * Walks `cause` chains and common APIError-shaped fields (status, code, body).
 */

export type ClassifiedProviderError = {
  /** Short title for UI chrome (e.g. "Auth expired"). */
  title: string;
  /** Full message to show under the title. */
  detail: string;
  /** Coarse category for styling / actions. */
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

/** Format any thrown value into a multi-line detail string (no classification). */
export function formatThrownError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current !== undefined && current !== null && depth < 6 && !seen.has(current)) {
    seen.add(current);
    depth += 1;

    if (typeof current === "string") {
      pushUnique(parts, current.trim());
      break;
    }

    if (current instanceof Error) {
      pushUnique(parts, current.message.trim());
      const extra = collectErrorFields(current);
      for (const line of extra) pushUnique(parts, line);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      const msg =
        typeof obj.message === "string"
          ? obj.message
          : typeof obj.error === "string"
            ? obj.error
            : typeof obj.errorMessage === "string"
              ? obj.errorMessage
              : null;
      if (msg) pushUnique(parts, msg.trim());
      for (const line of collectErrorFields(obj)) pushUnique(parts, line);
      current = obj.cause;
      continue;
    }

    pushUnique(parts, String(current));
    break;
  }

  return parts.filter(Boolean).join("\n") || "Unknown error";
}

/** Classify a raw error message (from JSONL or a throw) for UI titles/hints. */
export function classifyProviderError(raw: string | null | undefined): ClassifiedProviderError {
  const detail = (raw ?? "").trim() || "Unknown error";
  const lower = detail.toLowerCase();

  if (
    /\b401\b/.test(detail) ||
    /\b403\b/.test(detail) ||
    /unauthorized|authentication|unauthenticated|invalid.?api.?key|api.?key.*(invalid|missing|expired)|token.*(expired|invalid|revoked)|login|oauth|not.?logged|credentials?/i.test(
      lower,
    )
  ) {
    return {
      kind: "auth",
      title: "Authentication failed",
      detail: appendHint(
        detail,
        "Provider rejected credentials — API key / OAuth may be missing, invalid, or expired. Re-login or refresh the key.",
      ),
    };
  }

  if (
    /\b429\b/.test(detail) ||
    /rate.?limit|too many requests|throttl/i.test(lower)
  ) {
    return {
      kind: "rate_limit",
      title: "Rate limited",
      detail: appendHint(detail, "Wait and retry, or switch model/provider."),
    };
  }

  if (
    /quota|billing|payment|insufficient.?funds|credit|balance|usage.?limit/i.test(lower)
  ) {
    return {
      kind: "quota",
      title: "Quota / billing",
      detail: appendHint(detail, "Check provider balance, prepaid credit, or plan limits."),
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
      detail: appendHint(detail, "Compact history or start a shorter branch."),
    };
  }

  if (
    /\b5\d\d\b/.test(detail) ||
    /internal.?server|service.?unavailable|bad gateway|gateway timeout/i.test(lower)
  ) {
    return {
      kind: "server",
      title: "Provider server error",
      detail: appendHint(detail, "Temporary provider failure — retry shortly."),
    };
  }

  if (
    /model.?not.?found|unknown model|does not exist|unsupported model/i.test(lower)
  ) {
    return {
      kind: "model",
      title: "Model unavailable",
      detail: appendHint(detail, "Pick another model in the session header."),
    };
  }

  // OpenAI/xAI SDK often collapses transport + TLS + DNS + some auth fails into this.
  if (/^connection error\.?$/i.test(detail.trim()) || /fetch failed|econnreset|etimedout|enotfound|network|socket/i.test(lower)) {
    return {
      kind: "network",
      title: "Connection failed",
      detail: appendHint(
        detail,
        "Could not reach the provider. Common causes: offline network, proxy/VPN, TLS intercept, or auth that the SDK only reports as a connection error — try re-login and retry.",
      ),
    };
  }

  return {
    kind: "unknown",
    title: "Request failed",
    detail,
  };
}

/** Single string for persistence / timeline errorMessage field. */
export function formatProviderErrorMessage(error: unknown): string {
  const raw = formatThrownError(error);
  const classified = classifyProviderError(raw);
  if (classified.kind === "unknown") return classified.detail;
  // Persist title + detail so reloads still show the hint.
  if (classified.detail.startsWith(classified.title)) return classified.detail;
  return `${classified.title}: ${classified.detail}`;
}

function collectErrorFields(value: object): string[] {
  const obj = value as Record<string, unknown>;
  const lines: string[] = [];

  const status = obj.status ?? obj.statusCode ?? obj.status_code;
  if (typeof status === "number" || typeof status === "string") {
    lines.push(`HTTP ${status}`);
  }

  const code = obj.code ?? obj.errorCode ?? obj.type;
  if (typeof code === "string" && code.trim() && code !== "Error") {
    lines.push(`code: ${code.trim()}`);
  }

  // OpenAI-style: error: { message, type, code }
  const nested = obj.error;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    if (typeof n.message === "string") lines.push(n.message.trim());
    if (typeof n.type === "string") lines.push(`type: ${n.type}`);
    if (typeof n.code === "string") lines.push(`code: ${n.code}`);
  }

  if (typeof obj.body === "string" && obj.body.trim()) {
    lines.push(truncate(obj.body.trim(), 400));
  } else if (obj.body && typeof obj.body === "object") {
    try {
      lines.push(truncate(JSON.stringify(obj.body), 400));
    } catch {
      /* ignore */
    }
  }

  if (typeof obj.responseBody === "string" && obj.responseBody.trim()) {
    lines.push(truncate(obj.responseBody.trim(), 400));
  }

  return lines;
}

function pushUnique(parts: string[], line: string): void {
  const t = line.trim();
  if (!t) return;
  if (parts.some((p) => p === t || p.includes(t) || t.includes(p))) return;
  parts.push(t);
}

function appendHint(detail: string, hint: string): string {
  if (detail.toLowerCase().includes(hint.slice(0, 24).toLowerCase())) return detail;
  return `${detail}\n\n${hint}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
