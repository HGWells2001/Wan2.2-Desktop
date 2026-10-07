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

type PromptOptimizerMode = "off" | "fast" | "ai";

type PromptOptimizationResponse = {
  original_prompt: string;
  optimized_prompt: string;
  optimizer: "fast" | "ai";
  model?: string | null;
  device?: string | null;
  message?: string | null;
};

type ModelProfile = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  engine: "wan-upstream" | "diffusers-gguf";
  task: string;
  modes: Array<"text" | "image">;
  sizes: string[];
  default_size: string;
  quantization?: string | null;
  recommended: boolean;
  experimental: boolean;
  download_label: string;
  vram_note: string;
};

const FALLBACK_5B_PROFILE: ModelProfile = {
  id: "ti2v-5b",
  name: "Wan 2.2 TI2V 5B",
  short_name: "TI2V 5B",
  description: "Official Wan 2.2 hybrid 5B model for text and image video generation.",
  engine: "wan-upstream",
  task: "ti2v-5B",
  modes: ["text", "image"],
  sizes: ["1280*704", "704*1280"],
  default_size: "1280*704",
  quantization: null,
  recommended: false,
  experimental: false,
  download_label: "Download Wan2.2 TI2V-5B",
  vram_note: "Official low-memory profile.",
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
  const [promptOptimizer, setPromptOptimizer] = useState<PromptOptimizerMode>("fast");
  const [optimizingPrompt, setOptimizingPrompt] = useState(false);
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null);
  const [promptOptimizationNote, setPromptOptimizationNote] = useState<string | null>(null);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("ti2v-5b");
  const [modelPaths, setModelPaths] = useState<Record<string, string>>({});
  const [checkpointDir, setCheckpointDir] = useState("");
  const [selectedSize, setSelectedSize] = useState("1280*704");
  const [imagePath, setImagePath] = useState("");
  const [mode, setMode] = useState<"text" | "image">("text");
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
  const [modelDownloadTargetId, setModelDownloadTargetId] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () =>
      modelProfiles.find((profile) => profile.id === selectedModelId) ??
      FALLBACK_5B_PROFILE,
    [modelProfiles, selectedModelId],
  );

  useEffect(() => {
    if (!selectedProfile.sizes.includes(selectedSize)) {
      setSelectedSize(selectedProfile.default_size);
    }
    if (!selectedProfile.modes.includes(mode)) {
      setMode("text");
      setImagePath("");
    }
  }, [selectedProfile, selectedSize, mode]);

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
      const [healthResponse, hardwareResponse, modelsResponse] = await Promise.all([
        fetch(`${API}/health`),
        fetch(`${API}/hardware`),
        fetch(`${API}/models`),
      ]);

      if (!healthResponse.ok || !hardwareResponse.ok || !modelsResponse.ok) {
        throw new Error("Backend responded with an error");
      }

      setHealth(await healthResponse.json());
      setHardware(await hardwareResponse.json());
      const catalog = (await modelsResponse.json()) as {
        defaultModelId: string;
        models: ModelProfile[];
      };
      setModelProfiles(catalog.models);
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
        const restoredModelId = config.selectedModelId ?? "ti2v-5b";
        const restoredPaths: Record<string, string> = {
          ...(config.checkpointDir ? { "ti2v-5b": config.checkpointDir } : {}),
          ...(config.modelPaths ?? {}),
        };

        if (!cancelled) {
          setSelectedModelId(restoredModelId);
          setModelPaths(restoredPaths);
          setCheckpointDir(restoredPaths[restoredModelId] ?? "");
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

        if (next.status === "completed" && modelDownloadTargetId) {
          const nextPaths = {
            ...modelPaths,
            [modelDownloadTargetId]: next.outputPath,
          };
          setModelPaths(nextPaths);

          if (modelDownloadTargetId === selectedModelId) {
            setCheckpointDir(next.outputPath);
          }

          if (window.wanDesktop) {
            await window.wanDesktop.saveConfig({
              modelPaths: nextPaths,
              selectedModelId,
              ...(modelDownloadTargetId === "ti2v-5b"
                ? { checkpointDir: next.outputPath }
                : {}),
            });
          }
        }
      } catch {
        // Preserve current state during transient backend restarts.
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [modelDownload, modelDownloadTargetId, modelPaths, selectedModelId]);

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

    const selected = await desktop.chooseDirectory(`Choose ${selectedProfile.short_name} model folder`);
    if (!selected) return;

    const nextPaths = { ...modelPaths, [selectedModelId]: selected };
    setModelPaths(nextPaths);
    setCheckpointDir(selected);
    await desktop.saveConfig({
      selectedModelId,
      modelPaths: nextPaths,
      ...(selectedModelId === "ti2v-5b" ? { checkpointDir: selected } : {}),
    });
  }

  async function selectModel(modelId: string) {
    const profile =
      modelProfiles.find((candidate) => candidate.id === modelId) ??
      FALLBACK_5B_PROFILE;

    setSelectedModelId(modelId);
    setCheckpointDir(modelPaths[modelId] ?? "");
    setSelectedSize(profile.default_size);

    if (!profile.modes.includes(mode)) {
      setMode("text");
      setImagePath("");
    }

    if (window.wanDesktop) {
      await window.wanDesktop.saveConfig({ selectedModelId: modelId });
    }
  }

  async function downloadSelectedModel() {
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
          model_id: selectedModelId,
          destination,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Model download could not be started");
      }

      setModelDownloadTargetId(selectedModelId);
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
        const outputTail = result.output?.trim().slice(-7000);
        const message = [
          result.error || "Python runtime setup failed",
          outputTail || null,
        ].filter(Boolean).join("\n\n");
        throw new Error(message);
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

  async function optimizePrompt() {
    const sourcePrompt = prompt.trim();
    if (!sourcePrompt) {
      setError("Write a prompt before optimizing it.");
      return;
    }
    if (promptOptimizer === "off") return;

    setOptimizingPrompt(true);
    setError(null);
    setPromptOptimizationNote(null);

    try {
      const response = await fetch(`${API}/prompts/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sourcePrompt,
          optimizer: promptOptimizer,
          video_mode: mode,
          seed: -1,
        }),
      });

      const payload = (await response.json()) as PromptOptimizationResponse & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(payload.detail ?? "Prompt optimization failed");
      }

      setOriginalPrompt((current) => current ?? sourcePrompt);
      setPrompt(payload.optimized_prompt);
      setPromptOptimizationNote(
        payload.optimizer === "ai"
          ? `Optimized with ${payload.model ?? "Qwen"}${payload.device ? ` · ${payload.device}` : ""}`
          : "Fast Wan2.2 optimization applied",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOptimizingPrompt(false);
    }
  }

  function restoreOriginalPrompt() {
    if (originalPrompt === null) return;
    setPrompt(originalPrompt);
    setOriginalPrompt(null);
    setPromptOptimizationNote(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (window.wanDesktop && checkpointDir) {
        const nextPaths = { ...modelPaths, [selectedModelId]: checkpointDir };
        setModelPaths(nextPaths);
        await window.wanDesktop.saveConfig({
          selectedModelId,
          modelPaths: nextPaths,
          ...(selectedModelId === "ti2v-5b" ? { checkpointDir } : {}),
        });
      }

      const response = await fetch(`${API}/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: selectedModelId,
          task: selectedProfile.task,
          prompt,
          checkpoint_dir: checkpointDir,
          size: selectedSize,
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
                disabled={!selectedProfile.modes.includes("image")}
                title={
                  selectedProfile.modes.includes("image")
                    ? undefined
                    : "This A14B GGUF profile currently supports Text-to-Video only."
                }
                onClick={() => {
                  if (selectedProfile.modes.includes("image")) setMode("image");
                }}
              >
                Image
              </button>
            </div>
          </div>

          <label>
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setPromptOptimizationNote(null);
              }}
              placeholder="Describe the shot, subject, movement, camera and mood…"
              rows={7}
              required
            />
          </label>

          <div className="prompt-optimizer">
            <div className="prompt-optimizer-controls">
              <label className="prompt-optimizer-mode">
                <span>Prompt optimizer</span>
                <select
                  value={promptOptimizer}
                  onChange={(event) =>
                    setPromptOptimizer(event.target.value as PromptOptimizerMode)
                  }
                >
                  <option value="off">Off · use prompt unchanged</option>
                  <option value="fast">Fast · instant Wan tuning</option>
                  <option value="ai">AI · Qwen2.5-3B</option>
                </select>
              </label>

              <button
                className="secondary prompt-optimize-button"
                type="button"
                disabled={
                  promptOptimizer === "off" ||
                  optimizingPrompt ||
                  !pythonReady ||
                  !prompt.trim() ||
                  ["queued", "running"].includes(job?.status ?? "")
                }
                onClick={() => void optimizePrompt()}
              >
                {optimizingPrompt
                  ? "Optimizing…"
                  : promptOptimizer === "ai"
                    ? "✨ Optimize with AI"
                    : "✨ Optimize prompt"}
              </button>

              {originalPrompt !== null ? (
                <button
                  className="secondary prompt-restore-button"
                  type="button"
                  disabled={optimizingPrompt}
                  onClick={restoreOriginalPrompt}
                >
                  Restore original
                </button>
              ) : null}
            </div>

            <p className="prompt-optimizer-hint">
              {promptOptimizer === "off"
                ? "The prompt is sent to Wan2.2 exactly as written."
                : promptOptimizer === "ai"
                  ? "Uses Qwen2.5-3B to rewrite the prompt in English for Wan2.2. First use may download the Qwen model."
                  : mode === "image"
                    ? "Instant optimizer: preserves the reference image and strengthens motion, camera and temporal consistency."
                    : "Instant optimizer: strengthens action, camera, lighting and temporal consistency without loading another model."}
            </p>

            {promptOptimizationNote ? (
              <p className="prompt-optimizer-status">{promptOptimizationNote}</p>
            ) : null}
          </div>

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

          <div className="model-profile-card">
            <div className="field-row">
              <label>
                <span>Model</span>
                <select
                  value={selectedModelId}
                  disabled={["queued", "running"].includes(modelDownload?.status ?? "")}
                  onChange={(event) => void selectModel(event.target.value)}
                >
                  {(modelProfiles.length ? modelProfiles : [FALLBACK_5B_PROFILE]).map(
                    (profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                        {profile.recommended ? " · Recommended" : ""}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                <span>Resolution</span>
                <select
                  value={selectedSize}
                  onChange={(event) => setSelectedSize(event.target.value)}
                >
                  {selectedProfile.sizes.map((size) => (
                    <option key={size} value={size}>
                      {size.replace("*", "×")}
                      {size === selectedProfile.default_size ? " · Recommended" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="model-profile-meta">
              <div className="model-badges">
                {selectedProfile.id === "ti2v-5b" ? (
                  <span className="model-badge official">Official</span>
                ) : null}
                {selectedProfile.quantization ? (
                  <span className="model-badge">{selectedProfile.quantization}</span>
                ) : null}
                {selectedProfile.recommended ? (
                  <span className="model-badge recommended">3090 pick</span>
                ) : null}
                {selectedProfile.experimental ? (
                  <span className="model-badge experimental">Experimental</span>
                ) : null}
              </div>
              <p>{selectedProfile.description}</p>
              <small>{selectedProfile.vram_note}</small>
            </div>

            <label>
              <span>{selectedProfile.short_name} model folder</span>
              <div className="input-with-button">
                <input
                  value={checkpointDir}
                  onChange={(event) => {
                    setCheckpointDir(event.target.value);
                    setModelPaths((current) => ({
                      ...current,
                      [selectedModelId]: event.target.value,
                    }));
                  }}
                  placeholder="Choose or download the selected model"
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
                disabled={
                  !desktopReady ||
                  !pythonReady ||
                  ["queued", "running"].includes(modelDownload?.status ?? "")
                }
                onClick={() => void downloadSelectedModel()}
              >
                {["queued", "running"].includes(modelDownload?.status ?? "")
                  ? `Downloading ${selectedProfile.short_name}…`
                  : selectedProfile.download_label}
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

            {selectedProfile.engine === "diffusers-gguf" ? (
              <p className="hint model-warning">
                A14B GGUF is Text-to-Video only in this build. Q4_K_M is the
                recommended starting point for a 24 GB RTX 3090. The 5B model
                remains available and unchanged.
              </p>
            ) : null}
          </div>

          <button
            className="generate"
            disabled={
              submitting ||
              optimizingPrompt ||
              !health?.providerReady ||
              !checkpointDir
            }
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

            <div className="machine-actions">
              <button className="secondary" type="button" onClick={() => void refreshHardware()}>
                Refresh hardware
              </button>
              {runtimeInstalled && pythonReady ? (
                <button
                  className="secondary"
                  type="button"
                  disabled={settingUpPython}
                  onClick={() => void setupPythonRuntime()}
                >
                  {settingUpPython ? "Repairing dependencies…" : "Repair Wan dependencies"}
                </button>
              ) : null}
            </div>
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
