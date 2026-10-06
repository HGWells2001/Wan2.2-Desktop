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
};

type Hardware = {
  os: string;
  machine: string;
  cuda_available: boolean;
  gpus: Gpu[];
};

type GenerationJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  outputPath: string;
  error?: string | null;
};

const API = "http://127.0.0.1:8000/api";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [prompt, setPrompt] = useState("");
  const [checkpointDir, setCheckpointDir] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [mode, setMode] = useState<"text" | "image">("text");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [installingRuntime, setInstallingRuntime] = useState(false);
  const [desktopReady, setDesktopReady] = useState(false);
  const [modelDownload, setModelDownload] = useState<GenerationJob | null>(null);

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
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initializeDesktop() {
      const desktop = window.wanDesktop;
      setDesktopReady(Boolean(desktop));

      if (desktop) {
        const config = await desktop.getConfig();
        if (!cancelled && config.checkpointDir) {
          setCheckpointDir(config.checkpointDir);
        }
      }

      for (let attempt = 0; attempt < 12 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`${API}/health`);
          if (response.ok) break;
        } catch {
          // Electron may still be starting the local Python backend.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }

      if (!cancelled) await refreshRuntime();
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
    if (!hardware) return "Checking GPU…";
    if (!hardware.cuda_available || hardware.gpus.length === 0) return "No NVIDIA GPU detected";

    return hardware.gpus
      .map((gpu) => {
        const vram = gpu.total_vram_mb
          ? `${(gpu.total_vram_mb / 1024).toFixed(0)} GB`
          : "VRAM unknown";
        return `${gpu.name} · ${vram}`;
      })
      .join(", ");
  }, [hardware]);

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

  async function installRuntime() {
    const desktop = window.wanDesktop;
    if (!desktop) {
      setError("Runtime installation is available in the desktop app.");
      return;
    }

    setInstallingRuntime(true);
    setError(null);

    try {
      const result = await desktop.installWanRuntime();
      if (!result.ok) {
        throw new Error(result.error || result.output || "Wan runtime installation failed");
      }

      for (let attempt = 0; attempt < 16; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        try {
          const response = await fetch(`${API}/health`);
          if (response.ok) {
            const nextHealth = (await response.json()) as Health;
            setHealth(nextHealth);
            if (nextHealth.providerReady) break;
          }
        } catch {
          // Backend is restarting with the new runtime path.
        }
      }

      await refreshRuntime();
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
              Wan2.2 Desktop can clone the official runtime into its private app
              data folder and remember it automatically.
            </p>
          </div>
          <button
            className="generate compact"
            type="button"
            disabled={!desktopReady || installingRuntime}
            onClick={() => void installRuntime()}
          >
            {installingRuntime ? "Installing runtime…" : "Install Wan 2.2 runtime"}
          </button>
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
                  : modelDownload.status}
              </span>
            )}
          </div>

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
                <dt>CUDA</dt>
                <dd>{hardware?.cuda_available ? "Available" : "Not detected"}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd>{health?.status === "ok" ? "Connected" : "Offline"}</dd>
              </div>
              <div>
                <dt>Desktop bridge</dt>
                <dd>{desktopReady ? "Ready" : "Browser preview"}</dd>
              </div>
            </dl>
            <button className="secondary" type="button" onClick={() => void refreshRuntime()}>
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
