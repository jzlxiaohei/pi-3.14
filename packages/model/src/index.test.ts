import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalStopReason, toJsonValue } from "./index.js";

test("terminal stop reasons exclude toolUse", () => {
  assert.equal(isTerminalStopReason("stop"), true);
  assert.equal(isTerminalStopReason("aborted"), true);
  assert.equal(isTerminalStopReason("toolUse"), false);
});

test("toJsonValue strips undefined and survives circular values", () => {
  assert.deepEqual(toJsonValue({ value: 1, missing: undefined }), { value: 1 });
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(toJsonValue(circular), "[object Object]");
});
