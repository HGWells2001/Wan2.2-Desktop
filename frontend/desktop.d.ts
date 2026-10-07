export {};

declare global {
  type DesktopProgress = {
    percent: number;
    phase: string;
  };

  interface Window {
    wanDesktop?: {
      platform: string;
      getApiBaseUrl(): Promise<string>;
      getBackendStatus(): Promise<{
        processRunning: boolean;
        apiReachable: boolean;
        apiStatus: number | null;
        pythonPath: string;
        port: number;
        apiBaseUrl: string;
        lastExitCode: number | null;
        logTail: string;
      }>;
      getNativeGpu(): Promise<{
        detected: boolean;
        name: string | null;
        driverVersion: string | null;
        source: string | null;
        diagnostics: string[];
      }>;
      getConfig(): Promise<{
        wanSourceDir?: string;
        checkpointDir?: string;
        outputDir?: string;
        pythonPath?: string;
      }>;
      chooseDirectory(title: string): Promise<string | null>;
      chooseImage(): Promise<string | null>;
      saveConfig(patch: Record<string, string | undefined>): Promise<{
        wanSourceDir?: string;
        checkpointDir?: string;
        outputDir?: string;
        pythonPath?: string;
      }>;
      installWanRuntime(): Promise<{
        ok: boolean;
        path?: string;
        reused?: boolean;
        error?: string;
        output?: string;
      }>;
      setupPythonRuntime(): Promise<{
        ok: boolean;
        pythonPath?: string;
        error?: string;
        output?: string;
      }>;
      onWanProgress(callback: (progress: DesktopProgress) => void): () => void;
      onPythonProgress(callback: (progress: DesktopProgress) => void): () => void;
    };
  }
}
