import {
  parseQuestionnaireEnvelope,
  type QuestionnaireProtocolQuestionType,
} from "../../../../../shared/questionnaire-protocol";

export type QuestionnaireOption = {
  value: string;
  label: string;
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
    return {
      ...(envelope.payload.title ? { title: envelope.payload.title } : {}),
      intro: envelope.intro,
      outro: envelope.outro,
      questions: envelope.payload.questions.map((question, index) => ({
        id: question.id,
        number: index + 1,
        type: question.type,
        title: question.prompt,
        markdown: question.details ?? "",
        options: question.options ?? [],
        allowOther: question.type === "text" || question.allowOther !== false,
      })),
    };
  }

  return parseLegacyQuestionnaire(markdown);
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
