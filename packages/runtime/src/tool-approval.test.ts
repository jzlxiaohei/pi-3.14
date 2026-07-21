import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionAutoApprove,
  raceApproval,
  toolNeedsApproval,
  type PiToolApprovalDecision,
} from "./tool-approval.js";

test("toolNeedsApproval skips read-like tools", () => {
  assert.equal(toolNeedsApproval("read"), false);
  assert.equal(toolNeedsApproval("grep"), false);
  assert.equal(toolNeedsApproval("edit"), true);
  assert.equal(toolNeedsApproval("bash"), true);
});

test("createSessionAutoApprove unlocks after first allow", async () => {
  let prompts = 0;
  const approve = createSessionAutoApprove(async () => {
    prompts += 1;
    return { approved: true };
  });

  assert.equal(approve.unlocked, false);
  assert.deepEqual(await approve({ toolCallId: "1", toolName: "edit", args: {} }), {
    approved: true,
  });
  assert.equal(approve.unlocked, true);
  assert.deepEqual(await approve({ toolCallId: "2", toolName: "bash", args: {} }), {
    approved: true,
  });
  assert.equal(prompts, 1);

  approve.reset();
  assert.equal(approve.unlocked, false);
  await approve({ toolCallId: "3", toolName: "edit", args: {} });
  assert.equal(prompts, 2);
});

test("createSessionAutoApprove stays locked after deny", async () => {
  let prompts = 0;
  const approve = createSessionAutoApprove(async () => {
    prompts += 1;
    return { approved: false, reason: "no" };
  });

  const decision = await approve({ toolCallId: "1", toolName: "edit", args: {} });
  assert.equal(decision.approved, false);
  assert.equal(approve.unlocked, false);
  await approve({ toolCallId: "2", toolName: "edit", args: {} });
  assert.equal(prompts, 2);
});

test("raceApproval fails closed when aborted", async () => {
  const controller = new AbortController();
  const pending = raceApproval(
    () =>
      new Promise<PiToolApprovalDecision>(() => {
        // never resolves
      }),
    { toolCallId: "1", toolName: "edit", args: {} },
    controller.signal,
  );
  controller.abort();
  assert.deepEqual(await pending, { approved: false, reason: "Aborted" });
});
