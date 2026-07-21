import assert from "node:assert/strict";
import test from "node:test";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { repairOrphanedToolCalls } from "./repair-orphaned-tools.js";

type BranchEntry = {
  id: string;
  parentId?: string | null;
  type?: string;
  message?: {
    role?: string;
    stopReason?: string;
    content?: unknown;
  };
};

function mockSessionManager(branch: BranchEntry[]) {
  let leaf = branch.at(-1)?.id ?? null;
  const manager = {
    getBranch: () => branch,
    branch(entryId: string) {
      leaf = entryId;
    },
    resetLeaf() {
      leaf = null;
    },
    getLeafId: () => leaf,
  };
  return manager as unknown as SessionManager & { getLeafId: () => string | null };
}

test("repairOrphanedToolCalls branches before aborted tool assistant", () => {
  const manager = mockSessionManager([
    {
      id: "user-1",
      parentId: null,
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    },
    {
      id: "assistant-1",
      parentId: "user-1",
      type: "message",
      message: {
        role: "assistant",
        stopReason: "aborted",
        content: [{ type: "toolCall", id: "t1", name: "edit", arguments: {} }],
      },
    },
    {
      id: "tool-1",
      parentId: "assistant-1",
      type: "message",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "cancelled" }],
      },
    },
  ]);

  assert.equal(repairOrphanedToolCalls(manager), 1);
  assert.equal(manager.getLeafId(), "user-1");
});

test("repairOrphanedToolCalls is a no-op for healthy branches", () => {
  const manager = mockSessionManager([
    {
      id: "assistant-1",
      parentId: null,
      type: "message",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "done" }],
      },
    },
  ]);

  assert.equal(repairOrphanedToolCalls(manager), 0);
  assert.equal(manager.getLeafId(), "assistant-1");
});

test("repairOrphanedToolCalls resets leaf when aborted assistant is root", () => {
  const manager = mockSessionManager([
    {
      id: "assistant-1",
      parentId: null,
      type: "message",
      message: {
        role: "assistant",
        stopReason: "error",
        content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
      },
    },
  ]);

  assert.equal(repairOrphanedToolCalls(manager), 1);
  assert.equal(manager.getLeafId(), null);
});
