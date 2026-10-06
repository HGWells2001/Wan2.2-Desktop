import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("wanDesktop", {
  platform: process.platform
});
