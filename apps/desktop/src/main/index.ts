import { app, BrowserWindow, ipcMain, nativeTheme, session } from "electron";
import { fileURLToPath } from "node:url";
import { PiRuntimeManager } from "./pi/runtime-manager";
import { listWorkspaceChildren } from "./pi/workspace-fs";
import { readWorkspaceGit } from "./pi/workspace-git";
import type { WorkspaceListRequest } from "../shared/pi-ipc";

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const piRuntime = new PiRuntimeManager();

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
    void piRuntime.dispose();
  });
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

  ipcMain.handle("pi:session:get-timeline", () => {
    return piRuntime.getTimeline();
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

  ipcMain.handle("workspace:git", (_event, cwd: string) => {
    return readWorkspaceGit(cwd);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
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
