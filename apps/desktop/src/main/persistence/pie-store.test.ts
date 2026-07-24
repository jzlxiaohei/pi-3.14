import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openPieStore } from "./pie-store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pie-store-"));
  const sessionA = join(root, "a.jsonl");
  const sessionB = join(root, "b.jsonl");
  writeFileSync(sessionA, "{}\n");
  writeFileSync(sessionB, "{}\n");
  return {
    root,
    sessionA,
    sessionB,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function legacyTask(id: string, sessionPath: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    cwd: "/workspace",
    sessionPath,
    sessionId: `session-${id}`,
    status: "idle",
    createdAt: id === "a" ? 1 : 2,
    updatedAt: id === "a" ? 3 : 4,
    ...overrides,
  };
}

test("migrates legacy Tasks once, preserves order, and retains a permanent copy", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.root, "pie-workspace-tasks.json"),
      JSON.stringify({
        selectedTaskId: "b",
        tasks: [
          legacyTask("a", f.sessionA, { workflow: { playbookId: "bugfix", stepId: "x", steps: [] } }),
          legacyTask("b", f.sessionB, { status: "running", archivedAt: 9 }),
        ],
      }),
    );

    let store = openPieStore(f.root);
    const first = await store.bootstrap();
    assert.deepEqual(first.rootTasks.map((task) => task.id), ["a", "b"]);
    assert.equal(first.rootTasks[0]?.workflow?.playbookId, "bugfix");
    assert.equal(first.rootTasks[1]?.status, "interrupted");
    assert.equal(first.activeTask?.id, "a", "archived legacy selection falls back to active Task");
    assert.ok(readdirSync(f.root).some((name) => name.startsWith("pie-workspace-tasks.pre-sqlite-")));
    store.close();

    store = openPieStore(f.root);
    assert.equal((await store.listRootTasks()).length, 2);
    store.close();
  } finally {
    f.cleanup();
  }
});

test("falls back to the rolling backup and refuses two invalid legacy files", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "pie-workspace-tasks.json"), "{");
    writeFileSync(
      join(f.root, "pie-workspace-tasks.json.bak"),
      JSON.stringify({ selectedTaskId: "a", tasks: [legacyTask("a", f.sessionA)] }),
    );
    const store = openPieStore(f.root);
    assert.equal((await store.listRootTasks())[0]?.id, "a");
    store.close();
  } finally {
    f.cleanup();
  }

  const invalid = fixture();
  try {
    writeFileSync(join(invalid.root, "pie-workspace-tasks.json"), "{");
    writeFileSync(join(invalid.root, "pie-workspace-tasks.json.bak"), "[]");
    assert.throws(() => openPieStore(invalid.root), /both invalid/);
  } finally {
    invalid.cleanup();
  }
});

test("orders Root Tasks and archives/restores a complete Task subtree", async () => {
  const f = fixture();
  try {
    const store = openPieStore(f.root);
    const rootA = await store.create({
      cwd: "/workspace",
      sessionId: "root-a",
      sessionPath: f.sessionA,
      title: "Root A",
    });
    const rootB = await store.create({
      cwd: "/workspace",
      sessionId: "root-b",
      sessionPath: f.sessionB,
      title: "Root B",
    });
    const childPath = join(f.root, "child.jsonl");
    writeFileSync(childPath, "{}\n");
    const child = await store.create({
      cwd: "/workspace",
      sessionId: "child",
      sessionPath: childPath,
      title: "Child",
      parentTaskId: rootA.id,
    });
    assert.equal(child.rootTaskId, rootA.id);

    await store.moveRootTask({ taskId: rootA.id, beforeTaskId: rootB.id });
    assert.deepEqual((await store.listRootTasks()).map((task) => task.id), [rootA.id, rootB.id]);

    const archived = await store.archiveTree(rootA.id);
    assert.equal((await store.get(rootA.id))?.archivedAt !== undefined, true);
    assert.equal((await store.get(child.id))?.archivedAt !== undefined, true);
    assert.equal(archived.activeTaskId, rootB.id, "active Child falls back to the next Root Task");

    await store.restoreTree(rootA.id);
    assert.equal((await store.get(rootA.id))?.archivedAt, undefined);
    assert.equal((await store.get(child.id))?.archivedAt, undefined);
    store.close();
  } finally {
    f.cleanup();
  }
});

test("persists typed preferences, drafts, and exact review fingerprints", async () => {
  const f = fixture();
  try {
    const store = openPieStore(f.root);
    const task = await store.create({
      cwd: "/workspace",
      sessionId: "prefs",
      sessionPath: f.sessionA,
    });
    await store.importLegacyBrowserPreferences({ tasksOpen: false, inspectorOpen: true });
    await store.importLegacyBrowserPreferences({ tasksOpen: true });
    const preferences = await store.updateAppPreferences({ tasksWidth: 999, theme: "dark" });
    assert.equal(preferences.tasksOpen, false, "legacy browser preferences import once");
    assert.equal(preferences.inspectorOpen, true);
    assert.equal(preferences.tasksWidth, 372);
    assert.equal(preferences.theme, "dark");

    await store.saveDraft(task.id, "draft");
    assert.equal(await store.getDraft(task.id), "draft");

    await store.setReviewedFile({
      cwd: "/workspace",
      baseRef: "HEAD",
      path: "a.ts",
      fingerprint: "one",
    });
    assert.deepEqual(
      await store.getReviewedPaths({
        cwd: "/workspace",
        baseRef: "HEAD",
        files: [{ path: "a.ts", fingerprint: "one" }],
      }),
      ["a.ts"],
    );
    assert.deepEqual(
      await store.getReviewedPaths({
        cwd: "/workspace",
        baseRef: "HEAD",
        files: [{ path: "a.ts", fingerprint: "two" }],
      }),
      [],
    );
    assert.deepEqual(
      await store.getReviewedPaths({
        cwd: "/workspace",
        baseRef: "HEAD",
        files: [{ path: "a.ts", fingerprint: "one" }],
      }),
      [],
      "a mismatched fingerprint removes stale reviewed state",
    );
    store.close();
  } finally {
    f.cleanup();
  }
});
