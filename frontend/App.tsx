import { FormEvent, useEffect, useMemo, useState } from "react";

type Health = {
  status: string;
  backend: string;
  provider: string;
  providerReady: boolean;
};

type Gpu = {
  name: string;
  total_vram_mb: number | null;
  driver_version: string | null;
  source: string;
};

type Hardware = {
  os: string;
  machine: string;
  nvidia_gpu_detected: boolean;
  nvidia_driver_detected: boolean;
  cuda_available: boolean;
  cuda_version: string | null;
  torch_available: boolean;
  torch_version: string | null;
  detection_sources: string[];
  diagnostics: string[];
  gpus: Gpu[];
};

type NativeGpu = {
  detected: boolean;
  name: string | null;
  driverVersion: string | null;
  source: string | null;
  diagnostics: string[];
};

type BackendStatus = {
  processRunning: boolean;
  apiReachable: boolean;
  apiStatus: number | null;
  pythonPath: string;
  port: number;
  apiBaseUrl: string;
  lastExitCode: number | null;
  logTail: string;
};

type GenerationJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  phase: string;
  outputPath: string;
  error?: string | null;
};

function ProgressBar({
  percent,
  phase,
}: {
  percent: number;
  phase: string;
}) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className="progress-block" aria-live="polite">
      <div className="progress-meta">
        <span>{phase}</span>
        <strong>{safePercent}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safePercent}
      >
        <div
          className="progress-fill"
          style={{ width: `${safePercent}%` }}
        />
      </div>
    </div>
  );
}

let API = "http://127.0.0.1:8000/api";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [nativeGpu, setNativeGpu] = useState<NativeGpu | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [prompt, setPrompt] = useState("");
  const [checkpointDir, setCheckpointDir] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [mode, setMode] = useState<"text" | "image">("text");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [installingRuntime, setInstallingRuntime] = useState(false);
  const [settingUpPython, setSettingUpPython] = useState(false);
  const [pythonReady, setPythonReady] = useState(false);
  const [runtimeInstalled, setRuntimeInstalled] = useState(false);
  const [wanProgress, setWanProgress] = useState<DesktopProgress | null>(null);
  const [pythonProgress, setPythonProgress] = useState<DesktopProgress | null>(null);
  const [desktopReady, setDesktopReady] = useState(false);
  const [modelDownload, setModelDownload] = useState<GenerationJob | null>(null);

  async function refreshNativeGpu() {
    const desktop = window.wanDesktop;
    if (!desktop) return;

    try {
      setNativeGpu(await desktop.getNativeGpu());
    } catch (reason) {
      setNativeGpu({
        detected: false,
        name: null,
        driverVersion: null,
        source: null,
        diagnostics: [
          reason instanceof Error ? reason.message : String(reason),
        ],
      });
    }
  }

  async function refreshBackendStatus() {
    const desktop = window.wanDesktop;
    if (!desktop) return null;

    try {
      const status = await desktop.getBackendStatus();
      setBackendStatus(status);
      return status;
    } catch {
      return null;
    }
  }

  async function refreshRuntime() {
    try {
      const [healthResponse, hardwareResponse] = await Promise.all([
        fetch(`${API}/health`),
        fetch(`${API}/hardware`),
      ]);

      if (!healthResponse.ok || !hardwareResponse.ok) {
        throw new Error("Backend responded with an error");
      }

      setHealth(await healthResponse.json());
      setHardware(await hardwareResponse.json());
      await refreshBackendStatus();
      setError(null);
    } catch (reason) {
      const status = await refreshBackendStatus();

      if (status?.apiReachable) {
        setError(
          "The backend API is running, but the desktop renderer could not access it. Reinstall the latest build with the desktop CORS fix.",
        );
      } else if (status?.processRunning) {
        setError("The backend process is running but its HTTP API is not ready yet.");
      } else if (status?.lastExitCode !== null && status?.lastExitCode !== undefined) {
        setError(
          `The backend exited with code ${status.lastExitCode}. Open Backend diagnostics for details.`,
        );
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }

  useEffect(() => {
    const desktop = window.wanDesktop;
    if (!desktop) return;

    const unsubscribeWan = desktop.onWanProgress((progress) => {
      setWanProgress(progress);
    });
    const unsubscribePython = desktop.onPythonProgress((progress) => {
      setPythonProgress(progress);
    });

    return () => {
      unsubscribeWan();
      unsubscribePython();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeDesktop() {
      const desktop = window.wanDesktop;
      setDesktopReady(Boolean(desktop));

      if (desktop) {
        API = await desktop.getApiBaseUrl();
        await refreshNativeGpu();
        await refreshBackendStatus();
        const config = await desktop.getConfig();
        if (!cancelled && config.checkpointDir) {
          setCheckpointDir(config.checkpointDir);
        }
        if (!cancelled && config.wanSourceDir) {
          setRuntimeInstalled(true);
        }
        if (!cancelled && config.pythonPath) {
          setPythonReady(true);

          for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
            try {
              const response = await fetch(`${API}/health`);
              if (response.ok) break;
            } catch {
              // Managed Python backend may still be starting.
            }
            await new Promise((resolve) => window.setTimeout(resolve, 500));
          }

          if (!cancelled) await refreshRuntime();
        } else if (!cancelled) {
          setError(null);
        }
      } else if (!cancelled) {
        setError(null);
      }
    }

    void initializeDesktop();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!modelDownload || !["queued", "running"].includes(modelDownload.status)) return;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API}/models/download/${modelDownload.id}`);
        if (!response.ok) return;
        const next = (await response.json()) as GenerationJob;
        setModelDownload(next);

        if (next.status === "completed") {
          setCheckpointDir(next.outputPath);
          if (window.wanDesktop) {
            await window.wanDesktop.saveConfig({ checkpointDir: next.outputPath });
          }
        }
      } catch {
        // Preserve current state during transient backend restarts.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [modelDownload]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API}/generations/${job.id}`);
        if (!response.ok) return;
        setJob(await response.json());
      } catch {
        // A temporary backend disconnect should not destroy the current job state.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [job]);

  const gpuSummary = useMemo(() => {
    if (hardware?.nvidia_gpu_detected && hardware.gpus.length > 0) {
      return hardware.gpus
        .map((gpu) => {
          const vram = gpu.total_vram_mb
            ? `${(gpu.total_vram_mb / 1024).toFixed(0)} GB`
            : null;
          return [gpu.name, vram].filter(Boolean).join(" · ");
        })
        .join(", ");
    }

    if (nativeGpu?.detected) {
      return nativeGpu.name ?? "NVIDIA GPU detected";
    }

    if (nativeGpu) return "No NVIDIA GPU detected";
    return "Checking GPU…";
  }, [hardware, nativeGpu]);

  async function refreshHardware() {
    await refreshNativeGpu();
    await refreshBackendStatus();

    if (pythonReady) {
      await refreshRuntime();
    } else {
      setError(null);
    }
  }

  async function chooseCheckpointDir() {
    const desktop = window.wanDesktop;
    if (!desktop) return;

    const selected = await desktop.chooseDirectory("Choose Wan2.2 model folder");
    if (!selected) return;

    setCheckpointDir(selected);
    await desktop.saveConfig({ checkpointDir: selected });
  }

  async function downloadDefaultModel() {
    const desktop = window.wanDesktop;
    if (!desktop) {
      setError("Model download is available in the desktop app.");
      return;
    }

    const destination = await desktop.chooseDirectory("Choose model storage folder");
    if (!destination) return;

    setError(null);
    try {
      const response = await fetch(`${API}/models/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_id: "Wan-AI/Wan2.2-TI2V-5B",
          destination,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Model download could not be started");
      }

      setModelDownload(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseImage() {
    const desktop = window.wanDesktop;
    if (!desktop) return;

    const selected = await desktop.chooseImage();
    if (selected) setImagePath(selected);
  }

  async function setupPythonRuntime() {
    const desktop = window.wanDesktop;
    if (!desktop) return;

    setSettingUpPython(true);
    setPythonProgress({ percent: 1, phase: "Starting setup" });
    setError(null);
    try {
      const result = await desktop.setupPythonRuntime();
      if (!result.ok) {
        throw new Error(result.error || result.output || "Python runtime setup failed");
      }
      setPythonReady(true);
      setPythonProgress({ percent: 100, phase: "Python/CUDA ready" });

      let connected = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        try {
          const response = await fetch(`${API}/health`);
          if (response.ok) {
            connected = true;
            break;
          }
        } catch {
          // Backend is restarting under the managed environment.
        }
      }

      if (connected) {
        await refreshRuntime();
      } else {
        setError("Python/CUDA setup completed, but the local backend did not start.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSettingUpPython(false);
    }
  }

  async function installRuntime() {
    const desktop = window.wanDesktop;
    if (!desktop) {
      setError("Runtime installation is available in the desktop app.");
      return;
    }

    setInstallingRuntime(true);
    setWanProgress({ percent: 1, phase: "Starting Wan installation" });
    setError(null);

    try {
      const result = await desktop.installWanRuntime();
      if (!result.ok) {
        throw new Error(result.error || result.output || "Wan runtime installation failed");
      }

      setRuntimeInstalled(true);
      setWanProgress({ percent: 100, phase: "Wan runtime installed" });
      setError(null);

      // Do not probe the FastAPI backend yet. It is expected to be offline
      // until the managed Python/CUDA environment has been installed.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstallingRuntime(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (window.wanDesktop && checkpointDir) {
        await window.wanDesktop.saveConfig({ checkpointDir });
      }

      const response = await fetch(`${API}/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "ti2v-5B",
          prompt,
          checkpoint_dir: checkpointDir,
          size: orientation === "landscape" ? "1280*704" : "704*1280",
          image_path: mode === "image" ? imagePath : null,
          offload_model: true,
          convert_model_dtype: true,
          t5_cpu: true,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Generation could not be started");
      }

      setJob(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    const response = await fetch(`${API}/generations/${job.id}/cancel`, {
      method: "POST",
    });
    if (response.ok) setJob(await response.json());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span>Wan2.2 Desktop</span>
        </div>
        <span className={health?.providerReady ? "pill ready" : "pill"}>
          {health?.providerReady ? "Wan runtime ready" : "Runtime setup required"}
        </span>
      </header>

      <section className="hero">
        <span className="eyebrow">LOCAL VIDEO GENERATION</span>
        <h1>Turn an idea into motion.</h1>
        <p className="subtitle">
          Local Wan 2.2 generation with a desktop workflow, model controls and
          GPU-aware defaults.
        </p>
      </section>

      {!health?.providerReady && (
        <section className="setup-banner panel">
          <div>
            <span className="step">SETUP</span>
            <h2>Install the official Wan 2.2 runtime</h2>
            <p>
              Step 1 downloads the official Wan runtime. Step 2 creates the
              managed Python/CUDA environment. The local API is expected to stay
              offline until step 2 is complete.
            </p>
          </div>
          <div className="setup-actions">
            <button
              className="secondary"
              type="button"
              disabled={!desktopReady || installingRuntime || runtimeInstalled}
              onClick={() => void installRuntime()}
            >
              {installingRuntime
                ? "Installing Wan…"
                : runtimeInstalled
                  ? "Wan runtime installed"
                  : "1. Install Wan runtime"}
            </button>
            <button
              className="generate compact"
              type="button"
              disabled={!desktopReady || !runtimeInstalled || settingUpPython || pythonReady}
              onClick={() => void setupPythonRuntime()}
            >
              {settingUpPython
                ? "Setting up Python/CUDA…"
                : pythonReady
                  ? "Python/CUDA ready"
                  : "2. Setup Python/CUDA"}
            </button>
          </div>

          {(installingRuntime || wanProgress) && (
            <div className="setup-progress">
              <ProgressBar
                percent={wanProgress?.percent ?? 0}
                phase={wanProgress?.phase ?? "Preparing Wan runtime"}
              />
            </div>
          )}

          {(settingUpPython || pythonProgress) && (
            <div className="setup-progress">
              <ProgressBar
                percent={pythonProgress?.percent ?? 0}
                phase={pythonProgress?.phase ?? "Preparing Python/CUDA"}
              />
            </div>
          )}
        </section>
      )}

      <section className="workspace">
        <form className="generator panel" onSubmit={submit}>
          <div className="section-heading">
            <div>
              <span className="step">01</span>
              <h2>Generate</h2>
            </div>
            <div className="segmented">
              <button
                type="button"
                className={mode === "text" ? "active" : ""}
                onClick={() => setMode("text")}
              >
                Text
              </button>
              <button
                type="button"
                className={mode === "image" ? "active" : ""}
                onClick={() => setMode("image")}
              >
                Image
              </button>
            </div>
          </div>

          <label>
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the shot, subject, movement, camera and mood…"
              rows={7}
              required
            />
          </label>

          {mode === "image" && (
            <label>
              <span>Input image</span>
              <div className="input-with-button">
                <input
                  value={imagePath}
                  onChange={(event) => setImagePath(event.target.value)}
                  placeholder="Choose a reference image"
                  required
                />
                <button
                  className="secondary inline"
                  type="button"
                  disabled={!desktopReady}
                  onClick={() => void chooseImage()}
                >
                  Browse
                </button>
              </div>
            </label>
          )}

          <label>
            <span>Wan2.2-TI2V-5B model folder</span>
            <div className="input-with-button">
              <input
                value={checkpointDir}
                onChange={(event) => setCheckpointDir(event.target.value)}
                placeholder="Choose or download the model"
                required
              />
              <button
                className="secondary inline"
                type="button"
                disabled={!desktopReady}
                onClick={() => void chooseCheckpointDir()}
              >
                Browse
              </button>
            </div>
          </label>

          <div className="model-actions">
            <button
              className="secondary"
              type="button"
              disabled={!desktopReady || ["queued", "running"].includes(modelDownload?.status ?? "")}
              onClick={() => void downloadDefaultModel()}
            >
              {["queued", "running"].includes(modelDownload?.status ?? "")
                ? "Downloading Wan2.2-TI2V-5B…"
                : "Download Wan2.2-TI2V-5B"}
            </button>
            {modelDownload && (
              <span className="download-status">
                {modelDownload.status === "completed"
                  ? "Model ready"
                  : modelDownload.phase || modelDownload.status}
              </span>
            )}
          </div>

          {modelDownload && (
            <ProgressBar
              percent={modelDownload.progress ?? 0}
              phase={
                modelDownload.status === "completed"
                  ? "Model ready"
                  : modelDownload.phase || "Downloading model"
              }
            />
          )}

          <div className="field-row">
            <label>
              <span>Frame</span>
              <select
                value={orientation}
                onChange={(event) =>
                  setOrientation(event.target.value as "landscape" | "portrait")
                }
              >
                <option value="landscape">Landscape · 1280×704</option>
                <option value="portrait">Portrait · 704×1280</option>
              </select>
            </label>

            <label>
              <span>Model</span>
              <select disabled value="ti2v-5B">
                <option value="ti2v-5B">Wan 2.2 TI2V · 5B</option>
              </select>
            </label>
          </div>

          <button
            className="generate"
            disabled={submitting || !health?.providerReady || !checkpointDir}
          >
            {submitting ? "Starting…" : "Generate video"}
          </button>

          {!health?.providerReady && (
            <p className="hint">
              Install or select the Wan runtime before generating.
            </p>
          )}
        </form>

        <aside className="side-column">
          <section className="panel runtime">
            <span className="step">02</span>
            <h2>Machine</h2>
            <dl>
              <div>
                <dt>GPU</dt>
                <dd>{gpuSummary}</dd>
              </div>
              <div>
                <dt>NVIDIA driver</dt>
                <dd>
                  {hardware?.nvidia_driver_detected
                    ? hardware.gpus.find((gpu) => gpu.driver_version)?.driver_version ?? "Detected"
                    : nativeGpu?.driverVersion
                      ? nativeGpu.driverVersion
                      : nativeGpu?.detected
                        ? "GPU detected, driver version unavailable"
                        : nativeGpu
                          ? "Not detected"
                          : "Checking…"}
                </dd>
              </div>
              <div>
                <dt>PyTorch</dt>
                <dd>
                  {hardware
                    ? hardware.torch_available
                      ? hardware.torch_version ?? "Installed"
                      : "Not available"
                    : pythonReady
                      ? "Backend offline"
                      : "Setup required"}
                </dd>
              </div>
              <div>
                <dt>CUDA</dt>
                <dd>
                  {hardware
                    ? hardware.cuda_available
                      ? `Available${hardware.cuda_version ? ` · CUDA ${hardware.cuda_version}` : ""}`
                      : hardware.torch_available
                        ? "PyTorch loaded, CUDA unavailable"
                        : "PyTorch/CUDA not ready"
                    : pythonReady
                      ? "Backend offline, CUDA not checked"
                      : "Waiting for Python/CUDA setup"}
                </dd>
              </div>
              <div>
                <dt>Detection</dt>
                <dd>
                  {hardware?.detection_sources?.length
                    ? hardware.detection_sources.join(", ")
                    : nativeGpu?.source
                      ? `${nativeGpu.source} (desktop)`
                      : nativeGpu
                        ? "Desktop check completed"
                        : "Checking…"}
                </dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>
                  {health?.status === "ok"
                    ? "Connected"
                    : backendStatus?.apiReachable
                      ? "API reachable · renderer blocked"
                      : backendStatus?.processRunning
                        ? "Process running · API starting"
                        : backendStatus?.lastExitCode !== null &&
                            backendStatus?.lastExitCode !== undefined
                          ? `Exited · code ${backendStatus.lastExitCode}`
                          : "Offline"}
                </dd>
              </div>
              <div>
                <dt>Desktop bridge</dt>
                <dd>{desktopReady ? "Ready" : "Browser preview"}</dd>
              </div>
            </dl>
            {(hardware?.diagnostics?.length || nativeGpu?.diagnostics?.length) ? (
              <details className="hardware-diagnostics">
                <summary>Hardware diagnostics</summary>
                <ul>
                  {(hardware?.diagnostics ?? nativeGpu?.diagnostics ?? []).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {backendStatus ? (
              <details className="hardware-diagnostics">
                <summary>Backend diagnostics</summary>
                <ul>
                  <li>Python: {backendStatus.pythonPath}</li>
                  <li>API URL: {backendStatus.apiBaseUrl}</li>
                  <li>Port: {backendStatus.port}</li>
                  <li>
                    Process: {backendStatus.processRunning ? "running" : "not running"}
                  </li>
                  <li>
                    API: {backendStatus.apiReachable
                      ? `reachable (HTTP ${backendStatus.apiStatus ?? "?"})`
                      : "not reachable"}
                  </li>
                  {backendStatus.lastExitCode !== null ? (
                    <li>Last exit code: {backendStatus.lastExitCode}</li>
                  ) : null}
                </ul>
                {backendStatus.logTail ? (
                  <pre className="backend-log">{backendStatus.logTail}</pre>
                ) : null}
              </details>
            ) : null}

            <button className="secondary" type="button" onClick={() => void refreshHardware()}>
              Refresh hardware
            </button>
          </section>

          <section className="panel job-panel">
            <span className="step">03</span>
            <h2>Generation</h2>
            {!job ? (
              <p className="empty">No job running yet.</p>
            ) : (
              <div className="job">
                <div className="job-line">
                  <span className={`job-dot ${job.status}`} />
                  <strong>{job.status}</strong>
                </div>
                <code>{job.id.slice(0, 12)}</code>
                <ProgressBar
                  percent={job.progress ?? 0}
                  phase={job.phase || job.status}
                />
                {job.status === "completed" && (
                  <p className="output-path">{job.outputPath}</p>
                )}
                {job.error && <p className="job-error">{job.error}</p>}
                {["queued", "running"].includes(job.status) && (
                  <button className="secondary" type="button" onClick={() => void cancelJob()}>
                    Cancel
                  </button>
                )}
              </div>
            )}
          </section>
        </aside>
      </section>

      {error && <div className="error-banner">{error}</div>}
    </main>
  );
}
