export const QUESTIONNAIRE_PROTOCOL_VERSION = 1 as const;
export const QUESTIONNAIRE_START_TAG = '<pie-questionnaire version="1">';
export const QUESTIONNAIRE_END_TAG = "</pie-questionnaire>";
/** Prefix used to hide incomplete envelopes while the start tag is still streaming. */
export const QUESTIONNAIRE_START_PREFIX = "<pie-questionnaire";

export type QuestionnaireProtocolQuestionType = "single_choice" | "multi_choice" | "text";

export type QuestionnaireProtocolOption = {
  value: string;
  label: string;
  /** Prefer this option in the UI (agent recommendation). */
  recommended?: boolean;
};

export type QuestionnaireProtocolQuestion = {
  id: string;
  type: QuestionnaireProtocolQuestionType;
  prompt: string;
  details?: string;
  options?: QuestionnaireProtocolOption[];
  allowOther?: boolean;
};

export type QuestionnaireProtocolPayload = {
  version: typeof QUESTIONNAIRE_PROTOCOL_VERSION;
  title?: string;
  questions: QuestionnaireProtocolQuestion[];
};

export type ParsedQuestionnaireEnvelope = {
  intro: string;
  outro: string;
  payload: QuestionnaireProtocolPayload;
};

/**
 * How to render assistant text that may contain a questionnaire envelope
 * (including mid-stream partial tags / JSON).
 */
export type QuestionnaireDisplay =
  | { phase: "none"; text: string }
  | { phase: "partial"; intro: string }
  /**
   * Envelope closed (or stream finished) but JSON/schema invalid — do not spin forever.
   * `raw` is the envelope (or residual fragment) for user copy / debug.
   */
  | { phase: "invalid"; intro: string; error: string; raw: string }
  | { phase: "complete"; intro: string; outro: string; payload: QuestionnaireProtocolPayload };

/** Strictly parse a finished app-owned questionnaire envelope. */
export function parseQuestionnaireEnvelope(text: string): ParsedQuestionnaireEnvelope | null {
  const start = text.indexOf(QUESTIONNAIRE_START_TAG);
  if (start < 0) return null;
  const contentStart = start + QUESTIONNAIRE_START_TAG.length;
  const end = text.indexOf(QUESTIONNAIRE_END_TAG, contentStart);
  if (end < 0 || text.indexOf(QUESTIONNAIRE_START_TAG, contentStart) >= 0) return null;

  const rawBody = text.slice(contentStart, end).trim();
  const decoded = parseQuestionnaireJson(rawBody);
  if (decoded === undefined) return null;
  const payload = parsePayload(decoded);
  if (!payload) return null;

  return {
    intro: text.slice(0, start).trim(),
    outro: text.slice(end + QUESTIONNAIRE_END_TAG.length).trim(),
    payload,
  };
}

/**
 * Split assistant text for UI: hide incomplete envelope JSON while streaming;
 * surface a form when complete; surface invalid when the envelope closed but
 * JSON/schema fails (so the UI does not spin forever).
 */
export function inspectQuestionnaireDisplay(text: string): QuestionnaireDisplay {
  const complete = parseQuestionnaireEnvelope(text);
  if (complete) {
    return {
      phase: "complete",
      intro: complete.intro,
      outro: complete.outro,
      payload: complete.payload,
    };
  }

  const start = text.indexOf(QUESTIONNAIRE_START_TAG);
  if (start >= 0) {
    const contentStart = start + QUESTIONNAIRE_START_TAG.length;
    const end = text.indexOf(QUESTIONNAIRE_END_TAG, contentStart);
    if (end >= 0) {
      const rawBody = text.slice(contentStart, end).trim();
      const raw = text.slice(start, end + QUESTIONNAIRE_END_TAG.length);
      const decoded = parseQuestionnaireJson(rawBody);
      const intro = text.slice(0, start).trimEnd();
      if (decoded === undefined) {
        return {
          phase: "invalid",
          intro,
          error: "问卷 JSON 无法解析（常见于字段写成 \"label\", 而非 \"label\":，或字符串内未转义引号）。",
          raw,
        };
      }
      return {
        phase: "invalid",
        intro,
        error: "问卷结构不符合协议（字段类型、选项数量或 version 不正确）。",
        raw,
      };
    }
  }

  const openAt = findQuestionnaireOpenIndex(text);
  if (openAt != null) {
    return {
      phase: "partial",
      intro: text.slice(0, openAt).trimEnd(),
    };
  }

  return { phase: "none", text };
}

/**
 * Parse envelope JSON; apply light repairs for common model typos
 * (e.g. `"label", "text"` → `"label": "text"`).
 */
function parseQuestionnaireJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    /* try repair */
  }
  const repaired = repairCommonQuestionnaireJsonTypos(raw);
  if (repaired === raw) return undefined;
  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

/**
 * Fix frequent LLM JSON mistakes inside questionnaire payloads.
 * Only rewrite known property names so valid `"value", "nextKey"` pairs stay intact.
 */
export function repairCommonQuestionnaireJsonTypos(raw: string): string {
  // `"label", "…"` → `"label": "…"` (colon mistyped as comma after a field name)
  return raw.replace(
    /"(label|value|prompt|details|id|type|title)"\s*,\s*"/g,
    '"$1": "',
  );
}

/** Index where a full or still-streaming start tag begins, if any. */
export function findQuestionnaireOpenIndex(text: string): number | null {
  const full = text.indexOf(QUESTIONNAIRE_START_PREFIX);
  if (full >= 0) return full;

  // Hide a trailing partial tag such as `<pie-quest` while it streams in.
  const max = Math.min(text.length, QUESTIONNAIRE_START_PREFIX.length - 1);
  for (let len = max; len >= 2; len -= 1) {
    const suffix = text.slice(-len);
    if (!suffix.startsWith("<")) continue;
    if (QUESTIONNAIRE_START_PREFIX.startsWith(suffix)) {
      return text.length - len;
    }
  }
  return null;
}

function parsePayload(value: unknown): QuestionnaireProtocolPayload | null {
  if (!isRecord(value) || value.version !== QUESTIONNAIRE_PROTOCOL_VERSION) return null;
  if (value.title !== undefined && typeof value.title !== "string") return null;
  if (!Array.isArray(value.questions) || value.questions.length === 0) return null;

  const questions: QuestionnaireProtocolQuestion[] = [];
  const ids = new Set<string>();
  for (const candidate of value.questions) {
    const question = parseQuestion(candidate);
    if (!question || ids.has(question.id)) return null;
    ids.add(question.id);
    questions.push(question);
  }

  return {
    version: QUESTIONNAIRE_PROTOCOL_VERSION,
    ...(value.title?.trim() ? { title: value.title.trim() } : {}),
    questions,
  };
}

function parseQuestion(value: unknown): QuestionnaireProtocolQuestion | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.prompt !== "string" || !value.prompt.trim()) return null;
  if (!isQuestionType(value.type)) return null;
  if (value.details !== undefined && typeof value.details !== "string") return null;
  if (value.allowOther !== undefined && typeof value.allowOther !== "boolean") return null;

  const options = value.options === undefined ? [] : parseOptions(value.options);
  if (!options) return null;
  if (value.type !== "text" && options.length < 2) return null;

  return {
    id: value.id.trim(),
    type: value.type,
    prompt: value.prompt.trim(),
    ...(value.details?.trim() ? { details: value.details.trim() } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(value.allowOther !== undefined ? { allowOther: value.allowOther } : {}),
  };
}

function parseOptions(value: unknown): QuestionnaireProtocolOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: QuestionnaireProtocolOption[] = [];
  const values = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    if (typeof candidate.value !== "string" || !candidate.value.trim()) return null;
    if (typeof candidate.label !== "string" || !candidate.label.trim()) return null;
    if (candidate.recommended !== undefined && typeof candidate.recommended !== "boolean") {
      return null;
    }
    const optionValue = candidate.value.trim();
    if (values.has(optionValue)) return null;
    values.add(optionValue);
    options.push({
      value: optionValue,
      label: candidate.label.trim(),
      ...(candidate.recommended === true ? { recommended: true } : {}),
    });
  }
  return options;
}

function isQuestionType(value: unknown): value is QuestionnaireProtocolQuestionType {
  return value === "single_choice" || value === "multi_choice" || value === "text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
