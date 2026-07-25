/**
 * Pure helper: assemble host resource-loader system prompt options from
 * Role Prompt + product appends (ADR-0004 / agent-role-prompt-v1).
 */

export type HostSystemPromptLoaderOptions = {
  /** When set, PI uses this as customPrompt (replaces default base). */
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  /** Product + optional loader appends; v1 caller passes questionnaire only. */
  appendSystemPrompt: string[];
};

export function buildHostSystemPromptOptions(input: {
  rolePrompt: string;
  productAppends: readonly string[];
}): HostSystemPromptLoaderOptions {
  const role = input.rolePrompt.trim();
  const appendSystemPrompt = input.productAppends.map((s) => s.trim()).filter(Boolean);
  if (role.length > 0) {
    return {
      systemPromptOverride: () => role,
      appendSystemPrompt,
    };
  }
  return { appendSystemPrompt };
}
