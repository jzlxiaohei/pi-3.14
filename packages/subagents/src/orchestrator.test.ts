import assert from "node:assert/strict";
import test from "node:test";
import type { PiHostEvent, PiTurnResult } from "@pi-3.14/model";
import { SubagentOrchestrator } from "./orchestrator.js";
import type { SubagentExecution, SubagentExecutor, SubagentInput } from "./types.js";

interface PendingExecution {
  input: SubagentInput;
  resolve: (result: PiTurnResult) => void;
  aborted: boolean;
}

class ControlledExecutor implements SubagentExecutor {
  readonly kind = "controlled";
  readonly pending: PendingExecution[] = [];

  async start(input: SubagentInput): Promise<SubagentExecution> {
    let resolve!: (result: PiTurnResult) => void;
    const result = new Promise<PiTurnResult>((done) => {
      resolve = done;
    });
    const pending: PendingExecution = { input, resolve, aborted: false };
    this.pending.push(pending);
    return {
      events: emptyEvents(),
      result,
      abort: async () => {
        pending.aborted = true;
        resolve(piResult("aborted", ""));
      },
      dispose: async () => {},
    };
  }
}

test("enforces max concurrency and starts queued work in order", async () => {
  const executor = new ControlledExecutor();
  const orchestrator = new SubagentOrchestrator({
    executor,
    maxConcurrency: 1,
    createId: idSequence(),
  });
  const first = orchestrator.spawn({ prompt: "first" });
  const second = orchestrator.spawn({ prompt: "second" });
  await tick();
  assert.equal(executor.pending.length, 1);
  assert.equal(executor.pending[0]?.input.prompt, "first");

  executor.pending[0]?.resolve(piResult("stop", "one"));
  assert.equal((await first.result).text, "one");
  await tick();
  assert.equal(executor.pending.length, 2);
  assert.equal(executor.pending[1]?.input.prompt, "second");

  executor.pending[1]?.resolve(piResult("stop", "two"));
  assert.equal((await second.result).text, "two");
  await orchestrator.dispose();
});

test("aborts queued work without starting an executor", async () => {
  const executor = new ControlledExecutor();
  const orchestrator = new SubagentOrchestrator({
    executor,
    maxConcurrency: 1,
    createId: idSequence(),
  });
  const first = orchestrator.spawn({ prompt: "first" });
  const queued = orchestrator.spawn({ prompt: "queued" });
  await tick();

  await queued.abort();
  assert.equal((await queued.result).status, "cancelled");
  assert.equal(executor.pending.length, 1);

  executor.pending[0]?.resolve(piResult("stop", "done"));
  await first.result;
  await orchestrator.dispose();
});

test("propagates abort to a running executor", async () => {
  const executor = new ControlledExecutor();
  const orchestrator = new SubagentOrchestrator({ executor, createId: idSequence() });
  const handle = orchestrator.spawn({ prompt: "running" });
  await tick();

  await handle.abort();
  assert.equal(executor.pending[0]?.aborted, true);
  assert.equal((await handle.result).status, "cancelled");
  await orchestrator.dispose();
});

async function* emptyEvents(): AsyncIterable<PiHostEvent> {}

function piResult(stopReason: PiTurnResult["stopReason"], text: string): PiTurnResult {
  return {
    stopReason,
    text,
    sessionId: "session",
    sessionPath: null,
    leafEntryId: null,
  };
}

function idSequence(): () => string {
  let value = 0;
  return () => `subagent-${++value}`;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
