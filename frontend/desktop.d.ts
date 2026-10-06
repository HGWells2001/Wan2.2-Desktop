export {};

declare global {
  type DesktopProgress = {
    percent: number;
    phase: string;
  };

  interface Window {
    wanDesktop?: {
      platform: string;
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
