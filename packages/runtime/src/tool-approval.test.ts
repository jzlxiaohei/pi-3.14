import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBashCommand,
  classifyToolApproval,
  createSessionAutoApprove,
  raceApproval,
  splitBashSegments,
  toolNeedsApproval,
  type PiToolApprovalDecision,
} from "./tool-approval.js";

test("toolNeedsApproval skips read-like tools", () => {
  assert.equal(toolNeedsApproval("read"), false);
  assert.equal(toolNeedsApproval("grep"), false);
  assert.equal(toolNeedsApproval("edit"), true);
  assert.equal(toolNeedsApproval("bash"), true);
});

test("classifyToolApproval allows read-like tools", () => {
  assert.equal(classifyToolApproval("read", {}).kind, "allow");
  assert.equal(classifyToolApproval("grep", { pattern: "x" }).kind, "allow");
});

test("classifyBashCommand allows common local commands", () => {
  assert.equal(classifyBashCommand("git status").kind, "allow");
  assert.equal(classifyBashCommand("git diff --stat").kind, "allow");
  assert.equal(classifyBashCommand("pnpm test").kind, "allow");
  assert.equal(classifyBashCommand("ls -la").kind, "allow");
});

test("classifyBashCommand asks for push/network/sudo", () => {
  assert.equal(classifyBashCommand("git push origin main").kind, "ask");
  assert.equal(classifyBashCommand("curl https://example.com").kind, "ask");
  assert.equal(classifyBashCommand("sudo apt update").kind, "ask");
  assert.equal(classifyBashCommand("echo $(whoami)").kind, "ask");
});

test("classifyBashCommand denies destructive root/home rm", () => {
  assert.equal(classifyBashCommand("rm -rf /").kind, "deny");
  assert.equal(classifyBashCommand("rm -rf ~").kind, "deny");
  assert.equal(classifyBashCommand("rm -fr $HOME").kind, "deny");
});

test("classifyBashCommand uses strictest segment for compounds", () => {
  assert.equal(classifyBashCommand("git status && rm -rf /").kind, "deny");
  assert.equal(classifyBashCommand("git status && git push").kind, "ask");
  assert.equal(classifyBashCommand("git status && git diff").kind, "allow");
});

test("splitBashSegments respects simple quotes", () => {
  assert.deepEqual(splitBashSegments('echo "a && b" && ls'), ['echo "a && b"', "ls"]);
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
  assert.deepEqual(
    await approve({ toolCallId: "2", toolName: "bash", args: { command: "git push" } }),
    { approved: true },
  );
  assert.equal(prompts, 1);

  approve.reset();
  assert.equal(approve.unlocked, false);
  await approve({ toolCallId: "3", toolName: "edit", args: {} });
  assert.equal(prompts, 2);
});

test("createSessionAutoApprove setUnlocked enables auto without a prompt", async () => {
  let prompts = 0;
  const approve = createSessionAutoApprove(async () => {
    prompts += 1;
    return { approved: true };
  });
  approve.setUnlocked(true);
  assert.deepEqual(await approve({ toolCallId: "1", toolName: "edit", args: {} }), {
    approved: true,
  });
  assert.equal(prompts, 0);
});

test("createSessionAutoApprove never auto-approves deny circuit breakers", async () => {
  const approve = createSessionAutoApprove(async () => ({ approved: true }));
  approve.setUnlocked(true);
  const decision = await approve({
    toolCallId: "1",
    toolName: "bash",
    args: { command: "rm -rf /" },
  });
  assert.equal(decision.approved, false);
  assert.match(decision.reason ?? "", /root|home/i);
});

test("createSessionAutoApprove auto-allows safe bash without prompting", async () => {
  let prompts = 0;
  const approve = createSessionAutoApprove(async () => {
    prompts += 1;
    return { approved: true };
  });
  const decision = await approve({
    toolCallId: "1",
    toolName: "bash",
    args: { command: "git status" },
  });
  assert.equal(decision.approved, true);
  assert.equal(prompts, 0);
  assert.equal(approve.unlocked, false);
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
