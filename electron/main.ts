import { app, BrowserWindow, dialog, ipcMain, net } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WAN_UPSTREAM_COMMIT = "1ea34ff48f87168174e12956e200b1d908b1c5ff";
const WAN_ARCHIVE_URL =
  `https://github.com/Wan-Video/Wan2.2/archive/${WAN_UPSTREAM_COMMIT}.zip`;

type DesktopConfig = {
  wanSourceDir?: string;
  checkpointDir?: string;
  outputDir?: string;
  pythonPath?: string;
};

type ProcessResult = {
  code: number | null;
  output: string;
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
  const config = readConfig();
  if (config.pythonPath && fs.existsSync(config.pythonPath)) return config.pythonPath;

  const configured = process.env.WAN22_PYTHON;
  if (configured) return configured;

  const localVenv = process.platform === "win32"
    ? path.join(backendDir(), ".venv", "Scripts", "python.exe")
    : path.join(backendDir(), ".venv", "bin", "python");

  return fs.existsSync(localVenv)
    ? localVenv
    : process.platform === "win32" ? "python" : "python3";
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (error: Error) => {
      resolve({ code: -1, output: `${output}\n${error.message}` });
    });

    child.on("exit", (code: number | null) => {
      resolve({ code, output });
    });
  });
}

async function downloadFile(url: string, destination: string) {
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, bytes);
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
  backendProcess.on("error", (error) => {
    console.error(`[backend] failed to start: ${error.message}`);
    backendProcess = null;
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

  ipcMain.handle("desktop:setup-python-runtime", async () => {
    if (process.platform !== "win32") {
      return {
        ok: false,
        error: "Automatic Python runtime setup is currently implemented for Windows.",
      };
    }

    const config = readConfig();
    const wanSourceDir = config.wanSourceDir;
    if (!wanSourceDir || !fs.existsSync(path.join(wanSourceDir, "generate.py"))) {
      return { ok: false, error: "Install the Wan 2.2 runtime first." };
    }

    const runtimeRoot = path.join(app.getPath("userData"), "runtime");
    const script = app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "setup-runtime.ps1")
      : path.join(projectRoot(), "scripts", "setup-runtime.ps1");

    const result = await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-BackendDir", backendDir(),
      "-RuntimeRoot", runtimeRoot,
      "-WanSourceDir", wanSourceDir,
    ]);

    const pythonPath = path.join(runtimeRoot, "python", "Scripts", "python.exe");
    if (result.code === 0 && fs.existsSync(pythonPath)) {
      const nextConfig = writeConfig({ pythonPath });
      restartBackend();
      return {
        ok: true,
        pythonPath,
        output: result.output,
        config: nextConfig,
      };
    }

    return {
      ok: false,
      error: `Runtime setup exited with code ${result.code}`,
      output: result.output,
    };
  });

  ipcMain.handle("desktop:install-wan-runtime", async () => {
    if (process.platform !== "win32") {
      return {
        ok: false,
        error: "Automatic Wan runtime installation is currently implemented for Windows.",
      };
    }

    const baseDir = path.join(app.getPath("userData"), "runtime");
    const destination = path.join(baseDir, "Wan2.2");
    fs.mkdirSync(baseDir, { recursive: true });

    if (fs.existsSync(path.join(destination, "generate.py"))) {
      const config = writeConfig({ wanSourceDir: destination });
      restartBackend();
      return {
        ok: true,
        path: destination,
        commit: WAN_UPSTREAM_COMMIT,
        config,
        reused: true,
      };
    }

    const archivePath = path.join(baseDir, "Wan2.2-upstream.zip");
    const extractRoot = path.join(baseDir, "_wan_extract");

    try {
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });

      await downloadFile(WAN_ARCHIVE_URL, archivePath);
      const expand = await runProcess("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Expand-Archive",
        "-LiteralPath", archivePath,
        "-DestinationPath", extractRoot,
        "-Force",
      ]);

      if (expand.code !== 0) {
        throw new Error(expand.output || "Could not extract the Wan runtime archive.");
      }

      const extractedDir = path.join(
        extractRoot,
        `Wan2.2-${WAN_UPSTREAM_COMMIT}`,
      );

      if (!fs.existsSync(path.join(extractedDir, "generate.py"))) {
        throw new Error("The downloaded Wan archive does not contain generate.py.");
      }

      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(extractedDir, destination);
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });

      const config = writeConfig({ wanSourceDir: destination });
      restartBackend();
      return {
        ok: true,
        path: destination,
        commit: WAN_UPSTREAM_COMMIT,
        config,
        reused: false,
      };
    } catch (error) {
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
