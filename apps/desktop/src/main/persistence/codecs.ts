import type {
  TaskWorkflow,
  WorkspaceTaskStatus,
} from "../../shared/desktop-contracts";

export type LegacyTask = {
  id: string;
  title: string;
  cwd: string;
  sessionPath: string | null;
  sessionId: string | null;
  status: WorkspaceTaskStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  workflow?: TaskWorkflow;
  ignoredSkillNames?: string[];
};

export type LegacyTaskStore = {
  selectedTaskId: string | null;
  tasks: LegacyTask[];
};

export function parseLegacyTaskStore(value: unknown): LegacyTaskStore | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tasks)) return null;
  if (
    raw.selectedTaskId !== undefined &&
    raw.selectedTaskId !== null &&
    typeof raw.selectedTaskId !== "string"
  ) {
    return null;
  }

  const tasks: LegacyTask[] = [];
  for (const candidate of raw.tasks) {
    const task = parseLegacyTask(candidate);
    if (!task) return null;
    tasks.push(task);
  }
  return {
    selectedTaskId: typeof raw.selectedTaskId === "string" ? raw.selectedTaskId : null,
    tasks,
  };
}

function parseLegacyTask(value: unknown): LegacyTask | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.cwd !== "string" ||
    typeof raw.createdAt !== "number" ||
    typeof raw.updatedAt !== "number"
  ) {
    return null;
  }
  if (raw.sessionPath != null && typeof raw.sessionPath !== "string") return null;
  if (raw.sessionId != null && typeof raw.sessionId !== "string") return null;

  const folder = raw.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? raw.cwd;
  const task: LegacyTask = {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : `New task · ${folder}`,
    cwd: raw.cwd,
    sessionPath: typeof raw.sessionPath === "string" ? raw.sessionPath : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    status: isStatus(raw.status) ? raw.status : "idle",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (typeof raw.archivedAt === "number") task.archivedAt = raw.archivedAt;
  if (isWorkflow(raw.workflow)) task.workflow = raw.workflow;
  if (isStringArray(raw.ignoredSkillNames)) {
    task.ignoredSkillNames = uniqueStrings(raw.ignoredSkillNames);
  }
  return task;
}

export function parseWorkflow(value: string | null): TaskWorkflow | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isWorkflow(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isStringArray(parsed) ? uniqueStrings(parsed) : [];
  } catch {
    return [];
  }
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isStatus(value: unknown): value is WorkspaceTaskStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkflow(value: unknown): value is TaskWorkflow {
  if (typeof value !== "object" || value === null) return false;
  const workflow = value as TaskWorkflow;
  return (
    typeof workflow.playbookId === "string" &&
    typeof workflow.stepId === "string" &&
    Array.isArray(workflow.steps) &&
    workflow.steps.every(
      (step) =>
        typeof step?.id === "string" &&
        (step.status === "pending" ||
          step.status === "active" ||
          step.status === "done" ||
          step.status === "skipped"),
    )
  );
}
