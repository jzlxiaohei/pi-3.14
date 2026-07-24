import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateContextComposition } from "./composition.js";

describe("estimateContextComposition", () => {
  it("splits estimated tokens by role using chars/4", () => {
    const result = estimateContextComposition({
      systemPrompt: "abcd", // 1 token
      messages: [
        { role: "user", text: "abcdefgh" }, // 2
        { role: "assistant", text: "abcdefghijkl" }, // 3
        { role: "tool", text: "abcd" }, // 1
      ],
    });

    assert.equal(result.method, "chars/4");
    assert.equal(result.totalEstimatedTokens, 7);
    assert.deepEqual(
      result.buckets.map((b) => [b.id, b.estimatedTokens]),
      [
        ["system", 1],
        ["user", 2],
        ["assistant", 3],
        ["tool", 1],
      ],
    );
    const sumPercent = result.buckets.reduce((s, b) => s + b.percent, 0);
    assert.ok(Math.abs(sumPercent - 100) < 0.01);
  });
});
