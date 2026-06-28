import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, dialog, nativeImage, shell, safeStorage } from 'electron';
import { join, basename } from 'path';
import { existsSync, createWriteStream, unlinkSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { Server } from 'http';
import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'node:crypto';
import { PostgresLifecycleManager } from './PostgresLifecycleManager.js';

const REPO = 'SlashpanOrg/agent-x';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let server: Server | null = null;
let pgManager: PostgresLifecycleManager | null = null;
const PORT = 3333;
const EMBEDDED_PG_PORT = 3335;

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
    console.error('Update failed:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Update Failed', err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}

// ==================== Server ====================

function getPythonPath(): string {
  if (isDev) {
    return process.env['AGENTX_PYTHON_PATH'] || 'python3';
  }
  if (process.platform === 'win32') {
    return join(process.resourcesPath, 'python', 'python.exe');
  }
  return join(process.resourcesPath, 'python', 'bin', 'python3');
}

function setupPythonEnv(): void {
  const pythonPath = getPythonPath();
  const pythonDir = process.platform === 'win32'
    ? join(process.resourcesPath, 'python')
    : join(process.resourcesPath, 'python', 'bin');

  if (existsSync(pythonPath)) {
    process.env['AGENTX_PYTHON_PATH'] = pythonPath;
    process.env['PATH'] = pythonDir + (process.platform === 'win32' ? ';' : ':') + (process.env['PATH'] || '');
    console.log(`Bundled Python: ${pythonPath}`);
  } else if (isDev) {
    console.log('Development mode: using system Python');
  } else {
    console.warn('Bundled Python not found at', pythonPath);
  }
}

function getWebApiPath(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-api', 'dist', 'index.js');
  return join(process.resourcesPath, 'web-api', 'index.js');
}

function getWebUiDir(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-ui', 'dist');
  return join(process.resourcesPath, 'web-ui');
}

function getWebNeuronDir(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-neuron', 'dist');
  return join(process.resourcesPath, 'web-neuron');
}

function loadShellPath(): void {
  if (process.platform !== 'darwin') return;
  try {
    const shellPath = execSync('/bin/bash -l -c "echo $PATH"', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (shellPath && shellPath !== process.env['PATH']) {
      process.env['PATH'] = shellPath;
    }
  } catch {
    /* ignore — binaries are bundled */
  }
}

async function startEmbeddedPostgres(): Promise<string | null> {
  // If a connection string is already provided externally, do not start embedded PG.
  if (process.env['AGENTX_POSTGRES_CONNECTION_STRING']) {
    return process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
  }

  const dataDir = join(app.getPath('userData'), 'brain_db');
  pgManager = new PostgresLifecycleManager({
    dataDir,
    port: EMBEDDED_PG_PORT,
    host: '127.0.0.1',
    user: 'agentx',
    password: 'agentx',
    database: 'agentx',
    onLog: (msg) => console.log(`[PG] ${msg}`),
    onError: (msg) => console.error(`[PG] ${msg}`),
  });

  try {
    const connectionString = await pgManager.start();
    process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = connectionString;
    process.env['AGENTX_EMBEDDED_PG_ENABLED'] = '1';
    return connectionString;
  } catch (e) {
    pgManager = null;
    throw e;
  }
}

async function stopEmbeddedPostgres(): Promise<void> {
  if (pgManager) {
    await pgManager.stop();
    pgManager = null;
  }
}

async function initializeVaultKey(): Promise<void> {
  const configDir = join(app.getPath('userData'), 'vault');
  mkdirSync(configDir, { recursive: true });
  const keyFile = join(configDir, 'vault-key.enc');

  if (safeStorage.isEncryptionAvailable() && existsSync(keyFile)) {
    try {
      const encrypted = readFileSync(keyFile);
      const key = safeStorage.decryptString(encrypted);
      process.env['AGENTX_VAULT_KEY'] = key;
      return;
    } catch (e) {
      console.error('Failed to decrypt vault key, generating new one:', e);
    }
  }

  const key = randomBytes(32).toString('base64');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(key);
      writeFileSync(keyFile, encrypted);
    } catch (e) {
      console.error('Failed to encrypt vault key:', e);
    }
  }
  process.env['AGENTX_VAULT_KEY'] = key;
}

async function startServer(): Promise<void> {
  const apiPath = getWebApiPath();
  const uiDir = getWebUiDir();
  const neuronDir = getWebNeuronDir();

  if (!existsSync(apiPath)) {
    throw new Error(`Web-API not found at ${apiPath}`);
  }

  loadShellPath();

  // Start the bundled native PostgreSQL before the web-api so it has a connection string ready.
  await startEmbeddedPostgres();

  await initializeVaultKey();

  process.env['AGENTX_UI_DIR'] = uiDir;
  process.env['AGENTX_NEURON_DIR'] = neuronDir;
  process.env['PORT'] = String(PORT);
  process.env['NODE_ENV'] = 'production';

  const mod = await import(apiPath);
  if (mod.server) server = mod.server as Server;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  await stopEmbeddedPostgres();
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
    console.error('openExternal failed:', err);
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

  mainWindow.loadURL(`http://localhost:${PORT}`);

  attachExternalLinkHandlers(mainWindow);

  // Clear webview cache on each launch to prevent stale assets
  mainWindow.webContents.session.clearCache().catch(() => {});

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'bottom' });
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });
}

// ==================== Tray ====================

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
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a project folder',
    buttonLabel: 'Choose folder',
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
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
    setupPythonEnv();
    await startServer();
    tray?.setToolTip(`Agent-X — Running on port ${PORT}`);
    createWindow();
    registerHotkey();
    // Auto-check for updates (non-blocking, manual=false)
    if (!isDev) checkForUpdates(false);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        new Notification({ title: 'Agent-X', body: 'Running in the background. Click the tray icon to open.' }).show();
      }
    }, 2000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Failed to start:', err);
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
