import { createMemo, createSignal } from "solid-js";
import type {
  PlaybookTemplate,
  PlaybookTemplateStep,
} from "../../../../shared/desktop-contracts";
import { normalizePlaybookSteps } from "../../../../shared/playbook-catalog";

export type PlaybookDraft = {
  name: string;
  description: string;
  steps: PlaybookTemplateStep[];
};

function draftFrom(playbook: PlaybookTemplate): PlaybookDraft {
  return {
    name: playbook.name,
    description: playbook.description,
    steps: playbook.steps.map((s) => ({ ...s })),
  };
}

function draftsEqual(a: PlaybookDraft, b: PlaybookDraft): boolean {
  if (a.name !== b.name || a.description !== b.description) return false;
  if (a.steps.length !== b.steps.length) return false;
  return a.steps.every((step, index) => {
    const other = b.steps[index]!;
    return (
      step.id === other.id &&
      step.label === other.label &&
      step.blurb === other.blurb &&
      step.agentTemplateId === other.agentTemplateId &&
      step.starterPrompt === other.starterPrompt
    );
  });
}

export function createPlaybooksModel() {
  const [playbooks, setPlaybooks] = createSignal<PlaybookTemplate[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<PlaybookDraft | null>(null);
  const [baseline, setBaseline] = createSignal<PlaybookDraft | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [busyAction, setBusyAction] = createSignal(false);

  const selected = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return playbooks().find((p) => p.id === id) ?? null;
  });

  const dirty = createMemo(() => {
    const current = draft();
    const base = baseline();
    if (!current || !base) return false;
    return !draftsEqual(current, base);
  });

  function selectPlaybook(id: string | null, options?: { force?: boolean }): boolean {
    if (!options?.force && dirty()) return false;
    setSelectedId(id);
    const row = id ? playbooks().find((p) => p.id === id) ?? null : null;
    if (!row) {
      setDraft(null);
      setBaseline(null);
      return true;
    }
    const next = draftFrom(row);
    setDraft(next);
    setBaseline(draftFrom(row));
    return true;
  }

  function discardDraft(): void {
    const row = selected();
    if (!row) {
      setDraft(null);
      setBaseline(null);
      return;
    }
    const next = draftFrom(row);
    setDraft(next);
    setBaseline(draftFrom(row));
  }

  function patchDraft(patch: Partial<PlaybookDraft>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function patchStep(index: number, patch: Partial<PlaybookTemplateStep>): void {
    setDraft((current) => {
      if (!current) return current;
      const steps = current.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      );
      return { ...current, steps };
    });
  }

  function addStep(): void {
    setDraft((current) => {
      if (!current) return current;
      const n = current.steps.length + 1;
      return {
        ...current,
        steps: [
          ...current.steps,
          {
            id: `step-${n}`,
            label: `步骤 ${n}`,
            blurb: "",
            agentTemplateId: "",
            starterPrompt: "",
          },
        ],
      };
    });
  }

  function removeStep(index: number): void {
    setDraft((current) => {
      if (!current || current.steps.length <= 1) return current;
      return {
        ...current,
        steps: current.steps.filter((_, i) => i !== index),
      };
    });
  }

  function moveStep(index: number, delta: number): void {
    setDraft((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      const [row] = steps.splice(index, 1);
      steps.splice(target, 0, row!);
      return { ...current, steps };
    });
  }

  async function refresh(preferredId?: string | null): Promise<void> {
    setLoading(true);
    try {
      const rows = await window.piDesktop.playbooks.list();
      setPlaybooks(rows);
      const want = preferredId === undefined ? selectedId() : preferredId;
      const nextId =
        want && rows.some((row) => row.id === want) ? want : (rows[0]?.id ?? null);
      setSelectedId(nextId);
      const row = nextId ? rows.find((p) => p.id === nextId) ?? null : null;
      if (row) {
        const next = draftFrom(row);
        setDraft(next);
        setBaseline(draftFrom(row));
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
    if (!name) throw new Error("路径名称不能为空");
    const steps = normalizePlaybookSteps(current.steps);
    for (const step of steps) {
      if (!step.agentTemplateId) {
        throw new Error(`步骤「${step.label}」未选择 Agent Template`);
      }
    }
    setSaving(true);
    try {
      const updated = await window.piDesktop.playbooks.update({
        id: row.id,
        name,
        description: current.description,
        steps,
      });
      if (!updated) throw new Error("保存失败");
      setPlaybooks((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      const next = draftFrom(updated);
      setDraft(next);
      setBaseline(draftFrom(updated));
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function createUserPlaybook(): Promise<PlaybookTemplate> {
    setBusyAction(true);
    try {
      const created = await window.piDesktop.playbooks.create({
        name: "未命名路径",
        description: "",
        steps: [
          {
            id: "step-1",
            label: "步骤 1",
            blurb: "",
            agentTemplateId: "",
            starterPrompt: "",
          },
        ],
      });
      await refresh(created.id);
      return created;
    } finally {
      setBusyAction(false);
    }
  }

  async function duplicateSelected(): Promise<PlaybookTemplate | null> {
    const row = selected();
    if (!row) return null;
    setBusyAction(true);
    try {
      const created = await window.piDesktop.playbooks.duplicate(row.id);
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
      const result = await window.piDesktop.playbooks.delete(row.id);
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
      const result = await window.piDesktop.playbooks.resetFactory(row.id);
      if (!result.ok) throw new Error(result.error);
      setPlaybooks((list) =>
        list.map((item) => (item.id === result.playbook.id ? result.playbook : item)),
      );
      const next = draftFrom(result.playbook);
      setDraft(next);
      setBaseline(draftFrom(result.playbook));
      return true;
    } finally {
      setBusyAction(false);
    }
  }

  return {
    playbooks,
    selectedId,
    selected,
    draft,
    dirty,
    loading,
    saving,
    busyAction,
    selectPlaybook,
    discardDraft,
    patchDraft,
    patchStep,
    addStep,
    removeStep,
    moveStep,
    refresh,
    save,
    createUserPlaybook,
    duplicateSelected,
    deleteSelected,
    resetSelectedFactory,
  };
}

export type PlaybooksModel = ReturnType<typeof createPlaybooksModel>;
