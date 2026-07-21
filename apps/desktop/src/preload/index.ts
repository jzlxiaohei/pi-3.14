import { contextBridge, ipcRenderer } from "electron";

export type DesktopAppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
};

const api = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<DesktopAppInfo>
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
