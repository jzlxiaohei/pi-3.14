import { createMemo, createSignal } from "solid-js";

export type TaskStatus = "done" | "idle" | "running";
export type InspectorTab = "changes" | "terminal";
export type Theme = "dark" | "light";

export type TaskSummary = {
  id: number;
  repo: string;
  status: TaskStatus;
  time: string;
  title: string;
};

export type WorkspaceFileNode = {
  changed?: boolean;
  children?: WorkspaceFileNode[];
  name: string;
  type: "file" | "folder";
};

export type DiffLineKind = "added" | "context" | "removed";

export type DiffLine = {
  content: string;
  id: string;
  kind: DiffLineKind;
  newLine?: number;
  oldLine?: number;
};

export type DiffHunk = {
  header: string;
  id: string;
  lines: DiffLine[];
  newLines: number;
  newStart: number;
  oldLines: number;
  oldStart: number;
};

export type DiffFile = {
  additions: number;
  binary?: boolean;
  deletions: number;
  hunks: DiffHunk[];
  id: string;
  language?: string;
  oldPath?: string;
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
};

const tasks: TaskSummary[] = [
  { id: 1, title: "Refactor auth middleware", repo: "orbit-api", time: "2m", status: "running" },
  { id: 2, title: "Fix invoice rounding", repo: "ledger-core", time: "18m", status: "done" },
  { id: 3, title: "Add command palette", repo: "desktop-shell", time: "1h", status: "done" },
  { id: 4, title: "Investigate flaky tests", repo: "web-console", time: "3h", status: "idle" },
  { id: 5, title: "Upgrade Vite config", repo: "design-kit", time: "Yesterday", status: "done" },
  { id: 6, title: "Wire session resume flow", repo: "agent-runtime", time: "Yesterday", status: "running" },
  { id: 7, title: "Review tool approval timeout states", repo: "desktop-shell", time: "Mon", status: "idle" },
  { id: 8, title: "Extract reusable task timeline blocks", repo: "orbit-ui", time: "Mon", status: "done" },
  { id: 9, title: "Handle compacted session context projection", repo: "session-lab", time: "Fri", status: "done" },
  { id: 10, title: "Prototype local model fallback banner", repo: "model-registry", time: "Fri", status: "idle" },
  { id: 11, title: "Add retry visibility for long-running agent turns", repo: "agent-runtime", time: "Thu", status: "running" },
  { id: 12, title: "Polish inspector diff empty state", repo: "orbit-ui", time: "Thu", status: "done" },
  { id: 13, title: "Document embedded runtime worker lifecycle", repo: "docs-site", time: "Wed", status: "done" },
  { id: 14, title: "Audit subagent cancellation propagation", repo: "subagents", time: "Wed", status: "idle" },
  { id: 15, title: "Prepare packaging notes for unsigned mac builds", repo: "desktop-shell", time: "Tue", status: "done" }
];

export const workspaceFiles: WorkspaceFileNode[] = [
  {
    name: "src",
    type: "folder",
    children: [
      {
        name: "middleware",
        type: "folder",
        children: [
          { name: "auth.ts", type: "file", changed: true },
          { name: "session.ts", type: "file" }
        ]
      },
      { name: "routes.ts", type: "file", changed: true },
      {
        name: "tests",
        type: "folder",
        children: [
          { name: "auth.test.ts", type: "file", changed: true },
          { name: "session.test.ts", type: "file" }
        ]
      }
    ]
  },
  {
    name: "packages",
    type: "folder",
    children: [
      {
        name: "runtime",
        type: "folder",
        children: [
          { name: "embedded.ts", type: "file" },
          { name: "events.ts", type: "file" }
        ]
      },
      {
        name: "session",
        type: "folder",
        children: [
          { name: "parser.ts", type: "file" },
          { name: "analysis.ts", type: "file" }
        ]
      }
    ]
  },
  { name: "package.json", type: "file" }
];

export const diffFiles: DiffFile[] = [
  {
    id: "src/middleware/auth.ts",
    path: "src/middleware/auth.ts",
    status: "modified",
    language: "typescript",
    additions: 31,
    deletions: 18,
    hunks: [
      {
        id: "src/middleware/auth.ts:42",
        header: "@@ -42,7 +42,11 @@",
        oldStart: 42,
        oldLines: 7,
        newStart: 42,
        newLines: 11,
        lines: [
          { id: "auth-42", kind: "context", oldLine: 42, newLine: 42, content: "export async function authenticate(req) {" },
          { id: "auth-43-old", kind: "removed", oldLine: 43, content: "const token = getBearerToken(req);" },
          { id: "auth-44-old", kind: "removed", oldLine: 44, content: "return verifyJwt(token, config.secret);" },
          { id: "auth-43-new", kind: "added", newLine: 43, content: "return verifyRequestToken(req, {" },
          { id: "auth-44-new", kind: "added", newLine: 44, content: "  allowExpired: false," },
          { id: "auth-45-new", kind: "added", newLine: 45, content: '  audience: "api",' },
          { id: "auth-46-new", kind: "added", newLine: 46, content: "});" },
          { id: "auth-45", kind: "context", oldLine: 45, newLine: 47, content: "}" }
        ]
      }
    ]
  },
  {
    id: "src/routes.ts",
    path: "src/routes.ts",
    status: "modified",
    language: "typescript",
    additions: 17,
    deletions: 13,
    hunks: [
      {
        id: "src/routes.ts:18",
        header: "@@ -18,9 +18,10 @@",
        oldStart: 18,
        oldLines: 9,
        newStart: 18,
        newLines: 10,
        lines: [
          { id: "routes-18", kind: "context", oldLine: 18, newLine: 18, content: "router.get('/profile', async (req, res) => {" },
          { id: "routes-19-old", kind: "removed", oldLine: 19, content: "const user = await verifyRouteToken(req);" },
          { id: "routes-19-new", kind: "added", newLine: 19, content: "const user = await authenticate(req);" },
          { id: "routes-20", kind: "context", oldLine: 20, newLine: 20, content: "return res.json({ user });" },
          { id: "routes-21", kind: "context", oldLine: 21, newLine: 21, content: "});" }
        ]
      }
    ]
  },
  {
    id: "src/tests/auth.test.ts",
    path: "src/tests/auth.test.ts",
    status: "added",
    language: "typescript",
    additions: 24,
    deletions: 0,
    hunks: [
      {
        id: "src/tests/auth.test.ts:1",
        header: "@@ -0,0 +1,6 @@",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 6,
        lines: [
          { id: "auth-test-1", kind: "added", newLine: 1, content: "test('rejects expired session tokens', async () => {" },
          { id: "auth-test-2", kind: "added", newLine: 2, content: "  const response = await request(app)" },
          { id: "auth-test-3", kind: "added", newLine: 3, content: "    .get('/profile')" },
          { id: "auth-test-4", kind: "added", newLine: 4, content: "    .set('authorization', expiredToken);" },
          { id: "auth-test-5", kind: "added", newLine: 5, content: "  expect(response.status).toBe(401);" },
          { id: "auth-test-6", kind: "added", newLine: 6, content: "});" }
        ]
      }
    ]
  }
];

export function createWorkspaceModel() {
  const [selectedTaskId, setSelectedTaskId] = createSignal(1);
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<InspectorTab>("changes");
  const [theme, setTheme] = createSignal<Theme>("light");
  const [isComplete, setIsComplete] = createSignal(false);

  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  const filteredTasks = createMemo(() => {
    const search = normalizedQuery();
    if (!search) return tasks;
    return tasks.filter((task) => {
      return task.title.toLowerCase().includes(search) || task.repo.toLowerCase().includes(search);
    });
  });

  const selectedTask = createMemo(() => {
    return tasks.find((task) => task.id === selectedTaskId()) ?? tasks[0]!;
  });

  return {
    filteredTasks,
    isComplete,
    query,
    selectedTask,
    selectedTaskId,
    tab,
    theme,
    clearSearch() {
      setQuery("");
    },
    markComplete() {
      setIsComplete(true);
    },
    newTask() {
      setSelectedTaskId(1);
      setQuery("");
      setIsComplete(false);
      setTab("changes");
    },
    selectTask(id: number) {
      setSelectedTaskId(id);
      setIsComplete(false);
    },
    sendFollowUp() {
      setIsComplete(false);
    },
    setQuery,
    setTab,
    toggleTheme() {
      setTheme((current) => current === "light" ? "dark" : "light");
    }
  };
}

export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;
