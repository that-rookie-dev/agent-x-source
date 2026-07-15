import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, dialog, nativeImage, shell, safeStorage, systemPreferences } from 'electron';
import { writeFileSync } from 'node:fs';
import { join, basename } from 'path';
import { existsSync, createWriteStream, unlinkSync, mkdtempSync, readFileSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { tmpdir, totalmem } from 'os';
import { AgentRuntime, createDesktopRuntimeOptions, DEFAULT_PORT } from '@agentx/runtime';

const REPO = 'that-rookie-dev/agent-x';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let agentRuntime: AgentRuntime | null = null;
const PORT = DEFAULT_PORT;

const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;

function getAppVersion(): string {
  try {
    // In packaged app, app.getVersion() reads from the app's package.json correctly
    if (app.isPackaged) return app.getVersion();
    // In dev, app.getVersion() may return Electron's version (42.x.x) instead of ours
    // Read the version directly from our package.json
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return app.getVersion();
  }
}

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred.\n\n${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('Unhandled rejection:', msg);
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred.\n\n${msg}`);
});

// ==================== Utilities ====================

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewerVersion(current: string, latest: string): boolean {
  const cur = parseVersion(current);
  const lat = parseVersion(latest);
  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const a = cur[i] || 0;
    const b = lat[i] || 0;
    if (a !== b) return b > a;
  }
  return false;
}

function getPlatformAssetFilter(name: string): boolean {
  const n = name.toLowerCase();
  if (process.platform === 'darwin') return n.endsWith('.dmg');
  if (process.platform === 'win32') return n.includes('setup') && n.endsWith('.exe');
  return n.endsWith('.appimage');
}

// ==================== Update Manager ====================

async function fetchLatestRelease(): Promise<{ tag_name: string; assets: { name: string; browser_download_url: string }[] } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'agent-x', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function downloadAsset(url: string, destPath: string, onProgress?: (pct: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'agent-x' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  let downloaded = 0;
  const file = createWriteStream(destPath);
  const reader = res.body!.getReader();
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { file.close(); return; }
      file.write(Buffer.from(value));
      downloaded += value.length;
      if (total && onProgress) onProgress(Math.round((downloaded / total) * 100));
    }
  };
  await pump();
}

function installUpdate(downloadPath: string): void {
  const fail = (msg: string) => {
    console.error('Install failed:', msg);
    dialog.showErrorBox('Update Failed', msg);
  };
  switch (process.platform) {
    case 'darwin': {
      const mountDir = join(tmpdir(), 'agentx-update-' + Date.now());
      const attach = spawn('hdiutil', ['attach', '-mountpoint', mountDir, '-nobrowse', downloadPath]);
      attach.on('exit', (code) => {
        if (code !== 0) { return fail(`hdiutil attach exited with code ${code}`); }
        const src = join(mountDir, 'Agent-X.app');
        const dest = '/Applications/Agent-X.app';
        if (!existsSync(src)) {
          spawn('hdiutil', ['detach', mountDir, '-quiet']);
          return fail(`DMG does not contain Agent-X.app`);
        }
        spawn('rm', ['-rf', dest]).on('exit', () => {
          spawn('cp', ['-Rp', src, dest]).on('exit', (cpCode) => {
            if (cpCode !== 0) { return fail(`cp exited with code ${cpCode}`); }
            spawn('hdiutil', ['detach', mountDir, '-quiet']).on('exit', () => {
              try { unlinkSync(downloadPath); } catch {}
              app.relaunch();
              app.exit(0);
            });
          });
        });
      });
      break;
    }
    case 'win32': {
      const proc = spawn(downloadPath, ['/S']);
      proc.on('exit', (code) => {
        if (code !== 0) { return fail(`Installer exited with code ${code}`); }
        try { unlinkSync(downloadPath); } catch {}
        app.relaunch();
        app.exit(0);
      });
      break;
    }
    default: {
      spawn('chmod', ['+x', downloadPath]).on('exit', (code) => {
        if (code !== 0) { return fail(`chmod exited with code ${code}`); }
        const child = spawn(downloadPath, process.argv.slice(1), {
          stdio: 'inherit', detached: true,
        });
        child.unref();
        app.exit(0);
      });
    }
  }
}

function createProgressWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360, height: 140, parent: mainWindow || undefined,
    modal: true, frame: false, center: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#1e1e2e',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`data:text/html,<!DOCTYPE html>
<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#1e1e2e;color:#cdd6f4;font-family:system-ui,sans-serif;">
<div id="text" style="margin-bottom:16px;font-size:13px;">Downloading update...</div>
<div style="width:280px;height:6px;background:#45475a;border-radius:3px;overflow:hidden;">
<div id="progress" style="width:0%;height:100%;background:#89b4fa;border-radius:3px;transition:width .2s;"></div></div></body></html>`);
  return win;
}

async function checkForUpdates(manual = false): Promise<boolean> {
  try {
    const release = await fetchLatestRelease();
    if (!release || !release.tag_name) {
      if (manual) dialog.showErrorBox('Update Error', 'Could not fetch release info from GitHub.');
      return false;
    }

    const latestVer = release.tag_name.replace(/^v/, '');
    const currentVer = getAppVersion();

    if (!isNewerVersion(currentVer, latestVer)) {
      if (manual) {
        dialog.showMessageBox({ type: 'info', title: 'Up to Date', message: `Agent-X ${currentVer} is the latest version.` });
      }
      return false;
    }

    const asset = release.assets.find(a => getPlatformAssetFilter(a.name));
    if (!asset) {
      if (manual) dialog.showMessageBox({ type: 'error', title: 'Update Error', message: 'No compatible update found for your platform.' });
      return false;
    }

    if (!mainWindow) return false;

    const updateChoice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: `Agent-X ${latestVer} is available.`,
      detail: `You are currently on ${currentVer}. Would you like to download and install the update?`,
      buttons: ['Download Update', 'Skip'],
      defaultId: 0,
      cancelId: 1,
    });

    if (updateChoice.response !== 0) return false;

    // Download
    const tempDir = mkdtempSync(join(tmpdir(), 'agentx-update-'));
    const destPath = join(tempDir, basename(asset.name));

    const progressWin = createProgressWindow();
    await downloadAsset(asset.browser_download_url, destPath, (pct) => {
      progressWin.webContents.executeJavaScript(
        `document.getElementById('progress').style.width='${pct}%';document.getElementById('text').textContent='${pct}%';`
      ).catch(() => {});
    });
    if (!progressWin.isDestroyed()) progressWin.close();

    // Ask to install
    const installChoice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Download Complete',
      message: 'Update downloaded successfully.',
      detail: 'Install the update now? The app will restart.',
      buttons: ['Install & Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (installChoice.response !== 0) {
      try { unlinkSync(destPath); } catch {}
      return false;
    }

    installUpdate(destPath);
    return true;
  } catch (err) {
    console.error('Update failed', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Update Failed', err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}

// ==================== Server ====================

function createAgentRuntime(): AgentRuntime {
  return new AgentRuntime(createDesktopRuntimeOptions({
    isDev,
    getResourcesPath: () => process.resourcesPath,
    getDataDir: () => app.getPath('userData'),
    getDevMonorepoRoot: () => join(__dirname, '..', '..', '..'),
    vaultStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      decryptString: (buffer) => safeStorage.decryptString(buffer),
      encryptString: (text) => safeStorage.encryptString(text),
    },
  }));
}

async function startServer(): Promise<void> {
  agentRuntime = createAgentRuntime();
  // setupPythonEnv runs inside runtime.start() with the rest of the staged boot.
  await agentRuntime.start();
}

async function stopServer(): Promise<void> {
  if (agentRuntime) {
    await agentRuntime.stop();
    agentRuntime = null;
  }
}

async function stopEmbeddedPostgres(): Promise<void> {
  if (agentRuntime) {
    await agentRuntime.stopEmbeddedPostgres();
  }
}

// ==================== External links ====================

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function openExternalLink(url: string): Promise<boolean> {
  if (!isExternalHttpUrl(url)) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('openExternal failed', err);
    return false;
  }
}

function attachExternalLinkHandlers(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void openExternalLink(url);
    }
    return { action: 'deny' };
  });
}

// ==================== Window ====================

async function notifyAppVisibility(visible: boolean): Promise<void> {
  try {
    await fetch(`http://localhost:${PORT}/api/system/app-visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible }),
    });
  } catch { /* server may not be ready yet */ }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 500,
    title: 'Agent-X', show: false,
    titleBarStyle: 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  const appOrigin = `http://localhost:${PORT}`;
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const reqOrigin = details.requestingUrl ? new URL(details.requestingUrl).origin : '';
    // navigator.clipboard.writeText requires this permission in Electron.
    if (permission === 'clipboard-sanitized-write' && reqOrigin === appOrigin) {
      callback(true);
      return;
    }
    if (permission === 'geolocation' && reqOrigin === appOrigin) {
      console.log('granting geolocation for app origin');
      callback(true);
      return;
    }
    if (permission === 'media') {
      const mediaDetails = details as Electron.MediaAccessPermissionRequest;
      const mediaTypes = mediaDetails.mediaTypes ?? [];
      const wantsMic = mediaTypes.includes('audio') || mediaTypes.length === 0;
      if (wantsMic && reqOrigin === appOrigin) {
        console.log('granting microphone for app origin');
        callback(true);
        return;
      }
      console.log(`denying microphone for origin ${reqOrigin}`);
      callback(false);
      return;
    }
    callback(false);
  });

  mainWindow.loadURL(appOrigin);

  attachExternalLinkHandlers(mainWindow);

  // Clear webview cache on each launch to prevent stale assets
  mainWindow.webContents.session.clearCache().catch(() => {});

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    void notifyAppVisibility(true);
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'bottom' });
  });

  mainWindow.on('hide', () => { void notifyAppVisibility(false); });
  mainWindow.on('show', () => { void notifyAppVisibility(true); });

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });
}

// ==================== Tray ====================

function resolveAppIconPath(): string | null {
  const iconPath = join(process.resourcesPath, 'build', 'icon.png');
  const iconDev = join(__dirname, '..', 'build', 'icon.png');
  if (existsSync(iconPath)) return iconPath;
  if (existsSync(iconDev)) return iconDev;
  return null;
}

function createTray(): void {
  let icon: Electron.NativeImage;
  const trayPath = join(process.resourcesPath, 'build', 'tray.png');
  const fallbackPath = join(process.resourcesPath, 'build', 'icon.png');
  const trayDev = join(__dirname, '..', 'build', 'tray.png');
  const iconDev = join(__dirname, '..', 'build', 'icon.png');
  const found = existsSync(trayPath) ? trayPath : existsSync(trayDev) ? trayDev : existsSync(fallbackPath) ? fallbackPath : existsSync(iconDev) ? iconDev : null;
  if (found) {
    icon = nativeImage.createFromPath(found);
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 20, height: 20 });
      icon.setTemplateImage(true);
    } else {
      icon = icon.resize({ width: 16, height: 16 });
    }
    tray = new Tray(icon);
  } else {
    icon = nativeImage.createEmpty();
    tray = new Tray(icon);
  }
  tray.setToolTip('Agent-X — Starting...');

  const updateMenu = {
    label: 'Check for Updates…',
    click: () => { checkForUpdates(true); },
  };

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Agent-X', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    updateMenu,
    { type: 'separator' },
    { label: 'Quit Agent-X', click: () => { isQuitting = true; app.quit(); } },
  ]));

  tray.on('click', () => {
    tray?.popUpContextMenu();
  });
}

function registerHotkey(): void {
  const ok = globalShortcut.register('Alt+A', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
  if (!ok) console.warn('Failed to register global hotkey Alt+A');
}

// ==================== IPC ====================

ipcMain.on('app:isPackaged', (event) => { event.returnValue = app.isPackaged; });
ipcMain.on('system:totalMemoryGB', (event) => {
  event.returnValue = Math.round(totalmem() / (1024 ** 3) * 10) / 10;
});
ipcMain.on('system:localModelSupported', (event) => {
  event.returnValue = totalmem() / (1024 ** 3) >= 32;
});
ipcMain.on('system:neuralBrainSupported', (event) => {
  event.returnValue = totalmem() / (1024 ** 3) >= 16;
});
ipcMain.on('system:styleTtsSupported', (event) => {
  event.returnValue = totalmem() / (1024 ** 3) >= 16;
});
ipcMain.on('system:voiceWarmupSupported', (event) => {
  event.returnValue = totalmem() / (1024 ** 3) >= 8;
});
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('permissions:requestNotifications', async () => {
  if (!Notification.isSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const icon = resolveAppIconPath();
    // macOS shows the system permission prompt on first notification.
    const n = new Notification({
      title: 'Agent-X',
      body: 'Notifications enabled for automation alerts.',
      icon: icon ?? undefined,
      silent: true,
    });
    n.show();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('notifications:show', async (_event, payload: { title?: string; body: string; subtitle?: string }) => {
  if (!Notification.isSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!payload?.body) {
    return { ok: false, reason: 'missing_body' };
  }
  try {
    const icon = resolveAppIconPath();
    const n = new Notification({
      title: payload.title ?? 'Agent-X',
      body: payload.body.slice(0, 2000),
      subtitle: payload.subtitle,
      icon: icon ?? undefined,
    });
    n.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('notifications:navigate');
    });
    n.show();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle('path:defaultWorkspace', () => app.getPath('desktop'));
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a project folder',
    buttonLabel: 'Choose folder',
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle('dialog:openFile', async (_event, filters?: Array<{ name: string; extensions: string[] }>) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select a file',
    buttonLabel: 'Choose file',
    filters: filters?.length ? filters : undefined,
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle('dialog:saveFile', async (_event, opts?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save file',
    defaultPath: opts?.defaultPath,
    filters: opts?.filters?.length ? opts.filters : [{ name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePath ?? null;
});
ipcMain.handle('file:writeBytes', async (_event, filePath: string, data: Uint8Array | number[]) => {
  if (!filePath || typeof filePath !== 'string') return { ok: false };
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  writeFileSync(filePath, bytes);
  return { ok: true };
});
ipcMain.handle('permissions:checkNodeRuntime', async () => {
  const tryVersion = (cmd: string): string | undefined => {
    try {
      const out = execFileSync(cmd, ['--version'], { timeout: 5000 }).toString().trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  };
  const node = tryVersion('node');
  const npx = tryVersion('npx');
  return { node, npx, ok: Boolean(node && npx) };
});
ipcMain.handle('permissions:checkMicrophone', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    return { granted: status === 'granted', state: status };
  }
  return { granted: true, state: 'unknown' };
});
ipcMain.handle('permissions:requestMicrophone', async () => {
  // macOS requires an OS-level TCC prompt before getUserMedia can succeed.
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return { granted };
  }
  return { granted: true };
});
ipcMain.handle('permissions:openMicrophoneSettings', async () => {
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    return;
  }
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:privacy-microphone');
  }
});
ipcMain.handle('shell:openExternal', async (_event, url: string) => openExternalLink(url));
ipcMain.handle('window:openInternal', async (_event, url: string) => {
  const internal = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 800, minHeight: 600,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  const target = url.startsWith('http') ? url : `http://localhost:${PORT}${url.startsWith('/') ? '' : '/'}${url}`;
  await internal.loadURL(target);
  return true;
});

// ==================== App Lifecycle ====================

app.whenReady().then(async () => {
  try {
    createTray();
    await startServer();
    tray?.setToolTip(`Agent-X — Running on port ${PORT}`);
    createWindow();
    registerHotkey();
    if (Notification.isSupported()) {
      try {
        new Notification({ title: 'Agent-X', body: 'Desktop notifications are ready.', silent: true }).show();
      } catch { /* permission may be denied */ }
    }
    // Auto-check for updates (non-blocking, manual=false)
    if (!isDev) checkForUpdates(false);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        new Notification({ title: 'Agent-X', body: 'Running in the background. Click the tray icon to open.' }).show();
      }
    }, 2000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Failed to start', err);
    dialog.showErrorBox('Startup Error', `Agent-X failed to start.\n\n${msg}`);
    app.quit();
  }
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await stopServer();
});

app.on('before-quit', async () => {
  await stopEmbeddedPostgres();
});

process.on('SIGTERM', async () => {
  await stopEmbeddedPostgres();
  app.quit();
});

process.on('SIGINT', async () => {
  await stopEmbeddedPostgres();
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});
app.on('before-quit', () => { isQuitting = true; });
