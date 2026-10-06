import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DesktopConfig = {
  wanSourceDir?: string;
  checkpointDir?: string;
  outputDir?: string;
};

let backendProcess: ChildProcess | null = null;

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function backendDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(projectRoot(), "backend");
}

function configPath() {
  return path.join(app.getPath("userData"), "wan2-desktop.json");
}

function readConfig(): DesktopConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as DesktopConfig;
  } catch {
    return {};
  }
}

function writeConfig(patch: Partial<DesktopConfig>) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function pythonExecutable() {
  const configured = process.env.WAN22_PYTHON;
  if (configured) return configured;

  const localVenv = process.platform === "win32"
    ? path.join(backendDir(), ".venv", "Scripts", "python.exe")
    : path.join(backendDir(), ".venv", "bin", "python");

  return fs.existsSync(localVenv)
    ? localVenv
    : process.platform === "win32" ? "python" : "python3";
}

function startBackend() {
  if (backendProcess && backendProcess.exitCode === null) return;

  const config = readConfig();
  backendProcess = spawn(
    pythonExecutable(),
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir(),
      env: {
        ...process.env,
        ...(config.wanSourceDir ? { WAN22_SOURCE_DIR: config.wanSourceDir } : {}),
        ...(config.outputDir ? { WAN22_OUTPUT_DIR: config.outputDir } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  backendProcess.stdout?.on("data", (chunk) => {
    console.log(`[backend] ${String(chunk).trimEnd()}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    console.error(`[backend] ${String(chunk).trimEnd()}`);
  });
  backendProcess.on("exit", () => {
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  backendProcess.kill();
  backendProcess = null;
}

function restartBackend() {
  stopBackend();
  setTimeout(startBackend, 350);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#090b10",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("desktop:get-config", () => readConfig());

  ipcMain.handle("desktop:choose-directory", async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("desktop:choose-image", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose source image",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(
    "desktop:save-config",
    (_event, patch: Partial<DesktopConfig>) => {
      const next = writeConfig(patch);
      restartBackend();
      return next;
    },
  );

  ipcMain.handle("desktop:install-wan-runtime", async () => {
    const baseDir = path.join(app.getPath("userData"), "runtime");
    const destination = path.join(baseDir, "Wan2.2");
    fs.mkdirSync(baseDir, { recursive: true });

    if (fs.existsSync(path.join(destination, "generate.py"))) {
      const config = writeConfig({ wanSourceDir: destination });
      restartBackend();
      return { ok: true, path: destination, config, reused: true };
    }

    return await new Promise((resolve) => {
      const child = spawn(
        "git",
        ["clone", "--depth", "1", "https://github.com/Wan-Video/Wan2.2.git", destination],
        { windowsHide: true },
      );

      let output = "";
      child.stdout?.on("data", (chunk) => { output += String(chunk); });
      child.stderr?.on("data", (chunk) => { output += String(chunk); });

      child.on("error", (error) => {
        resolve({ ok: false, error: error.message, output });
      });

      child.on("exit", (code) => {
        if (code === 0) {
          const config = writeConfig({ wanSourceDir: destination });
          restartBackend();
          resolve({ ok: true, path: destination, config, reused: false });
        } else {
          resolve({ ok: false, error: `git clone exited with code ${code}`, output });
        }
      });
    });
  });
}

app.whenReady().then(() => {
  registerIpc();
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", stopBackend);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
