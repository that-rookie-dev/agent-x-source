import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentx', {
  platform: process.platform,
  isPackaged: ipcRenderer.sendSync('app:isPackaged'),
  isDesktop: true,
  totalMemoryGB: ipcRenderer.sendSync('system:totalMemoryGB'),
  localModelSupported: ipcRenderer.sendSync('system:localModelSupported'),
  neuralBrainSupported: ipcRenderer.sendSync('system:neuralBrainSupported'),
  styleTtsSupported: ipcRenderer.sendSync('system:styleTtsSupported'),
  voiceWarmupSupported: ipcRenderer.sendSync('system:voiceWarmupSupported'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
    ipcRenderer.invoke('dialog:openFile', filters) as Promise<string | null>,
  saveFile: (opts?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke('dialog:saveFile', opts) as Promise<string | null>,
  writeFileBytes: (filePath: string, data: Uint8Array) =>
    ipcRenderer.invoke('file:writeBytes', filePath, data) as Promise<{ ok: boolean }>,
  checkNodeRuntime: () =>
    ipcRenderer.invoke('permissions:checkNodeRuntime') as Promise<{ node?: string; npx?: string; ok: boolean }>,
  defaultWorkspace: () => ipcRenderer.invoke('path:defaultWorkspace') as Promise<string>,
  requestNotifications: () => ipcRenderer.invoke('permissions:requestNotifications'),
  showNotification: (payload: { title?: string; body: string; subtitle?: string }) =>
    ipcRenderer.invoke('notifications:show', payload) as Promise<{ ok: boolean; reason?: string }>,
  onNotificationClick: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('notifications:navigate', handler);
    return () => ipcRenderer.removeListener('notifications:navigate', handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openInternalWindow: (url: string) => ipcRenderer.invoke('window:openInternal', url),
  /** IANA timezone from the desktop shell — geolocation still comes from the renderer. */
  getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  checkMicrophoneAccess: () =>
    ipcRenderer.invoke('permissions:checkMicrophone') as Promise<{ granted: boolean; state: string }>,
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke('permissions:requestMicrophone') as Promise<{ granted: boolean }>,
  openMicrophoneSettings: () =>
    ipcRenderer.invoke('permissions:openMicrophoneSettings') as Promise<void>,
});
