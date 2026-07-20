/// <reference types="vite/client" />

interface AgentXDesktopBridge {
  platform: string;
  isPackaged: boolean;
  isDesktop: boolean;
  totalMemoryGB: number;
  localModelSupported: boolean;
  cortexReady: boolean;
  cortexDegraded: boolean;
  styleTtsSupported: boolean;
  voiceWarmupSupported: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  openFolder: () => Promise<string | null>;
  openFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  saveFile: (opts?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  writeFileBytes: (filePath: string, data: Uint8Array) => Promise<{ ok: boolean }>;
  checkNodeRuntime: () => Promise<{ node?: string; npx?: string; ok: boolean }>;
  defaultWorkspace: () => Promise<string>;
  requestNotifications: () => Promise<{ ok: boolean; reason?: string }>;
  showNotification: (payload: { title?: string; body: string; subtitle?: string }) => Promise<{ ok: boolean; reason?: string }>;
  onNotificationClick: (callback: () => void) => () => void;
  openExternal: (url: string) => Promise<boolean>;
  openInternalWindow: (url: string) => Promise<boolean>;
  checkMicrophoneAccess: () => Promise<{ granted: boolean; state: string }>;
  requestMicrophoneAccess: () => Promise<{ granted: boolean }>;
  openMicrophoneSettings: () => Promise<void>;
}

declare global {
  interface Window {
    agentx?: AgentXDesktopBridge;
  }
}

export {};
