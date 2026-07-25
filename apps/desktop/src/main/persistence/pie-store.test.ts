import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { openPieStore } from "./pie-store";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pie-store-"));
  roots.push(root);
  return root;
}

test("opens v2 catalog and seeds system templates", async () => {
  const store = openPieStore(tempRoot());
  const boot = await store.bootstrap();
  assert.equal(boot.tasks.length, 0);
  assert.equal(boot.activeTaskId, null);
  assert.equal(boot.activeAgentId, null);
  const templates = await store.listTemplates();
  assert.equal(templates.length, 8);
  store.close();
});

test("createTask does not create agents; createAgent attaches session", async () => {
  const store = openPieStore(tempRoot());
  const task = await store.createTask({ cwd: "/workspace", title: "Demo" });
  assert.equal((await store.listAgents(task.id)).length, 0);
  const agent = await store.createAgent({
    taskId: task.id,
    name: "Chat",
    systemPrompt: "",
    sessionId: "sess-1",
    sessionPath: "/tmp/fake.jsonl",
  });
  assert.equal(agent.taskId, task.id);
  assert.equal(agent.rolePromptConfirmedAt, null);
  assert.equal((await store.listAgents(task.id)).length, 1);

  const confirmed = await store.updateAgent(agent.id, { confirmRolePrompt: true });
  assert.ok(confirmed?.rolePromptConfirmedAt != null);

  store.close();
});

test("schema migrates to v3 with role_prompt_confirmed_at", async () => {
  const store = openPieStore(tempRoot());
  const task = await store.createTask({ cwd: "/workspace", title: "Mig" });
  const agent = await store.createAgent({
    taskId: task.id,
    name: "Chat",
    systemPrompt: "role",
    sessionId: "sess-2",
    sessionPath: "/tmp/fake-2.jsonl",
  });
  assert.equal(agent.rolePromptConfirmedAt, null);
  store.close();
});

test("system template seed is insert-only and survives edits", async () => {
  const root = tempRoot();
  const store = openPieStore(root);
  const templates = await store.listTemplates();
  assert.equal(templates.length, 8);
  const target = templates[0]!;
  assert.equal(target.source, "system");
  assert.equal(target.description, "");

  const updated = await store.updateTemplate({
    id: target.id,
    name: "custom-system-name",
    description: "local note",
    systemPrompt: "custom role",
  });
  assert.ok(updated);
  assert.equal(updated!.name, "custom-system-name");
  assert.equal(updated!.description, "local note");
  assert.equal(updated!.systemPrompt, "custom role");
  store.close();

  const reopened = openPieStore(root);
  const again = await reopened.getTemplate(target.id);
  assert.equal(again?.name, "custom-system-name");
  assert.equal(again?.systemPrompt, "custom role");
  assert.equal(again?.description, "local note");
  reopened.close();
});

test("user template CRUD, duplicate, delete clears agent templateId", async () => {
  const store = openPieStore(tempRoot());
  const created = await store.createTemplate({
    name: "My role",
    description: "desc",
    systemPrompt: "you are custom",
    skillPolicy: { ignoredSkillNames: ["tdd"] },
  });
  assert.equal(created.source, "user");
  assert.equal(created.description, "desc");
  assert.deepEqual(created.skillPolicy.ignoredSkillNames, ["tdd"]);

  const task = await store.createTask({ cwd: "/workspace", title: "T" });
  const agent = await store.createAgent({
    taskId: task.id,
    name: "From tpl",
    systemPrompt: created.systemPrompt,
    templateId: created.id,
    sessionId: "sess-tpl",
    sessionPath: "/tmp/fake-tpl.jsonl",
  });
  assert.equal(agent.templateId, created.id);

  const dup = await store.duplicateTemplate(created.id);
  assert.ok(dup);
  assert.equal(dup!.source, "user");
  assert.equal(dup!.name, "My role 的副本");
  assert.equal(dup!.systemPrompt, "you are custom");

  const delSystem = await store.deleteTemplate((await store.listTemplates()).find((t) => t.source === "system")!.id);
  assert.equal(delSystem.ok, false);

  const del = await store.deleteTemplate(created.id);
  assert.equal(del.ok, true);
  const after = await store.getAgent(agent.id);
  assert.equal(after?.templateId, null);
  assert.equal(after?.systemPrompt, "you are custom");
  store.close();
});

test("reset factory restores system seed fields", async () => {
  const store = openPieStore(tempRoot());
  const system = (await store.listTemplates()).find((t) => t.id === "tpl:feature-default/to-spec");
  assert.ok(system);
  await store.updateTemplate({
    id: system!.id,
    name: "edited",
    description: "x",
    systemPrompt: "nope",
    skillPolicy: { ignoredSkillNames: ["x"] },
  });
  const result = await store.resetTemplateFactory(system!.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.template.name, "to-spec");
  assert.equal(result.template.description, "");
  assert.equal(result.template.systemPrompt.includes("spec writer"), true);
  assert.deepEqual(result.template.skillPolicy.ignoredSkillNames, []);

  const user = await store.createTemplate({ name: "u" });
  const bad = await store.resetTemplateFactory(user.id);
  assert.equal(bad.ok, false);
  store.close();
});
