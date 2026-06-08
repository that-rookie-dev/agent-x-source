import { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, dialog, nativeImage } from 'electron';
import { join, basename } from 'path';
import { existsSync, createWriteStream, unlinkSync, mkdtempSync, readFileSync } from 'fs';
import type { Server } from 'http';
import { spawn } from 'child_process';
import { tmpdir } from 'os';

const REPO = 'SlashpanOrg/agent-x';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let server: Server | null = null;
const PORT = 3333;

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

function getWebApiPath(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-api', 'dist', 'index.js');
  return join(process.resourcesPath, 'web-api', 'index.js');
}

function getWebUiDir(): string {
  if (isDev) return join(__dirname, '..', '..', 'web-ui', 'dist');
  return join(process.resourcesPath, 'web-ui');
}

async function startServer(): Promise<void> {
  const apiPath = getWebApiPath();
  const uiDir = getWebUiDir();

  if (!existsSync(apiPath)) {
    throw new Error(`Web-API not found at ${apiPath}`);
  }

  process.env['AGENTX_UI_DIR'] = uiDir;
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
  const candidates = [
    join(__dirname, '..', 'build', process.platform === 'darwin' ? 'Tray.png' : 'TrayWin.png'),
    join(__dirname, '..', 'build', 'icon.png'),
    join(process.resourcesPath, 'build', 'icon.png'),
  ];
  const found = candidates.find(p => existsSync(p));
  if (found) {
    icon = nativeImage.createFromPath(found).resize({ width: 16, height: 16 });
  } else {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
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
    title: 'Choose a project folder',
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

// ==================== App Lifecycle ====================

app.whenReady().then(async () => {
  try {
    createTray();
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
    console.error('Failed to start:', err);
    app.quit();
  }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); stopServer(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});
app.on('before-quit', () => { isQuitting = true; });
