import { app, BrowserWindow, dialog, ipcMain, net } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import * as nodeNet from "node:net";
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

type ProgressPayload = {
  percent: number;
  phase: string;
};

type NativeGpuInfo = {
  detected: boolean;
  name: string | null;
  driverVersion: string | null;
  source: string | null;
  diagnostics: string[];
};

let backendProcess: ChildProcess | null = null;
let backendLogTail = "";
let backendLastExitCode: number | null = null;
let backendPort = 0;

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer();

    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        if (!port) {
          reject(new Error("Windows did not provide a free local port."));
          return;
        }

        resolve(port);
      });
    });
  });
}

function apiBaseUrl() {
  if (!backendPort) {
    throw new Error("Backend port has not been initialized.");
  }
  return `http://127.0.0.1:${backendPort}/api`;
}

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

async function detectNativeGpu(): Promise<NativeGpuInfo> {
  const diagnostics: string[] = [];
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";

  const candidates = [
    path.join(systemRoot, "System32", "nvidia-smi.exe"),
    path.join(programFiles, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
    "nvidia-smi",
  ];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;

    const result = await runProcess(candidate, [
      "--query-gpu=name,driver_version",
      "--format=csv,noheader,nounits",
    ]);

    if (result.code === 0 && result.output.trim()) {
      const firstLine = result.output.trim().split(/\r?\n/)[0];
      const [name, driverVersion] = firstLine.split(",").map((part) => part.trim());
      if (name) {
        diagnostics.push(`NVIDIA GPU detected with nvidia-smi: ${candidate}`);
        return {
          detected: true,
          name,
          driverVersion: driverVersion || null,
          source: "nvidia-smi",
          diagnostics,
        };
      }
    } else if (result.output.trim()) {
      diagnostics.push(`nvidia-smi failed at ${candidate}: ${result.output.trim()}`);
    }
  }

  if (process.platform === "win32") {
    const script = [
      "$gpu = Get-CimInstance Win32_VideoController |",
      "Where-Object { $_.Name -match 'NVIDIA' } |",
      "Select-Object -First 1 Name,DriverVersion;",
      "if ($gpu) { $gpu | ConvertTo-Json -Compress }",
    ].join(" ");

    const cim = await runProcess("powershell.exe", [
      "-NoProfile",
      "-Command",
      script,
    ]);

    if (cim.code === 0 && cim.output.trim()) {
      try {
        const parsed = JSON.parse(cim.output.trim()) as {
          Name?: string;
          DriverVersion?: string;
        };

        if (parsed.Name) {
          diagnostics.push("NVIDIA GPU detected with Windows CIM");
          return {
            detected: true,
            name: parsed.Name,
            driverVersion: parsed.DriverVersion ?? null,
            source: "windows-cim",
            diagnostics,
          };
        }
      } catch (error) {
        diagnostics.push(
          `Windows CIM returned invalid data: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      diagnostics.push("Windows CIM did not report an NVIDIA display adapter");
    }
  }

  return {
    detected: false,
    name: null,
    driverVersion: null,
    source: null,
    diagnostics,
  };
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
  options: { cwd?: string; onOutput?: (text: string) => void } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      options.onOutput?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      options.onOutput?.(text);
    });

    child.on("error", (error: Error) => {
      resolve({ code: -1, output: `${output}\n${error.message}` });
    });

    child.on("exit", (code: number | null) => {
      resolve({ code, output });
    });
  });
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (percent: number) => void,
) {
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destination, bytes);
    onProgress?.(100);
    return;
  }

  const handle = fs.openSync(destination, "w");
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      fs.writeSync(handle, chunk);
      received += chunk.length;

      if (total > 0) {
        onProgress?.(Math.min(100, Math.round((received / total) * 100)));
      }
    }
  } finally {
    fs.closeSync(handle);
  }

  onProgress?.(100);
}

function startBackend() {
  if (backendProcess && backendProcess.exitCode === null) return;

  const config = readConfig();
  backendProcess = spawn(
    pythonExecutable(),
    [
      "-m", "uvicorn", "app.main:app",
      "--host", "127.0.0.1",
      "--port", String(backendPort),
    ],
    {
      cwd: backendDir(),
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...(config.wanSourceDir ? { WAN22_SOURCE_DIR: config.wanSourceDir } : {}),
        ...(config.outputDir ? { WAN22_OUTPUT_DIR: config.outputDir } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  backendLogTail = "";
  backendLastExitCode = null;

  backendProcess.stdout?.on("data", (chunk) => {
    const line = String(chunk);
    backendLogTail = (backendLogTail + line).slice(-12000);
    console.log(`[backend] ${line.trimEnd()}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    const line = String(chunk);
    backendLogTail = (backendLogTail + line).slice(-12000);
    console.error(`[backend] ${line.trimEnd()}`);
  });
  backendProcess.on("error", (error) => {
    backendLogTail = (backendLogTail + "\n" + error.message).slice(-12000);
    console.error(`[backend] failed to start: ${error.message}`);
    backendProcess = null;
  });
  backendProcess.on("exit", (code) => {
    backendLastExitCode = code;
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
  ipcMain.handle("desktop:get-api-base-url", () => apiBaseUrl());
  ipcMain.handle("desktop:get-native-gpu", () => detectNativeGpu());
  ipcMain.handle("desktop:get-backend-status", async () => {
    let apiReachable = false;
    let apiStatus: number | null = null;

    try {
      const response = await net.fetch(`${apiBaseUrl()}/health`);
      apiReachable = response.ok;
      apiStatus = response.status;
    } catch {
      apiReachable = false;
    }

    return {
      processRunning: Boolean(backendProcess && backendProcess.exitCode === null),
      apiReachable,
      apiStatus,
      pythonPath: pythonExecutable(),
      port: backendPort,
      apiBaseUrl: apiBaseUrl(),
      lastExitCode: backendLastExitCode,
      logTail: backendLogTail,
    };
  });

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
      const previous = readConfig();
      const next = writeConfig(patch);
      const backendConfigChanged =
        patch.wanSourceDir !== undefined && patch.wanSourceDir !== previous.wanSourceDir ||
        patch.outputDir !== undefined && patch.outputDir !== previous.outputDir ||
        patch.pythonPath !== undefined && patch.pythonPath !== previous.pythonPath;

      if (backendConfigChanged) {
        restartBackend();
      }
      return next;
    },
  );

  ipcMain.handle("desktop:setup-python-runtime", async (event) => {
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

    const setupStages: Array<[RegExp, ProgressPayload]> = [
      [/Downloading pinned uv/i, { percent: 5, phase: "Downloading setup tools" }],
      [/Installing managed Python/i, { percent: 12, phase: "Installing Python 3.11" }],
      [/Creating isolated Python environment/i, { percent: 20, phase: "Creating Python environment" }],
      [/Updating pip tooling/i, { percent: 28, phase: "Updating Python tools" }],
      [/Preparing writable backend package/i, { percent: 33, phase: "Preparing desktop backend" }],
      [/Installing Wan2\.2 Desktop backend/i, { percent: 36, phase: "Installing desktop backend" }],
      [/Installing PyTorch CUDA runtime/i, { percent: 46, phase: "Installing PyTorch/CUDA" }],
      [/Installing Wan dependencies/i, { percent: 68, phase: "Installing Wan dependencies" }],
      [/Installing Wan TI2V Windows dependencies/i, { percent: 82, phase: "Installing TI2V compatibility modules" }],
      [/Patching Wan imports for desktop-supported tasks/i, { percent: 86, phase: "Applying Wan desktop compatibility patch" }],
      [/Patching Wan attention fallback for Windows/i, { percent: 89, phase: "Configuring PyTorch SDPA fallback" }],
      [/Installing Wan source package/i, { percent: 90, phase: "Installing Wan runtime package" }],
      [/Using PyTorch SDPA/i, { percent: 94, phase: "Configuring attention backend" }],
      [/Running runtime diagnostics/i, { percent: 97, phase: "Checking GPU runtime" }],
    ];

    event.sender.send("desktop:python-progress", {
      percent: 1,
      phase: "Starting setup",
    } satisfies ProgressPayload);

    const result = await runProcess(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", script,
        "-BackendDir", backendDir(),
        "-RuntimeRoot", runtimeRoot,
        "-WanSourceDir", wanSourceDir,
      ],
      {
        onOutput: (text) => {
          for (const [pattern, progress] of setupStages) {
            if (pattern.test(text)) {
              event.sender.send("desktop:python-progress", progress);
              break;
            }
          }
        },
      },
    );

    const pythonPath = path.join(runtimeRoot, "python", "Scripts", "python.exe");
    if (result.code === 0 && fs.existsSync(pythonPath)) {
      const nextConfig = writeConfig({ pythonPath });
      event.sender.send("desktop:python-progress", {
        percent: 100,
        phase: "Python/CUDA ready",
      } satisfies ProgressPayload);
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

  ipcMain.handle("desktop:install-wan-runtime", async (event) => {
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
      event.sender.send("desktop:wan-progress", {
        percent: 100,
        phase: "Wan runtime installed",
      } satisfies ProgressPayload);
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

      event.sender.send("desktop:wan-progress", {
        percent: 1,
        phase: "Starting download",
      } satisfies ProgressPayload);

      await downloadFile(WAN_ARCHIVE_URL, archivePath, (downloadPercent) => {
        const overallPercent = Math.max(
          2,
          Math.min(78, Math.round(downloadPercent * 0.76) + 2),
        );
        event.sender.send("desktop:wan-progress", {
          percent: overallPercent,
          phase: `Downloading Wan 2.2 (${downloadPercent}%)`,
        } satisfies ProgressPayload);
      });

      event.sender.send("desktop:wan-progress", {
        percent: 82,
        phase: "Extracting Wan 2.2",
      } satisfies ProgressPayload);
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

      event.sender.send("desktop:wan-progress", {
        percent: 94,
        phase: "Verifying runtime",
      } satisfies ProgressPayload);

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
      event.sender.send("desktop:wan-progress", {
        percent: 100,
        phase: "Wan runtime installed",
      } satisfies ProgressPayload);
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

app.whenReady().then(async () => {
  backendPort = await findAvailablePort();
  console.log(`[backend] selected local port ${backendPort}`);
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
