import type { PiThinkingLevel } from "@pi-3.14/model";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session } from "electron";
import { fileURLToPath } from "node:url";
import { installMattSkills, readMattSkillsStatus } from "./pi/install-matt-skills";
import { personalSkillsDir, writePersonalSkill } from "./pi/personal-skills";
import { PiRuntimeManager } from "./pi/runtime-manager";
import { listWorkspaceChildren } from "./pi/workspace-fs";
import { discardWorkspaceGitFile, readWorkspaceGit } from "./pi/workspace-git";
import type {
  PersonalSkillWriteRequest,
  WorkspaceGitDiscardRequest,
  WorkspaceGitRequest,
  WorkspaceInstallMattSkillsRequest,
  WorkspaceListRequest,
  WorkspaceMattSkillsStatusRequest,
  WorkspaceOpenReviewRequest,
  WorkspaceTaskUpdate,
} from "../shared/desktop-contracts";

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const piRuntime = new PiRuntimeManager();
let mainWindow: BrowserWindow | null = null;
let reviewWindow: BrowserWindow | null = null;

/** Sandboxed preload must stay CJS (`.cjs`); see electron.vite.config.ts policy. */
const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const rendererHtmlPath = fileURLToPath(new URL("../renderer/index.html", import.meta.url));

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

  window.once("ready-to-show", () => window.show());

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(rendererHtmlPath);
  }

  window.on("closed", () => {
    mainWindow = null;
    void piRuntime.dispose();
  });

  mainWindow = window;
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
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    reviewWindow = null;
  });
  void loadReviewWindow(window, request);
}

async function loadReviewWindow(window: BrowserWindow, request: WorkspaceOpenReviewRequest) {
  const route = reviewRouteHash(request);
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${route}`);
  } else {
    await window.loadFile(rendererHtmlPath, { hash: route.slice(1) });
  }
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  ipcMain.handle("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle("pi:tasks:bootstrap", () => piRuntime.bootstrap());
  ipcMain.handle("pi:tasks:list", () => piRuntime.listTasks());
  ipcMain.handle("pi:tasks:activate", (event, taskId: string) => {
    return piRuntime.activateTask(event.sender, taskId);
  });
  ipcMain.handle("pi:tasks:update", (_event, request: WorkspaceTaskUpdate) => {
    return piRuntime.updateTask(request.id, {
      title: request.title,
      workflow: request.workflow,
    });
  });

  ipcMain.handle("skills:personal-dir", () => ({ dir: personalSkillsDir() }));
  ipcMain.handle("skills:write-personal", (_event, request: PersonalSkillWriteRequest) => {
    return writePersonalSkill(request);
  });

  ipcMain.handle("pi:session:pick-workspace", (event) => {
    return piRuntime.pickWorkspace(event.sender);
  });

  ipcMain.handle("pi:session:create", (event, options) => {
    return piRuntime.createSession(event.sender, options);
  });

  ipcMain.handle("pi:session:prompt", (event, text: string) => {
    return piRuntime.prompt(event.sender, text);
  });

  ipcMain.handle("pi:session:abort", () => {
    return piRuntime.abort();
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

  ipcMain.handle("pi:session:get-timeline", () => {
    return piRuntime.getTimeline();
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
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void piRuntime.dispose();
});
