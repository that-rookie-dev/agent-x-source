/// <reference types="vite/client" />

interface AgentXDesktopBridge {
  platform: string;
  isPackaged: boolean;
  isDesktop: boolean;
  totalMemoryGB: number;
  localModelSupported: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  openFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    agentx?: AgentXDesktopBridge;
  }
}

export {};
