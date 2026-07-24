export const QUESTIONNAIRE_PROTOCOL_VERSION = 1 as const;
export const QUESTIONNAIRE_START_TAG = '<pie-questionnaire version="1">';
export const QUESTIONNAIRE_END_TAG = "</pie-questionnaire>";

export type QuestionnaireProtocolQuestionType = "single_choice" | "multi_choice" | "text";

export type QuestionnaireProtocolOption = {
  value: string;
  label: string;
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

/** Strictly parse the app-owned model/UI questionnaire protocol. */
export function parseQuestionnaireEnvelope(text: string): ParsedQuestionnaireEnvelope | null {
  const start = text.indexOf(QUESTIONNAIRE_START_TAG);
  if (start < 0) return null;
  const contentStart = start + QUESTIONNAIRE_START_TAG.length;
  const end = text.indexOf(QUESTIONNAIRE_END_TAG, contentStart);
  if (end < 0 || text.indexOf(QUESTIONNAIRE_START_TAG, contentStart) >= 0) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(text.slice(contentStart, end).trim());
  } catch {
    return null;
  }
  const payload = parsePayload(decoded);
  if (!payload) return null;

  return {
    intro: text.slice(0, start).trim(),
    outro: text.slice(end + QUESTIONNAIRE_END_TAG.length).trim(),
    payload,
  };
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
    const optionValue = candidate.value.trim();
    if (values.has(optionValue)) return null;
    values.add(optionValue);
    options.push({ value: optionValue, label: candidate.label.trim() });
  }
  return options;
}

function isQuestionType(value: unknown): value is QuestionnaireProtocolQuestionType {
  return value === "single_choice" || value === "multi_choice" || value === "text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
