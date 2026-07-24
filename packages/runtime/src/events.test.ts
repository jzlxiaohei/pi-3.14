import assert from "node:assert/strict";
import test from "node:test";
import { messageText, messageThinking, projectPiEvent } from "./events.js";

test("projects streaming text without leaking SDK objects", () => {
  assert.deepEqual(
    projectPiEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      },
      10,
    ),
    { type: "text_delta", at: 10, text: "hello" },
  );
});

test("projects streaming thinking deltas", () => {
  assert.deepEqual(
    projectPiEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "plan…" },
      },
      11,
    ),
    { type: "thinking_delta", at: 11, text: "plan…" },
  );
});

test("projects terminal assistant messages", () => {
  assert.deepEqual(
    projectPiEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "done" },
          ],
          stopReason: "stop",
        },
      },
      20,
    ),
    {
      type: "message_end",
      at: 20,
      role: "assistant",
      text: "done",
      thinking: "hidden",
      stopReason: "stop",
    },
  );
});

test("extracts thinking blocks", () => {
  assert.equal(
    messageThinking({
      content: [
        { type: "thinking", thinking: "a" },
        { type: "text", text: "x" },
        { type: "thinking", thinking: "b" },
      ],
    }),
    "a\n\nb",
  );
});

test("extracts text from block and string messages", () => {
  assert.equal(messageText({ content: "plain" }), "plain");
  assert.equal(
    messageText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    "ab",
  );
});
