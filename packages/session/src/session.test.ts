import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSessionContext,
  parseSessionEntries,
  SessionManager,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { analyzePiSession } from "./analysis.js";
import { buildPiContextProjection } from "./context.js";
import {
  buildContextGraph,
  buildExecutionGraph,
  buildStructureGraph,
} from "./graphs.js";
import { readPiSessionFile } from "./node.js";
import { parsePiSessionJsonl } from "./parser.js";

test("parses header, unknown entries, branches, and an incomplete live tail", () => {
  const content = [
    header({ parentSession: "/tmp/parent.jsonl" }),
    entry("message", "u1", null, {
      message: { role: "user", content: "root", timestamp: 1 },
    }),
    entry("future_entry", "x1", "u1", { value: 42 }),
    entry("message", "a1", "x1", {
      message: assistant("main", "stop", 2),
    }),
    entry("message", "a2", "u1", {
      message: assistant("branch", "stop", 3),
    }),
  ].join("\n");
  const snapshot = parsePiSessionJsonl(`${content}\n{"type":"message"`);

  assert.equal(snapshot.header?.parentSessionPath, "/tmp/parent.jsonl");
  assert.equal(snapshot.entries.find((item) => item.id === "x1")?.known, false);
  assert.deepEqual(snapshot.activePathEntryIds, ["u1", "a2"]);
  assert.equal(snapshot.leafId, "a2");
  assert.equal(snapshot.diagnostics.some((item) => item.code === "incomplete_tail"), true);
  assert.equal(snapshot.trailingFragment, '{"type":"message"');
});

test("reports malformed middle lines and structural corruption", () => {
  const snapshot = parsePiSessionJsonl(
    [
      header(),
      entry("message", "one", "missing", {
        message: { role: "user", content: "hello", timestamp: 1 },
      }),
      "{bad json",
      entry("message", "one", null, {
        message: assistant("duplicate", "stop", 2),
      }),
    ].join("\n") + "\n",
  );
  assert.deepEqual(
    new Set(snapshot.diagnostics.map((item) => item.code)),
    new Set(["missing_parent", "multiple_roots", "malformed_line", "duplicate_entry_id"]),
  );
});

test("marks legacy v1 sessions for PI-managed migration", () => {
  const legacyHeader = JSON.stringify({
    type: "session",
    id: "legacy",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
  });
  const snapshot = parsePiSessionJsonl(`${legacyHeader}\n`);
  assert.equal(
    snapshot.diagnostics.some((item) => item.code === "unsupported_version"),
    true,
  );
});

test("projects compaction-aware context and matches PI context semantics", () => {
  const content = compactionFixture();
  const snapshot = parsePiSessionJsonl(content, { allowIncompleteTail: false });
  const projection = buildPiContextProjection(snapshot);
  assert.deepEqual(projection.excludedPathEntryIds, ["u1", "a1", "t1", "a2"]);
  assert.deepEqual(projection.effectiveEntryIds, ["c1", "u-old", "a-old", "u2", "a3"]);
  assert.deepEqual(
    projection.messages.map((message) => [message.role, message.text]),
    [
      ["compaction", "earlier summary"],
      ["user", "keep me"],
      ["assistant", "kept answer"],
      ["user", "recent"],
      ["assistant", "final"],
    ],
  );
  assert.deepEqual(projection.recoverability.unavailableFromJsonl, [
    "systemPrompt",
    "tools",
    "skills",
  ]);

  const parsed = parseSessionEntries(content);
  const entries = parsed.filter((item): item is SessionEntry => item.type !== "session");
  const official = buildSessionContext(entries, "a3").messages;
  assert.deepEqual(
    official.map((message) => [message.role, officialText(message)]),
    [
      ["compactionSummary", "earlier summary"],
      ["user", "keep me"],
      ["assistant", "kept answer"],
      ["user", "recent"],
      ["assistant", "final"],
    ],
  );
});

test("builds structure, execution, and context graph projections", () => {
  const snapshot = parsePiSessionJsonl(compactionFixture(), { allowIncompleteTail: false });
  const structure = buildStructureGraph(snapshot);
  const execution = buildExecutionGraph(snapshot);
  const context = buildContextGraph(snapshot);

  assert.equal(structure.projection, "structure");
  assert.equal(structure.nodes.length, snapshot.entries.length);
  assert.equal(execution.nodes.some((node) => node.kind === "toolCall"), true);
  assert.equal(execution.edges.some((edge) => edge.kind === "result"), true);
  assert.equal(context.nodes.find((node) => node.entryId === "u1")?.inEffectiveContext, false);
  assert.equal(context.nodes.find((node) => node.entryId === "u2")?.inEffectiveContext, true);
  assert.equal(context.edges.some((edge) => edge.kind === "keepsFrom"), true);
});

test("analyzes turns, tools, branches, models, and exact usage", () => {
  const snapshot = parsePiSessionJsonl(compactionFixture(), { allowIncompleteTail: false });
  const analysis = analyzePiSession(snapshot);

  assert.equal(analysis.turnCount, 3);
  assert.equal(analysis.assistantCallCount, 4);
  assert.equal(analysis.toolCallCount, 1);
  assert.equal(analysis.toolErrorCount, 0);
  assert.equal(analysis.compactionCount, 1);
  assert.equal(analysis.usage.totalTokens, 46);
  assert.ok(Math.abs(analysis.usage.cost - 0.46) < 1e-9);
  assert.equal(analysis.model?.id, "test-model");
  assert.equal(analysis.tools[0]?.resultEntryId, "t1");
  assert.equal(analysis.tools[0]?.durationMsEstimate, 1_000);
  assert.equal(analysis.tools[0]?.timingBasis, "assistantMessageToToolResult");
});

test("node reader loads a JSONL file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-session-"));
  const path = join(root, "session.jsonl");
  try {
    await writeFile(path, compactionFixture(), "utf8");
    const snapshot = await readPiSessionFile(path);
    assert.equal(snapshot.header?.id, "session-1");
    assert.equal(snapshot.leafId, "a3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads JSONL generated by the real PI SessionManager", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-session-manager-"));
  try {
    const manager = SessionManager.create(root, root);
    const userEntryId = manager.appendMessage({
      role: "user",
      content: "hello from PI",
      timestamp: Date.now(),
    });
    manager.appendModelChange("test-provider", "test-model");
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "test",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const path = manager.getSessionFile();
    assert.ok(path);

    const snapshot = await readPiSessionFile(path);
    assert.equal(snapshot.header?.id, manager.getSessionId());
    assert.equal(snapshot.entries[0]?.id, userEntryId);
    assert.equal(snapshot.leafId, manager.getLeafId());
    assert.equal(snapshot.diagnostics.some((item) => item.severity === "error"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function compactionFixture(): string {
  return [
    header(),
    entry("message", "u1", null, {
      message: { role: "user", content: "start", timestamp: 1_000 },
    }),
    entry("message", "a1", "u1", {
      message: assistant("calling", "toolUse", 2_000, {
        content: [
          { type: "text", text: "calling" },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
        ],
        usage: usage(10, 2, 0.12),
      }),
    }),
    entry("message", "t1", "a1", {
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "file" }],
        isError: false,
        timestamp: 3_000,
      },
    }),
    entry("message", "a2", "t1", {
      message: assistant("first done", "stop", 4_000, { usage: usage(8, 2, 0.1) }),
    }),
    entry("message", "u-old", "a2", {
      message: { role: "user", content: "keep me", timestamp: 5_000 },
    }),
    entry("message", "a-old", "u-old", {
      message: assistant("kept answer", "stop", 6_000, { usage: usage(9, 3, 0.12) }),
    }),
    entry("compaction", "c1", "a-old", {
      summary: "earlier summary",
      firstKeptEntryId: "u-old",
      tokensBefore: 30,
    }),
    entry("message", "u2", "c1", {
      message: { role: "user", content: "recent", timestamp: 7_000 },
    }),
    entry("message", "a3", "u2", {
      message: assistant("final", "stop", 8_000, { usage: usage(9, 3, 0.12) }),
    }),
  ].join("\n") + "\n";
}

function header(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: "session-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/project",
    ...extra,
  });
}

function entry(
  type: string,
  id: string,
  parentId: string | null,
  value: Record<string, unknown>,
): string {
  const seconds = id === "u1" ? 1 : Number.parseInt(id.replace(/\D/g, ""), 10) || 2;
  return JSON.stringify({
    type,
    id,
    parentId,
    timestamp: `2026-01-01T00:00:${String(seconds).padStart(2, "0")}.000Z`,
    ...value,
  });
}

function assistant(
  text: string,
  stopReason: string,
  timestamp: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "test",
    model: "test-model",
    usage: usage(0, 0, 0),
    stopReason,
    timestamp,
    ...overrides,
  };
}

function usage(input: number, output: number, cost: number): Record<string, unknown> {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function officialText(message: unknown): string {
  const value = message as { content?: unknown; summary?: unknown };
  if (typeof value.summary === "string") return value.summary;
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .map((block) => {
      const item = block as { type?: string; text?: string };
      return item.type === "text" ? item.text ?? "" : "";
    })
    .join("\n");
}
