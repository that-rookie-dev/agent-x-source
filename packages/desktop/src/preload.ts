import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentx', {
  platform: process.platform,
  isPackaged: ipcRenderer.sendSync('app:isPackaged'),
  isDesktop: true,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openInternalWindow: (url: string) => ipcRenderer.invoke('window:openInternal', url),
});
