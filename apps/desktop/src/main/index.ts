import type { PiThinkingLevel } from "@pi-3.14/model";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import { isAbsolute, normalize, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { installMattSkills, readMattSkillsStatus } from "./pi/install-matt-skills";
import { listPersonalSkills, personalSkillsDir, writePersonalSkill } from "./pi/personal-skills";
import { getProviderUsageSnapshots } from "./pi/provider-usage";
import { PiRuntimeManager } from "./pi/runtime-manager";
import { openPieStore, type PieStore } from "./persistence/pie-store";
import { listWorkspaceChildren } from "./pi/workspace-fs";
import { discardWorkspaceGitFile, readWorkspaceGit } from "./pi/workspace-git";
import type {
  AppPreferencesUpdate,
  LegacyPanelPreferences,
  PersonalSkillWriteRequest,
  ReviewedFileUpdate,
  ReviewedFilesRequest,
  WorkspaceGitDiscardRequest,
  WorkspaceGitRequest,
  WorkspaceInstallMattSkillsRequest,
  WorkspaceListRequest,
  WorkspaceMattSkillsStatusRequest,
  WorkspaceOpenReviewRequest,
  WorkspacePreferencesUpdate,
  WorkspaceTaskMoveRequest,
  WorkspaceTaskUpdate,
} from "../shared/desktop-contracts";

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let pieStore: PieStore | null = null;
let piRuntime: PiRuntimeManager;
let mainWindow: BrowserWindow | null = null;
let reviewWindow: BrowserWindow | null = null;
const windowsWithLoadRetry = new WeakSet<BrowserWindow>();
const windowReloaders = new WeakMap<BrowserWindow, () => Promise<void>>();

/** Sandboxed preload must stay CJS (`.cjs`); see electron.vite.config.ts policy. */
const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const rendererHtmlPath = fileURLToPath(new URL("../renderer/index.html", import.meta.url));

/** Chromium error codes that often clear after a short wait (VPN/Wi‑Fi/interface churn). */
const TRANSIENT_LOAD_ERRORS = new Set([
  "ERR_NETWORK_CHANGED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_ADDRESS_UNREACHABLE",
  "ERR_CONNECTION_CLOSED",
  "ERR_EMPTY_RESPONSE",
]);

function attachTransientLoadRetry(
  window: BrowserWindow,
  reload: () => Promise<void>,
  maxAttempts = 5,
): void {
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  window.webContents.on(
    "did-fail-load",
    (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || window.isDestroyed()) return;
      const transient = TRANSIENT_LOAD_ERRORS.has(errorDescription);
      if (!transient || attempts >= maxAttempts) {
        if (!window.isDestroyed() && !window.isVisible()) window.show();
        console.error(
          `[pie] renderer load failed (${errorDescription}) url=${validatedURL} attempts=${attempts}`,
        );
        return;
      }
      attempts += 1;
      const delayMs = Math.min(2500, 300 * attempts);
      console.warn(
        `[pie] transient load error ${errorDescription}; retry ${attempts}/${maxAttempts} in ${delayMs}ms`,
      );
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (window.isDestroyed()) return;
        void reload().catch((error) => {
          console.error("[pie] renderer reload failed", error);
        });
      }, delayMs);
    },
  );

  window.webContents.on("did-finish-load", () => {
    attempts = 0;
    clearTimeout(retryTimer);
  });

  window.on("closed", () => clearTimeout(retryTimer));
}

async function loadMainRenderer(window: BrowserWindow): Promise<void> {
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }
  await window.loadFile(rendererHtmlPath);
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "PIE",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#07111f" : "#edf5f9",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  hardenWindowNavigation(window);
  window.once("ready-to-show", () => window.show());
  attachTransientLoadRetry(window, () => loadMainRenderer(window));
  void loadMainRenderer(window).catch((error) => {
    console.error("[pie] initial renderer load failed", error);
  });

  window.on("closed", () => {
    mainWindow = null;
    void piRuntime.dispose();
  });

  mainWindow = window;
}

/**
 * Never let markdown / window.open / middle-click leave the SPA shell.
 * Relative paths in chat used to load as app routes → blank white screen.
 */
function hardenWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openHrefFromRenderer(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    // Allow the intentional first load of the renderer itself.
    const current = window.webContents.getURL();
    if (!current || url === current) return;
    // Dev server HMR / same-origin hash changes stay in-app.
    if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
      const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "");
      if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}#`)) return;
    }
    if (url.startsWith("file:") && url.includes("index.html")) return;
    event.preventDefault();
    void openHrefFromRenderer(url);
  });
}

type OpenHrefResult =
  | { ok: true; kind: "external" | "path" }
  | { ok: false; error: string };

async function openHrefFromRenderer(rawHref: string): Promise<OpenHrefResult> {
  const href = typeof rawHref === "string" ? rawHref.trim() : "";
  if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
    return { ok: false, error: "Unsupported link" };
  }

  // Absolute web / mailto — system handler only.
  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      await shell.openExternal(href);
      return { ok: true, kind: "external" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // file:// → local path
  let candidate = href;
  if (href.startsWith("file:")) {
    try {
      candidate = fileURLToPath(href);
    } catch {
      return { ok: false, error: "Invalid file URL" };
    }
  }

  // Strip electron-vite / app origin if Chromium resolved a relative link against it.
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL && candidate.startsWith("http")) {
    try {
      const base = new URL(process.env.ELECTRON_RENDERER_URL);
      const url = new URL(candidate);
      if (url.origin === base.origin) {
        candidate = decodeURIComponent(url.pathname);
      }
    } catch {
      // keep candidate
    }
  }

  const cwd = piRuntime?.getWorkspaceCwd() ?? null;
  const absolute = isAbsolute(candidate)
    ? normalize(candidate)
    : cwd
      ? normalize(resolvePath(cwd, candidate.replace(/^\//, "")))
      : null;

  if (!absolute) {
    return { ok: false, error: "No workspace to resolve relative path" };
  }

  // Soft allowlist: prefer paths under the active workspace when we have one.
  if (cwd) {
    const root = normalize(cwd + sep);
    const target = normalize(absolute);
    if (target !== normalize(cwd) && !target.startsWith(root)) {
      // Still allow absolute paths the model cited outside the workspace (e.g. /tmp/log).
      // Only block obvious escapes that stay "relative-looking" after resolve? Keep open.
    }
  }

  const err = await shell.openPath(absolute);
  if (err) return { ok: false, error: err || "Failed to open path" };
  return { ok: true, kind: "path" };
}

function createReviewWindow(request: WorkspaceOpenReviewRequest, parent: BrowserWindow | null) {
  if (reviewWindow && !reviewWindow.isDestroyed()) {
    void loadReviewWindow(reviewWindow, request);
    reviewWindow.focus();
    return;
  }

  const owner = parent && !parent.isDestroyed() ? parent : mainWindow;
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    ...(owner && !owner.isDestroyed() ? { parent: owner, modal: true } : {}),
    title: "PIE · Review changes",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#07111f" : "#edf5f9",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  reviewWindow = window;
  hardenWindowNavigation(window);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    reviewWindow = null;
  });
  void loadReviewWindow(window, request);
}

async function loadReviewWindow(window: BrowserWindow, request: WorkspaceOpenReviewRequest) {
  const route = reviewRouteHash(request);
  const reload = async () => {
    if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${route}`);
      return;
    }
    await window.loadFile(rendererHtmlPath, { hash: route.slice(1) });
  };
  windowReloaders.set(window, reload);
  // First open only — avoid stacking listeners on focus/reload.
  if (!windowsWithLoadRetry.has(window)) {
    windowsWithLoadRetry.add(window);
    attachTransientLoadRetry(window, async () => {
      const next = windowReloaders.get(window);
      if (next) await next();
    });
  }
  await reload();
}

function reviewRouteHash(request: WorkspaceOpenReviewRequest): string {
  const params = new URLSearchParams({ cwd: request.cwd });
  if (request.path) params.set("path", request.path);
  return `#/review?${params.toString()}`;
}

async function confirmDiscard(
  sender: Electron.WebContents,
  request: WorkspaceGitDiscardRequest,
): Promise<boolean> {
  const parent = BrowserWindow.fromWebContents(sender) ?? reviewWindow ?? mainWindow ?? undefined;
  const options = {
    type: "warning" as const,
    buttons: ["Cancel", "Discard this file"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: "Discard changes?",
    message: `Discard changes to ${request.path}?`,
    detail:
      "Tracked changes will be restored from HEAD. Untracked files will be moved to Trash. This cannot be undone from PIE.",
  };
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
app.whenReady().then(() => {
  pieStore = openPieStore(app.getPath("userData"));
  piRuntime = new PiRuntimeManager(pieStore);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  ipcMain.handle("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));

  /** Sandboxed preload may not expose electron.clipboard; write from main. */
  ipcMain.handle("clipboard:write-text", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
    return { ok: true as const };
  });

  /** Open http(s)/mailto externally, or workspace-relative / absolute paths via OS. */
  ipcMain.handle("shell:open-href", (_event, href: string) => openHrefFromRenderer(href));

  ipcMain.handle(
    "pi:tasks:bootstrap",
    (_event, request?: { legacyPanelPreferences?: LegacyPanelPreferences }) =>
      piRuntime.bootstrap(request?.legacyPanelPreferences),
  );
  ipcMain.handle("pi:tasks:list", () => piRuntime.listTasks());
  ipcMain.handle(
    "pi:tasks:activate",
    (event, taskId: string, options?: { force?: boolean }) => {
      return piRuntime.activateTask(event.sender, taskId, options);
    },
  );
  ipcMain.handle("pi:tasks:update", (_event, request: WorkspaceTaskUpdate) => {
    return piRuntime.updateTask(request.id, {
      title: request.title,
      workflow: request.workflow,
    });
  });
  ipcMain.handle("pi:tasks:move", (_event, request: WorkspaceTaskMoveRequest) => {
    return piRuntime.moveTask(request);
  });
  ipcMain.handle("pi:tasks:archive", (_event, taskId: string) => {
    return piRuntime.archiveTask(taskId);
  });
  ipcMain.handle("pi:tasks:unarchive", (_event, taskId: string) => {
    return piRuntime.unarchiveTask(taskId);
  });

  ipcMain.handle("pi:agents:list", (_event, taskId: string) => piRuntime.listAgents(taskId));
  ipcMain.handle(
    "pi:agents:activate",
    (event, agentId: string, options?: { force?: boolean }) => {
      return piRuntime.activateAgent(event.sender, agentId, options);
    },
  );
  ipcMain.handle("pi:agents:create", (_event, request) =>
    piRuntime.createAgentFromTemplate(request),
  );
  ipcMain.handle("pi:agents:spawn", (_event, request) => piRuntime.spawnChildAgent(request));
  ipcMain.handle("pi:agents:update", (_event, request) => piRuntime.updateAgent(request));
  ipcMain.handle("pi:agents:confirm-role-prompt", (_event, agentId: string) =>
    piRuntime.confirmAgentRolePrompt(agentId),
  );
  ipcMain.handle("pi:agents:restore-role-prompt", (_event, agentId: string) =>
    piRuntime.restoreAgentRolePromptFromTemplate(agentId),
  );
  ipcMain.handle("pi:agents:advance-workflow", (event, request) => {
    return piRuntime.advanceTaskWorkflow(event.sender, request);
  });
  ipcMain.handle("pi:agents:relink", (event, agentId: string) => {
    return piRuntime.relinkAgentSession(event.sender, agentId);
  });
  ipcMain.handle("pi:templates:list", () => piRuntime.listTemplates());
  ipcMain.handle("pi:templates:create", (_event, request) => piRuntime.createTemplate(request));
  ipcMain.handle("pi:templates:update", (_event, request) => piRuntime.updateTemplate(request));
  ipcMain.handle("pi:templates:delete", (_event, id: string) => piRuntime.deleteTemplate(id));
  ipcMain.handle("pi:templates:duplicate", (_event, id: string) => piRuntime.duplicateTemplate(id));
  ipcMain.handle("pi:templates:reset-factory", (_event, id: string) =>
    piRuntime.resetTemplateFactory(id),
  );

  ipcMain.handle("pi:playbooks:list", () => piRuntime.listPlaybooks());
  ipcMain.handle("pi:playbooks:get", (_event, id: string) => piRuntime.getPlaybook(id));
  ipcMain.handle("pi:playbooks:create", (_event, request) => piRuntime.createPlaybook(request));
  ipcMain.handle("pi:playbooks:update", (_event, request) => piRuntime.updatePlaybook(request));
  ipcMain.handle("pi:playbooks:delete", (_event, id: string) => piRuntime.deletePlaybook(id));
  ipcMain.handle("pi:playbooks:duplicate", (_event, id: string) => piRuntime.duplicatePlaybook(id));
  ipcMain.handle("pi:playbooks:reset-factory", (_event, id: string) =>
    piRuntime.resetPlaybookFactory(id),
  );

  ipcMain.handle("preferences:update-app", (_event, patch: AppPreferencesUpdate) => {
    return pieStore!.updateAppPreferences(patch);
  });
  ipcMain.handle("preferences:get-workspace", (_event, cwd: string) => {
    return pieStore!.getWorkspacePreferences(cwd);
  });
  ipcMain.handle(
    "preferences:update-workspace",
    (_event, cwd: string, patch: WorkspacePreferencesUpdate) => {
      return pieStore!.updateWorkspacePreferences(cwd, patch);
    },
  );
  ipcMain.handle("preferences:get-draft", (_event, agentId: string) => {
    return pieStore!.getDraft(agentId);
  });
  ipcMain.handle("preferences:save-draft", (_event, agentId: string, draft: string) => {
    return pieStore!.saveDraft(agentId, draft);
  });
  ipcMain.handle("preferences:get-reviewed", (_event, request: ReviewedFilesRequest) => {
    return pieStore!.getReviewedPaths(request);
  });
  ipcMain.handle("preferences:set-reviewed", (_event, request: ReviewedFileUpdate) => {
    return pieStore!.setReviewedFile(request);
  });
  ipcMain.handle(
    "preferences:clear-reviewed",
    (_event, request: Omit<ReviewedFileUpdate, "fingerprint">) => {
      return pieStore!.clearReviewedFile(request);
    },
  );

  ipcMain.handle("skills:personal-dir", () => ({ dir: personalSkillsDir() }));
  ipcMain.handle("skills:list-personal", () => listPersonalSkills());
  ipcMain.handle("skills:write-personal", (_event, request: PersonalSkillWriteRequest) => {
    return writePersonalSkill(request);
  });

  ipcMain.handle("pi:session:pick-workspace", (event) => {
    return piRuntime.pickWorkspace(event.sender);
  });

  ipcMain.handle("pi:session:create", (event, options) => {
    return piRuntime.createSession(event.sender, options);
  });

  ipcMain.handle(
    "pi:session:prompt",
    (event, text: string, options?: { agentId?: string }) => {
      return piRuntime.prompt(event.sender, text, options);
    },
  );

  ipcMain.handle("pi:session:continue", (event, options?: { agentId?: string }) => {
    return piRuntime.continueTurn(event.sender, options);
  });

  ipcMain.handle("pi:session:abort", (_event, options?: { agentId?: string }) => {
    return piRuntime.abort(options);
  });

  ipcMain.handle("pi:session:get-state", () => {
    return piRuntime.getState();
  });

  ipcMain.handle("pi:session:list-models", () => {
    return piRuntime.listModels();
  });

  ipcMain.handle("pi:session:list-thinking-levels", () => {
    return piRuntime.listThinkingLevels();
  });

  ipcMain.handle(
    "pi:session:set-model",
    (_event, request: { provider: string; modelId: string }) => {
      return piRuntime.setModel(request.provider, request.modelId);
    },
  );

  ipcMain.handle("pi:session:set-thinking-level", (_event, level: PiThinkingLevel) => {
    return piRuntime.setThinkingLevel(level);
  });

  ipcMain.handle("pi:session:set-auto-approve", (_event, unlocked: boolean) => {
    return piRuntime.setAutoApprove(unlocked);
  });

  ipcMain.handle("pi:session:get-auto-approve", () => {
    return piRuntime.getAutoApprove();
  });

  ipcMain.handle("pi:session:get-timeline", () => {
    return piRuntime.getTimeline();
  });

  ipcMain.handle(
    "pi:session:inspect",
    (_event, options?: { detail?: "full" | "hud" }) => {
      return piRuntime.inspectSession(options);
    },
  );

  ipcMain.handle("pi:session:map", () => {
    return piRuntime.getSessionMap();
  });

  ipcMain.handle("pi:session:map-context", (_event, request) => {
    return piRuntime.getSessionMapContext(request);
  });

  ipcMain.handle("usage:provider-quotas", (_event, force?: boolean) => {
    return getProviderUsageSnapshots(Boolean(force));
  });

  ipcMain.handle("pi:session:navigate", (event, request) => {
    return piRuntime.navigateSession(event.sender, request);
  });

  ipcMain.handle("pi:session:prepare-branch-summary", () => {
    return piRuntime.prepareBranchSummary();
  });

  ipcMain.handle("pi:session:get-prepared-branch-summary", () => {
    return piRuntime.getPreparedBranchSummary();
  });

  ipcMain.handle("pi:session:clear-prepared-branch-summary", () => {
    return piRuntime.clearPreparedBranchSummary();
  });

  ipcMain.handle("pi:session:export", (event) => {
    return piRuntime.exportSession(event.sender);
  });

  ipcMain.handle("pi:session:get-pending-approval", () => {
    return piRuntime.getPendingApproval();
  });

  ipcMain.handle("pi:session:dispose", () => {
    return piRuntime.dispose();
  });

  ipcMain.handle("workspace:list", (_event, request: WorkspaceListRequest) => {
    return listWorkspaceChildren(request.cwd, request.path ?? "");
  });

  ipcMain.handle("workspace:git", (_event, request: string | WorkspaceGitRequest) => {
    return readWorkspaceGit(request);
  });

  ipcMain.handle("workspace:git-discard", async (event, request: WorkspaceGitDiscardRequest) => {
    const confirmed = await confirmDiscard(event.sender, request);
    if (!confirmed) {
      return { ok: false, cancelled: true, error: "Discard cancelled" };
    }
    return discardWorkspaceGitFile(request);
  });

  ipcMain.handle("workspace:open-review", (event, request: WorkspaceOpenReviewRequest) => {
    createReviewWindow(request, BrowserWindow.fromWebContents(event.sender));
    return { ok: true };
  });

  ipcMain.handle("workspace:close-review", () => {
    if (reviewWindow && !reviewWindow.isDestroyed()) {
      reviewWindow.close();
    }
    return { ok: true };
  });

  ipcMain.handle(
    "workspace:install-matt-skills",
    (_event, request: WorkspaceInstallMattSkillsRequest) => {
      return installMattSkills(request);
    },
  );

  ipcMain.handle(
    "workspace:matt-skills-status",
    (_event, request: WorkspaceMattSkillsStatusRequest) => {
      return readMattSkillsStatus(request);
    },
  );

  createMainWindow();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    } else {
      mainWindow.focus();
    }
  });
}).catch((error: unknown) => {
  console.error("Failed to start Electron app", error);
  void dialog.showErrorBox("PIE could not start", error instanceof Error ? error.message : String(error));
  app.quit();
});
}

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (piRuntime) void piRuntime.dispose();
});

app.on("will-quit", () => {
  pieStore?.close();
  pieStore = null;
});
