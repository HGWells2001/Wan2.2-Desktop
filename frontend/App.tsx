import { useEffect, useState } from "react";

type Health = {
  status: string;
  backend: string;
  provider: string;
  providerReady: boolean;
};

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/health")
      .then((response) => {
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);
        return response.json();
      })
      .then(setHealth)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <span className="eyebrow">LOCAL VIDEO GENERATION</span>
        <h1>Wan2.2 Desktop</h1>
        <p className="subtitle">
          A native desktop workspace for local Wan 2.2 generation.
        </p>
      </section>

      <section className="panel">
        <div>
          <h2>Runtime</h2>
          <p>Frontend and desktop shell are ready for the Wan inference adapter.</p>
        </div>
        <div className="status">
          {health ? (
            <>
              <strong>{health.backend}</strong>
              <span>{health.provider}</span>
              <span>{health.providerReady ? "Provider ready" : "Provider stub"}</span>
            </>
          ) : error ? (
            <>
              <strong>Backend offline</strong>
              <span>{error}</span>
              <span>Start the Python backend on port 8000.</span>
            </>
          ) : (
            <span>Checking backend…</span>
          )}
        </div>
      </section>
    </main>
  );
}
