export {};

declare global {
  interface Window {
    wanDesktop?: {
      platform: string;
      getConfig(): Promise<{
        wanSourceDir?: string;
        checkpointDir?: string;
        outputDir?: string;
      }>;
      chooseDirectory(title: string): Promise<string | null>;
      chooseImage(): Promise<string | null>;
      saveConfig(patch: Record<string, string | undefined>): Promise<{
        wanSourceDir?: string;
        checkpointDir?: string;
        outputDir?: string;
      }>;
      installWanRuntime(): Promise<{
        ok: boolean;
        path?: string;
        reused?: boolean;
        error?: string;
        output?: string;
      }>;
    };
  }
}
