import assert from "node:assert/strict";
import test from "node:test";
import { messageText, projectPiEvent } from "./events.js";

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
      stopReason: "stop",
    },
  );
});

test("extracts text from block and string messages", () => {
  assert.equal(messageText({ content: "plain" }), "plain");
  assert.equal(
    messageText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    "ab",
  );
});
