import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("wanDesktop", {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  chooseDirectory: (title: string) => ipcRenderer.invoke("desktop:choose-directory", title),
  chooseImage: () => ipcRenderer.invoke("desktop:choose-image"),
  saveConfig: (patch: Record<string, string | undefined>) =>
    ipcRenderer.invoke("desktop:save-config", patch),
  installWanRuntime: () => ipcRenderer.invoke("desktop:install-wan-runtime"),
});
