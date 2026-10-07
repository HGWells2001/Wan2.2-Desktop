import { contextBridge, ipcRenderer } from "electron";

type ProgressPayload = {
  percent: number;
  phase: string;
};

function onProgress(
  channel: "desktop:wan-progress" | "desktop:python-progress",
  callback: (progress: ProgressPayload) => void,
) {
  const listener = (_event: Electron.IpcRendererEvent, progress: ProgressPayload) => {
    callback(progress);
  };

  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("wanDesktop", {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  getApiBaseUrl: () => ipcRenderer.invoke("desktop:get-api-base-url"),
  getNativeGpu: () => ipcRenderer.invoke("desktop:get-native-gpu"),
  getBackendStatus: () => ipcRenderer.invoke("desktop:get-backend-status"),
  chooseDirectory: (title: string) => ipcRenderer.invoke("desktop:choose-directory", title),
  chooseImage: () => ipcRenderer.invoke("desktop:choose-image"),
  saveConfig: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke("desktop:save-config", patch),
  installWanRuntime: () => ipcRenderer.invoke("desktop:install-wan-runtime"),
  setupPythonRuntime: () => ipcRenderer.invoke("desktop:setup-python-runtime"),
  onWanProgress: (callback: (progress: ProgressPayload) => void) =>
    onProgress("desktop:wan-progress", callback),
  onPythonProgress: (callback: (progress: ProgressPayload) => void) =>
    onProgress("desktop:python-progress", callback),
});
