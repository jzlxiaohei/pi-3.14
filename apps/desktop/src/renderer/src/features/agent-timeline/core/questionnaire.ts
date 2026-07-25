import {
  inspectQuestionnaireDisplay,
  parseQuestionnaireEnvelope,
  type QuestionnaireProtocolPayload,
  type QuestionnaireProtocolQuestionType,
} from "../../../../../shared/questionnaire-protocol";

export type QuestionnaireOption = {
  value: string;
  label: string;
  recommended?: boolean;
};

export type QuestionnaireQuestion = {
  id: string;
  number: number;
  type: QuestionnaireProtocolQuestionType;
  title: string;
  markdown: string;
  options: QuestionnaireOption[];
  allowOther: boolean;
};

export type Questionnaire = {
  title?: string;
  intro: string;
  outro: string;
  questions: QuestionnaireQuestion[];
};

/** UI view of assistant text that may contain a (partial) questionnaire. */
export type AssistantQuestionnaireView =
  | { phase: "plain"; text: string }
  | { phase: "building"; intro: string }
  | {
      phase: "broken";
      intro: string;
      error: string;
      /** Envelope / residual fragment for copy & debug. */
      raw: string;
      /** Full assistant text (includes intro + envelope). */
      fullText: string;
    }
  | { phase: "ready"; intro: string; outro: string; questionnaire: Questionnaire };

type NumberedHeading = {
  index: number;
  level: number;
  number: number;
  title: string;
};

const NUMBERED_HEADING = /^(#{2,6})\s+(\d+)[.)、．]\s+(.+?)\s*#*\s*$/;
const EXPLICIT_OPTION = /^\s*[-*+]\s+\*\*([A-Z])\*\*[：:]\s*(.+?)\s*$/;
const QUESTION_CUE = /[?？]|(?:^|\s)(?:please\s+(?:answer|respond|choose|confirm)|which|what|how|would|should|do you)\b|请|是否|哪些|哪种|怎么|如何|希望|选择|确认|勾选|还是/i;
const QUESTIONNAIRE_CUE = /请.{0,24}回答|please\s+(?:answer|respond)|需要确认|关键(?:决策|问题)|questions?|问答/i;

/** Parse the versioned protocol first, then fall back to conservative legacy Markdown detection. */
export function parseQuestionnaire(markdown: string): Questionnaire | null {
  const envelope = parseQuestionnaireEnvelope(markdown);
  if (envelope) {
    return questionnaireFromEnvelope(envelope.intro, envelope.outro, envelope.payload);
  }

  return parseLegacyQuestionnaire(markdown);
}

/**
 * Streaming-safe view: hide incomplete envelope JSON; show form when complete;
 * show broken when envelope closed but invalid; fall back to legacy Markdown
 * only when not streaming a protocol tag.
 */
export function viewAssistantQuestionnaire(
  markdown: string,
  options?: { streaming?: boolean },
): AssistantQuestionnaireView {
  const display = inspectQuestionnaireDisplay(markdown);
  if (display.phase === "complete") {
    return {
      phase: "ready",
      intro: display.intro,
      outro: display.outro,
      questionnaire: questionnaireFromEnvelope(display.intro, display.outro, display.payload),
    };
  }
  if (display.phase === "invalid") {
    return {
      phase: "broken",
      intro: display.intro,
      error: display.error,
      raw: display.raw,
      fullText: markdown,
    };
  }
  if (display.phase === "partial") {
    // Stream finished but tag never closed → treat as broken, not infinite loading.
    if (!options?.streaming) {
      const openAt = markdown.indexOf("<pie-questionnaire");
      const raw = openAt >= 0 ? markdown.slice(openAt) : markdown;
      return {
        phase: "broken",
        intro: display.intro,
        error: "问卷标签未完整结束，无法展示表单。可让模型重新发一份 questionnaire。",
        raw,
        fullText: markdown,
      };
    }
    return { phase: "building", intro: display.intro };
  }

  // While streaming plain text, skip expensive legacy detection of partial headings.
  if (options?.streaming) {
    return { phase: "plain", text: markdown };
  }

  const legacy = parseLegacyQuestionnaire(markdown);
  if (legacy) {
    return {
      phase: "ready",
      intro: legacy.intro,
      outro: legacy.outro,
      questionnaire: legacy,
    };
  }
  return { phase: "plain", text: markdown };
}

function questionnaireFromEnvelope(
  intro: string,
  outro: string,
  payload: QuestionnaireProtocolPayload,
): Questionnaire {
  return {
    ...(payload.title ? { title: payload.title } : {}),
    intro,
    outro,
    questions: payload.questions.map((question, index) => ({
      id: question.id,
      number: index + 1,
      type: question.type,
      title: question.prompt,
      markdown: question.details ?? "",
      options: (question.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.recommended ? { recommended: true } : {}),
      })),
      allowOther: question.type === "text" || question.allowOther !== false,
    })),
  };
}

function parseLegacyQuestionnaire(markdown: string): Questionnaire | null {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.flatMap<NumberedHeading>((line, index) => {
    const match = NUMBERED_HEADING.exec(line.trim());
    if (!match) return [];
    return [{
      index,
      level: match[1]!.length,
      number: Number(match[2]),
      title: match[3]!.trim(),
    }];
  });

  const groups: NumberedHeading[][] = [];
  let current: NumberedHeading[] = [];
  for (const heading of headings) {
    const expected = current.length + 1;
    if (heading.number === expected) {
      current.push(heading);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = heading.number === 1 ? [heading] : [];
  }
  if (current.length > 0) groups.push(current);

  const candidate = groups
    .filter((group) => group.length >= 3)
    .map((group) => ({ group, score: questionnaireScore(lines, group) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.group.length - left.group.length)[0]?.group;

  if (!candidate) return null;

  const first = candidate[0]!;
  const questions = candidate.map((heading, index) => {
    const next = candidate[index + 1];
    const end = next?.index ?? lines.length;
    const section = extractExplicitOptions(lines.slice(heading.index + 1, end));
    return {
      id: `legacy-${heading.number}`,
      number: heading.number,
      type: section.options.length > 0 ? "single_choice" as const : "text" as const,
      title: heading.title,
      markdown: section.markdown,
      options: section.options,
      allowOther: true,
    };
  });

  return {
    intro: lines.slice(0, first.index).join("\n").trim(),
    outro: "",
    questions,
  };
}

function extractExplicitOptions(lines: string[]): {
  markdown: string;
  options: QuestionnaireOption[];
} {
  const options: QuestionnaireOption[] = [];
  const markdownLines: string[] = [];

  for (const line of lines) {
    const match = EXPLICIT_OPTION.exec(line);
    if (!match) {
      markdownLines.push(line);
      continue;
    }
    options.push({ value: match[1]!, label: match[2]!.trim() });
  }

  if (options.length < 2) {
    return { markdown: lines.join("\n").trim(), options: [] };
  }
  return { markdown: markdownLines.join("\n").trim(), options };
}

function questionnaireScore(lines: string[], group: NumberedHeading[]): number {
  const first = group[0]!;
  const last = group.at(-1)!;
  const lead = lines.slice(Math.max(0, first.index - 12), first.index).join("\n");
  let questionCount = 0;

  for (let index = 0; index < group.length; index += 1) {
    const heading = group[index]!;
    const end = group[index + 1]?.index ?? lines.length;
    const section = `${heading.title}\n${lines.slice(heading.index + 1, end).join("\n")}`;
    if (QUESTION_CUE.test(section)) questionCount += 1;
  }

  const enoughQuestions = questionCount >= Math.ceil(group.length * 0.5);
  const explicitLead = QUESTIONNAIRE_CUE.test(lead);
  if (!enoughQuestions || !explicitLead) return 0;

  return group.length * 10 + questionCount * 2 + 8 + last.number;
}
