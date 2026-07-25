import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHostSystemPromptOptions } from "./host-system-prompt";

const PRODUCT = ["questionnaire body"];

test("empty role → no override, product appends only", () => {
  const result = buildHostSystemPromptOptions({
    rolePrompt: "",
    productAppends: PRODUCT,
  });
  assert.equal(result.systemPromptOverride, undefined);
  assert.deepEqual(result.appendSystemPrompt, PRODUCT);
});

test("whitespace-only role → fallback like empty", () => {
  const result = buildHostSystemPromptOptions({
    rolePrompt: "  \n\t  ",
    productAppends: PRODUCT,
  });
  assert.equal(result.systemPromptOverride, undefined);
  assert.deepEqual(result.appendSystemPrompt, PRODUCT);
});

test("non-empty role → override returns trimmed role", () => {
  const result = buildHostSystemPromptOptions({
    rolePrompt: "  You are a grill facilitator.\n  ",
    productAppends: PRODUCT,
  });
  assert.equal(typeof result.systemPromptOverride, "function");
  assert.equal(result.systemPromptOverride?.(undefined), "You are a grill facilitator.");
  assert.deepEqual(result.appendSystemPrompt, PRODUCT);
});

test("product appends are trimmed and empty parts dropped", () => {
  const result = buildHostSystemPromptOptions({
    rolePrompt: "role",
    productAppends: ["  a  ", "", "  ", "b"],
  });
  assert.deepEqual(result.appendSystemPrompt, ["a", "b"]);
});
