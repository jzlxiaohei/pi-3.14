import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PiSessionSnapshot } from "@pi-3.14/session";
import {
  buildSessionMapStructure,
  resolveSessionMapLeaf,
} from "./session-map";

function entry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant" | "toolResult",
  text: string,
  line: number,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-01-01T00:00:${String(line).padStart(2, "0")}.000Z`,
    known: true,
    raw: {
      type: "message",
      id,
      parentId,
      message: {
        role,
        content: [{ type: "text", text }],
      },
    },
    sourceLine: line,
  };
}

function snapshot(entries: ReturnType<typeof entry>[], leafId: string): PiSessionSnapshot {
  const active: string[] = [];
  let cursor: string | null = leafId;
  const byId = new Map(entries.map((e) => [e.id, e]));
  while (cursor) {
    active.unshift(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return {
    format: "pi-session",
    header: {
      type: "session",
      version: 3,
      id: "sess-test",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp",
      parentSessionPath: null,
      raw: {},
      sourceLine: 1,
    },
    entries,
    leafId,
    rootIds: entries.filter((e) => e.parentId === null).map((e) => e.id),
    activePathEntryIds: active,
    diagnostics: [],
    trailingFragment: "",
  };
}

describe("session-map", () => {
  it("builds turn graph with fork edges between user turns", () => {
    // u1 -> a1 -> u2a
    //          -> u2b (sibling branch)
    const entries = [
      entry("u1", null, "user", "hello", 2),
      entry("a1", "u1", "assistant", "hi", 3),
      entry("u2a", "a1", "user", "path A", 4),
      entry("a2a", "u2a", "assistant", "on A", 5),
      entry("u2b", "a1", "user", "path B", 6),
      entry("a2b", "u2b", "assistant", "on B", 7),
    ];
    const snap = snapshot(entries, "a2a");
    const turn = buildSessionMapStructure(snap, "turn");
    assert.equal(turn.nodes.filter((n) => n.kind === "turn").length, 3);
    const u1 = turn.nodes.find((n) => n.entryId === "u1");
    assert.ok(u1);
    assert.equal(u1.isFork, true);
    assert.equal(u1.childCount, 2);
    assert.ok(u1.onActivePath);
    const u2b = turn.nodes.find((n) => n.entryId === "u2b");
    assert.ok(u2b);
    assert.equal(u2b.onActivePath, false);
    assert.ok(turn.edges.some((e) => e.source === "turn:u1" && e.target === "turn:u2a"));
    assert.ok(turn.edges.some((e) => e.source === "turn:u1" && e.target === "turn:u2b"));
  });

  it("resolves leaf to deepest active path entry in subtree", () => {
    const entries = [
      entry("u1", null, "user", "hello", 2),
      entry("a1", "u1", "assistant", "hi", 3),
      entry("u2", "a1", "user", "next", 4),
      entry("a2", "u2", "assistant", "done", 5),
    ];
    const snap = snapshot(entries, "a2");
    assert.equal(resolveSessionMapLeaf(snap, "u1"), "a2");
    assert.equal(resolveSessionMapLeaf(snap, "u2"), "a2");
  });

  it("resolves off-path subtree to append tip", () => {
    const entries = [
      entry("u1", null, "user", "hello", 2),
      entry("a1", "u1", "assistant", "hi", 3),
      entry("u2a", "a1", "user", "A", 4),
      entry("a2a", "u2a", "assistant", "A reply", 5),
      entry("u2b", "a1", "user", "B", 6),
      entry("a2b", "u2b", "assistant", "B reply", 7),
    ];
    const snap = snapshot(entries, "a2a");
    assert.equal(resolveSessionMapLeaf(snap, "u2b"), "a2b");
  });
});
