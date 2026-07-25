import { createMemo, createSignal } from "solid-js";
import type { AgentTemplate, SkillPolicy } from "../../../../shared/desktop-contracts";

export type TemplateDraft = {
  name: string;
  description: string;
  systemPrompt: string;
  ignoredSkillNames: string[];
};

function draftFromTemplate(template: AgentTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    systemPrompt: template.systemPrompt,
    ignoredSkillNames: [...template.skillPolicy.ignoredSkillNames],
  };
}

function draftsEqual(a: TemplateDraft, b: TemplateDraft): boolean {
  if (
    a.name !== b.name ||
    a.description !== b.description ||
    a.systemPrompt !== b.systemPrompt
  ) {
    return false;
  }
  if (a.ignoredSkillNames.length !== b.ignoredSkillNames.length) return false;
  const left = [...a.ignoredSkillNames].sort();
  const right = [...b.ignoredSkillNames].sort();
  return left.every((name, index) => name === right[index]);
}

export function createTemplatesModel() {
  const [templates, setTemplates] = createSignal<AgentTemplate[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [draft, setDraft] = createSignal<TemplateDraft | null>(null);
  const [baseline, setBaseline] = createSignal<TemplateDraft | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [busyAction, setBusyAction] = createSignal(false);

  const selected = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return templates().find((item) => item.id === id) ?? null;
  });

  const dirty = createMemo(() => {
    const current = draft();
    const base = baseline();
    if (!current || !base) return false;
    return !draftsEqual(current, base);
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = templates();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    );
  });

  const systemTemplates = createMemo(() =>
    filtered().filter((item) => item.source === "system"),
  );
  const userTemplates = createMemo(() => filtered().filter((item) => item.source === "user"));

  function selectTemplate(id: string | null, options?: { force?: boolean }): boolean {
    if (!options?.force && dirty()) return false;
    setSelectedId(id);
    const row = id ? templates().find((item) => item.id === id) ?? null : null;
    if (!row) {
      setDraft(null);
      setBaseline(null);
      return true;
    }
    const next = draftFromTemplate(row);
    setDraft(next);
    setBaseline(draftFromTemplate(row));
    return true;
  }

  function discardDraft(): void {
    const id = selectedId();
    const row = id ? templates().find((item) => item.id === id) ?? null : null;
    if (!row) {
      setDraft(null);
      setBaseline(null);
      return;
    }
    const next = draftFromTemplate(row);
    setDraft(next);
    setBaseline(draftFromTemplate(row));
  }

  function patchDraft(patch: Partial<TemplateDraft>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function setIgnoredSkillNames(names: string[]): void {
    patchDraft({ ignoredSkillNames: [...names] });
  }

  async function refresh(preferredId?: string | null): Promise<void> {
    setLoading(true);
    try {
      const rows = await window.piDesktop.templates.list();
      setTemplates(rows);
      const want = preferredId === undefined ? selectedId() : preferredId;
      const nextId =
        want && rows.some((row) => row.id === want)
          ? want
          : (rows[0]?.id ?? null);
      setSelectedId(nextId);
      const row = nextId ? rows.find((item) => item.id === nextId) ?? null : null;
      if (row) {
        const next = draftFromTemplate(row);
        setDraft(next);
        setBaseline(draftFromTemplate(row));
      } else {
        setDraft(null);
        setBaseline(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<boolean> {
    const row = selected();
    const current = draft();
    if (!row || !current || saving()) return false;
    const name = current.name.trim();
    if (!name) throw new Error("模板名称不能为空");
    setSaving(true);
    try {
      const skillPolicy: SkillPolicy = {
        ignoredSkillNames: current.ignoredSkillNames,
      };
      const updated = await window.piDesktop.templates.update({
        id: row.id,
        name,
        description: current.description,
        systemPrompt: current.systemPrompt,
        skillPolicy,
      });
      if (!updated) throw new Error("保存失败");
      setTemplates((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      const next = draftFromTemplate(updated);
      setDraft(next);
      setBaseline(draftFromTemplate(updated));
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function createUserTemplate(): Promise<AgentTemplate> {
    setBusyAction(true);
    try {
      const created = await window.piDesktop.templates.create({
        name: "未命名模板",
        description: "",
        systemPrompt: "",
        skillPolicy: { ignoredSkillNames: [] },
      });
      await refresh(created.id);
      return created;
    } finally {
      setBusyAction(false);
    }
  }

  async function duplicateSelected(): Promise<AgentTemplate | null> {
    const row = selected();
    if (!row) return null;
    setBusyAction(true);
    try {
      const created = await window.piDesktop.templates.duplicate(row.id);
      if (created) await refresh(created.id);
      return created;
    } finally {
      setBusyAction(false);
    }
  }

  async function deleteSelected(): Promise<boolean> {
    const row = selected();
    if (!row || row.source !== "user") return false;
    setBusyAction(true);
    try {
      const result = await window.piDesktop.templates.delete(row.id);
      if (!result.ok) throw new Error(result.error);
      await refresh(null);
      return true;
    } finally {
      setBusyAction(false);
    }
  }

  async function resetSelectedFactory(): Promise<boolean> {
    const row = selected();
    if (!row || row.source !== "system") return false;
    setBusyAction(true);
    try {
      const result = await window.piDesktop.templates.resetFactory(row.id);
      if (!result.ok) throw new Error(result.error);
      setTemplates((list) =>
        list.map((item) => (item.id === result.template.id ? result.template : item)),
      );
      const next = draftFromTemplate(result.template);
      setDraft(next);
      setBaseline(draftFromTemplate(result.template));
      return true;
    } finally {
      setBusyAction(false);
    }
  }

  return {
    templates,
    selectedId,
    selected,
    query,
    setQuery,
    draft,
    dirty,
    loading,
    saving,
    busyAction,
    filtered,
    systemTemplates,
    userTemplates,
    selectTemplate,
    discardDraft,
    patchDraft,
    setIgnoredSkillNames,
    refresh,
    save,
    createUserTemplate,
    duplicateSelected,
    deleteSelected,
    resetSelectedFactory,
  };
}

export type TemplatesModel = ReturnType<typeof createTemplatesModel>;
