/// <reference types="vite/client" />

interface AgentXDesktopBridge {
  platform: string;
  isPackaged: boolean;
  isDesktop: boolean;
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralBrainSupported: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  openFolder: () => Promise<string | null>;
  defaultWorkspace: () => Promise<string>;
  requestNotifications: () => Promise<{ ok: boolean; reason?: string }>;
  showNotification: (payload: { title?: string; body: string; subtitle?: string }) => Promise<{ ok: boolean; reason?: string }>;
  onNotificationClick: (callback: () => void) => () => void;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    agentx?: AgentXDesktopBridge;
  }
}

export {};
