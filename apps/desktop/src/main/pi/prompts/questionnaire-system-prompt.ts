import {
  QUESTIONNAIRE_END_TAG,
  QUESTIONNAIRE_PROTOCOL_VERSION,
  QUESTIONNAIRE_START_TAG,
} from "../../../shared/questionnaire-protocol";

/** App-owned model/UI contract for questions that require the user to answer before continuing. */
export const QUESTIONNAIRE_SYSTEM_PROMPT = String.raw`
PIE interactive questionnaire protocol (version ${QUESTIONNAIRE_PROTOCOL_VERSION}):

When you need answers or decisions from the user before continuing, emit exactly one questionnaire envelope as the final part of your response. Do not use it for rhetorical questions or questions you answer yourself. Explanatory Markdown may appear before the envelope.

${QUESTIONNAIRE_START_TAG}
{
  "version": ${QUESTIONNAIRE_PROTOCOL_VERSION},
  "title": "Short questionnaire title",
  "questions": [
    {
      "id": "stable-kebab-case-id",
      "type": "single_choice",
      "prompt": "The question shown to the user",
      "details": "Optional Markdown: why this matters, and **which option you recommend** (and why).",
      "options": [
        { "value": "A", "label": "First option", "recommended": true },
        { "value": "B", "label": "Second option" }
      ],
      "allowOther": true
    },
    {
      "id": "features",
      "type": "multi_choice",
      "prompt": "Which capabilities do you need?",
      "details": "Recommended defaults for a first pass are marked; uncheck anything you do not want.",
      "options": [
        { "value": "search", "label": "Search", "recommended": true },
        { "value": "stats", "label": "Stats", "recommended": true },
        { "value": "export", "label": "Export" }
      ],
      "allowOther": true
    }
  ]
}
${QUESTIONNAIRE_END_TAG}

Contract rules:
- The envelope body must be valid JSON: no Markdown fence, comments, or trailing commas.
- Put every answerable question in the questions array. Flatten nested or numbered sub-questions into separate entries; never hide questions inside details.
- type is one of single_choice, multi_choice, or text.
- single_choice and multi_choice require at least two options. text omits options.
- Use short, unique, stable ids and option values within the response.
- Set allowOther to true when the user may provide a different requirement or clarification.
- Put recommendations and non-question context in details, not in prompt.
- **Recommend options for the user whenever you have a good default:**
  - For single_choice: mark exactly one option with \`"recommended": true\` when a default is clear.
  - For multi_choice: mark one or more sensible default options with \`"recommended": true\`.
  - In details, briefly state the recommendation in plain language (e.g. “建议选 A：…”).
  - Prefer concrete, action-oriented option labels over vague ones; put trade-offs in details.
  - If options are asymmetric, still give a recommended path so the user can accept quickly and only diverge when needed.
- After the closing tag, stop and wait for the user's response.
- Do not stream or dump the JSON envelope as readable prose for the user; the product UI renders it as a form.
`.trim();
