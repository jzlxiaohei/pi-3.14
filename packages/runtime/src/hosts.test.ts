import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createEmbeddedPiHost } from "./embedded.js";
import { createRpcPiHost } from "./rpc.js";

test("embedded host creates isolated in-memory runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-3.14-runtime-embedded-"));
  const host = await createEmbeddedPiHost({
    cwd: root,
    agentDir: join(root, "agent"),
    sessionManager: SessionManager.inMemory(root),
  });
  try {
    const state = await host.getState();
    assert.ok(state.sessionId);
    assert.equal(state.sessionPath, null);
    assert.equal(host.capabilities.processIsolation, false);
  } finally {
    await host.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("rpc host starts and stops a real isolated PI process", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-3.14-runtime-rpc-"));
  const host = await createRpcPiHost({
    cwd: root,
    args: ["--no-session"],
    turnTimeoutMs: 5_000,
  });
  try {
    const state = await host.getState();
    assert.ok(state.sessionId);
    assert.equal(state.sessionPath, null);
    assert.equal(host.capabilities.processIsolation, true);
  } finally {
    await host.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("rpc host reports a silent child-process exit", async () => {
  const host = await createRpcPiHost({
    cliPath: fileURLToPath(new URL("./fixtures/rpc-exit.mjs", import.meta.url)),
    turnTimeoutMs: 2_000,
    processCheckIntervalMs: 10,
  });
  try {
    const result = await host.prompt("exit").result;
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /exited.*23/i);
  } finally {
    await host.dispose();
  }
});

test(
  "rpc host completes a real model turn",
  { skip: process.env.PI_RUNTIME_LIVE_TEST !== "1", timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-3.14-runtime-live-"));
    const host = await createRpcPiHost({
      cwd: root,
      args: ["--no-session", "--no-tools", "--no-extensions", "--no-skills"],
      turnTimeoutMs: 90_000,
    });
    try {
      const turn = host.prompt("Reply with exactly PI_RUNTIME_OK and nothing else.");
      for await (const _event of turn.events) {
        // Drain the stream to exercise event delivery and settlement.
      }
      const result = await turn.result;
      assert.equal(result.stopReason, "stop");
      assert.match(result.text, /PI_RUNTIME_OK/);
    } finally {
      await host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
