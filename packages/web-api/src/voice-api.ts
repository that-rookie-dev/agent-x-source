import { Router } from 'express';
import { execFile, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getDataDir, getLogger, type VoiceCapabilityStatus, type VoiceConfig, type VoiceDownloadedAsset, buildPublicSystemCapabilities } from '@agentx/shared';
import {
  VOICE_ASSET_CATALOG,
  VoiceAssetManager,
  VoiceSidecarManager,
  bootstrapBundledVoiceAssets,
  getBundledAssetIds,
  getDefaultDownloadAssetIds,
  getManifestEntry,
  isVoiceAssetInstalled,
  loadVoiceModelsManifest,
  mergeVoiceConfig,
  registerAliasAssets,
  resolveVoiceBundleDir,
  resolveVoiceManifestPath,
} from '@agentx/engine';
import { getEngine } from './engine.js';

const execFileAsync = promisify(execFile);
const router: import('express').Router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

function voiceInfo(message: string, context?: Record<string, unknown>): void {
  getLogger().info('VOICE', message, context);
}

function voiceWarn(message: string, context?: Record<string, unknown>): void {
  getLogger().warn('VOICE', message, context);
}

function voiceDebug(message: string, context?: Record<string, unknown>): void {
  getLogger().debug('VOICE', message, context);
}

function voiceError(message: string, error: unknown, context?: Record<string, unknown>): void {
  getLogger().error('VOICE', error instanceof Error ? error : new Error(String(error)), {
    ...context,
    detail: message,
  });
}

function logVoiceEnvironment(label: string): void {
  voiceInfo(`${label}: resolved voice environment`, {
    python: resolvePythonExecutable(),
    venvPython: venvPython(),
    venvExists: existsSync(venvPython()),
    sidecarPackageDir: SIDE_CAR_PACKAGE_DIR,
    sidecarExists: existsSync(SIDE_CAR_PACKAGE_DIR),
    manifestPath: resolveVoiceManifestPath(),
    bundleDir: resolveVoiceBundleDir(),
    voiceDataDir: voiceDataDir(),
  });
}

async function execVoiceCommand(
  executable: string,
  args: string[],
  options: {
    label: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    onOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
  },
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeout ?? 20 * 60_000;
  voiceInfo(`exec start: ${options.label}`, { executable, args, timeoutMs });

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const err = new Error(`${options.label} timed out after ${timeoutMs}ms`);
      voiceError(`exec timeout: ${options.label}`, err, { executable, args, stderr: tail(stderr) });
      reject(err);
    }, timeoutMs);

    const consume = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
        voiceDebug(`exec ${stream}: ${options.label}`, { line });
        options.onOutput?.(stream, line);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => consume('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => consume('stderr', chunk));

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      voiceError(`exec spawn failed: ${options.label}`, error, { executable, args });
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        voiceInfo(`exec complete: ${options.label}`, { exitCode: code });
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(`${options.label} failed with exit code ${code}`);
      voiceError(`exec failed: ${options.label}`, err, {
        executable,
        args,
        exitCode: code,
        stderr: tail(stderr),
        stdout: tail(stdout),
      });
      reject(err);
    });
  });
}

function tail(text: string, max = 4000): string {
  return text.length <= max ? text : text.slice(-max);
}

function formatExecError(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof (error as { stderr?: string }).stderr === 'string') {
    const stderr = (error as { stderr: string }).stderr.trim();
    if (stderr) return `${error.message}\n${stderr}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the bundled voice-sidecar Python package directory.
 * In the packaged desktop app the runtime exports AGENTX_VOICE_SIDECAR_DIR
 * (Contents/Resources/voice-sidecar). Fall back to the monorepo path in dev.
 */
function resolveSidecarPackageDir(): string {
  const fromEnv = process.env['AGENTX_VOICE_SIDECAR_DIR'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    resolve(__dirname, '..', '..', 'voice-sidecar'),
    resolve(__dirname, '..', '..', '..', 'voice-sidecar'),
    resolve(__dirname, '..', '..', '..', 'packages', 'voice-sidecar'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

const SIDE_CAR_PACKAGE_DIR = resolveSidecarPackageDir();

/** Bundled Python from the runtime, or system python3 in dev. */
function resolvePythonExecutable(): string {
  return process.env['AGENTX_PYTHON_PATH'] || 'python3';
}

/** Bundled ffmpeg from the runtime pack, or system ffmpeg on PATH. */
function resolveFfmpegExecutable(): string {
  return process.env['AGENTX_FFMPEG_PATH'] || 'ffmpeg';
}

/** Writable virtualenv for voice dependencies (kept out of the read-only app bundle). */
function voiceVenvDir(): string {
  return resolve(voiceDataDir(), 'venv');
}

function venvPython(): string {
  const venv = voiceVenvDir();
  return process.platform === 'win32'
    ? resolve(venv, 'Scripts', 'python.exe')
    : resolve(venv, 'bin', 'python3');
}

/** Prefer the voice venv's Python if it exists, else the bundled/system Python. */
function activePython(): string {
  const venvPy = venvPython();
  return existsSync(venvPy) ? venvPy : resolvePythonExecutable();
}

async function ensureVoiceVenv(): Promise<string> {
  const venvPy = venvPython();
  if (existsSync(venvPy)) {
    voiceInfo('Reusing existing voice virtualenv', { venvPy });
    return venvPy;
  }
  mkdirSync(voiceDataDir(), { recursive: true });
  voiceInfo('Creating voice virtualenv', { venvDir: voiceVenvDir(), python: resolvePythonExecutable() });
  await execVoiceCommand(resolvePythonExecutable(), ['-m', 'venv', voiceVenvDir()], {
    label: 'create-venv',
    timeout: 5 * 60_000,
  });
  voiceInfo('Voice virtualenv created', { venvPy });
  return venvPy;
}

/** Install the sidecar's runtime dependencies into the writable venv. */
async function installVoiceDependencies(onProgress?: (detail: string, progress: number) => void): Promise<void> {
  onProgress?.('Checking voice virtualenv…', 2);
  const venvPy = await ensureVoiceVenv();

  onProgress?.('Upgrading pip in voice environment…', 6);
  await execVoiceCommand(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    label: 'pip-upgrade',
    timeout: 5 * 60_000,
    env: pythonEnv(),
    onOutput: (_stream, line) => {
      if (line.includes('Successfully installed') || line.includes('Requirement already satisfied')) {
        onProgress?.(line, 8);
      }
    },
  });

  const installSpec = `${SIDE_CAR_PACKAGE_DIR}[voice]`;
  onProgress?.(`Installing voice engine packages from ${installSpec}…`, 10);
  voiceInfo('Installing voice sidecar package', { installSpec, venvPy });

  let lastPipLine = 'Installing voice engine packages…';
  await execVoiceCommand(venvPy, ['-m', 'pip', 'install', installSpec], {
    label: 'pip-install-voice-sidecar',
    timeout: 30 * 60_000,
    env: pythonEnv(),
    onOutput: (_stream, line) => {
      lastPipLine = line;
      onProgress?.(line, 12);
      if (line.includes('Collecting') || line.includes('Downloading') || line.includes('Installing')) {
        voiceInfo('pip progress', { line });
      }
    },
  });

  onProgress?.(lastPipLine || 'Voice engine packages installed', 14);
  voiceInfo('Voice engine packages installed', { venvPy, sidecarPackageDir: SIDE_CAR_PACKAGE_DIR });
  assetManager = null;
  sidecarManager = null;
  const { resetVoiceService } = await import('./voice-runtime.js');
  resetVoiceService();
}

/** StyleTTS 2 Python runtime — separate from model weights; installed on demand. */
async function isStyleTtsPythonInstalled(): Promise<boolean> {
  const venvPy = existsSync(venvPython()) ? venvPython() : null;
  if (!venvPy) return false;
  try {
    await execVoiceCommand(venvPy, ['-c', 'import styletts2'], {
      label: 'check-styletts2-import',
      timeout: 15_000,
      env: pythonEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureStyleTtsPythonInstalled(onProgress?: (detail: string) => void): Promise<void> {
  if (await isStyleTtsPythonInstalled()) {
    voiceInfo('StyleTTS 2 Python package already installed');
    return;
  }

  const venvPy = await ensureVoiceVenv();
  onProgress?.('Installing StyleTTS 2 Python runtime…');
  voiceInfo('Installing StyleTTS 2 Python package');

  await execVoiceCommand(venvPy, ['-m', 'pip', 'install', 'styletts2'], {
    label: 'pip-install-styletts2',
    timeout: 30 * 60_000,
    env: pythonEnv(),
    onOutput: (_stream, line) => {
      if (line.includes('Collecting') || line.includes('Downloading') || line.includes('Installing')) {
        onProgress?.(line);
        voiceInfo('StyleTTS pip progress', { line });
      }
    },
  });

  assetManager = null;
  sidecarManager = null;
  voiceInfo('StyleTTS 2 Python package installed');
}
const voiceJobStatuses = new Map<string, { status: 'pending' | 'running' | 'verifying' | 'complete' | 'error' | 'cancelled'; progress?: number; error?: string }>();

function resolveSetupAssetIds(): string[] {
  try {
    const manifest = loadVoiceModelsManifest();
    return [...getBundledAssetIds(manifest), ...getDefaultDownloadAssetIds(manifest)];
  } catch {
    return ['silero-vad', 'faster-whisper-base.en', 'kokoro-82m', 'kokoro-af'];
  }
}

function resolveSetupCatalogEntries() {
  const ids = resolveSetupAssetIds();
  return ids
    .map((id) => VOICE_ASSET_CATALOG.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function formatSourceLabel(assetId: string, fallback?: string): string {
  try {
    const entry = getManifestEntry(loadVoiceModelsManifest(), assetId);
    const source = entry?.sources[0];
    if (!source) return fallback ?? assetId;
    if (source.type === 'github' && source.repo) return `GitHub · ${source.repo}`;
    if (source.type === 'hf' && source.repo) return `HuggingFace · ${source.repo}`;
    if (source.type === 'mirror' && source.url) return `Mirror · ${source.url}`;
  } catch {
    // fall through
  }
  return fallback ?? assetId;
}

interface VoiceSetupStatus {
  phase: 'idle' | 'runtime' | 'download' | 'complete' | 'error';
  message: string;
  progress: number;
  /** High-level step label, e.g. "Runtime check" */
  step?: string;
  stepIndex?: number;
  totalSteps?: number;
  /** Finer detail line shown under the step */
  detail?: string;
  currentAsset?: string;
  currentAssetName?: string;
  assetIndex?: number;
  totalAssets?: number;
  assetProgress?: number;
  error?: string;
}

let voiceSetupStatus: VoiceSetupStatus = {
  phase: 'idle',
  message: 'Standby',
  progress: 0,
};

let voiceSetupRunning = false;
let sidecarManager: VoiceSidecarManager | null = null;
let assetManager: VoiceAssetManager | null = null;

router.get('/voice/capabilities', async (_req, res) => {
  try {
    const cfg = getVoiceConfig();
    res.json({ capabilities: await buildVoiceCapabilities(cfg) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read voice capabilities' });
  }
});

router.get('/voice/assets', (_req, res) => {
  const cfg = getVoiceConfig();
  res.json({
    catalog: VOICE_ASSET_CATALOG,
    installed: cfg.downloadedAssets ?? [],
    recommended: {
      stt: 'faster-whisper-base.en',
      tts: 'kokoro-82m',
      vad: 'silero-vad',
    },
  });
});

router.get('/voice/assets/installed', (_req, res) => {
  const cfg = getVoiceConfig();
  res.json({ assets: cfg.downloadedAssets ?? [] });
});

router.post('/voice/assets/download', (req, res) => {
  const assetId = String(req.body?.assetId ?? '');
  const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
  if (!asset) {
    return res.status(404).json({ error: 'Voice asset not found' });
  }
  if ((assetId === 'styletts2' || assetId === 'styletts2-default') &&
    !buildPublicSystemCapabilities(os.totalmem()).styleTtsSupported) {
    return res.status(400).json({ error: 'StyleTTS 2 requires at least 16 GB system RAM' });
  }

  const existing = voiceJobStatuses.get(assetId);
  if (existing?.status === 'running') {
    return res.json({ ok: true, assetId, status: 'running' });
  }

  voiceJobStatuses.set(assetId, { status: 'running', progress: 0 });
  getAssetManager().downloadAsset(asset, (progress) => {
    voiceJobStatuses.set(assetId, {
      status: progress.status,
      progress: progress.progress,
      error: progress.error,
    });
  })
    .then(async (installed) => {
      if (assetId === 'styletts2') {
        try {
          await ensureStyleTtsPythonInstalled();
        } catch (error) {
          voiceError('StyleTTS 2 Python install failed after model download', error, { assetId });
          voiceJobStatuses.set(assetId, {
            status: 'error',
            error: formatExecError(error),
          });
          return;
        }
      }
      addDownloadedAsset(installed);
      voiceJobStatuses.set(assetId, { status: 'complete', progress: 100 });
    })
    .catch((error) => {
      voiceJobStatuses.set(assetId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });

  res.json({ ok: true, assetId, status: 'running' });
});

router.post('/voice/assets/download/:assetId/cancel', (req, res) => {
  const assetId = String(req.params.assetId ?? '');
  getAssetManager().cancelDownload(assetId);
  voiceJobStatuses.set(assetId, { status: 'cancelled', error: 'Download cancelled' });
  res.json({ ok: true, assetId, status: 'cancelled' });
});

router.get('/voice/assets/download-status/:assetId', (req, res) => {
  const assetId = String(req.params.assetId ?? '');
  const job = getAssetManager().getJob(assetId) ?? voiceJobStatuses.get(assetId);
  res.json(job ?? { status: 'not_started' });
});

router.delete('/voice/assets/:assetId', async (req, res) => {
  const assetId = String(req.params.assetId ?? '');
  const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
  if (!asset) {
    return res.status(404).json({ error: 'Voice asset not found' });
  }

  try {
    await getAssetManager().deleteAsset(assetId);
    removeDownloadedAsset(assetId);
    voiceJobStatuses.delete(assetId);
    res.json({ ok: true, assetId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete voice asset' });
  }
});

router.post('/voice/install-sidecar', (_req, res) => {
  const jobId = 'sidecar-dependencies';
  if (voiceJobStatuses.get(jobId)?.status === 'running') {
    return res.json({ ok: true, jobId, status: 'running' });
  }

  voiceJobStatuses.set(jobId, { status: 'running', progress: 0 });
  installVoiceDependencies()
    .then(() => {
      voiceJobStatuses.set(jobId, { status: 'complete', progress: 100 });
      voiceInfo('Sidecar dependency install completed');
    })
    .catch((error) => {
      const message = formatExecError(error);
      voiceError('Sidecar dependency install failed', error);
      voiceJobStatuses.set(jobId, { status: 'error', error: message });
    });

  res.json({ ok: true, jobId, status: 'running' });
});

router.post('/voice/install-styletts', async (_req, res) => {
  try {
    await ensureStyleTtsPythonInstalled();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: formatExecError(error) });
  }
});

router.post('/voice/setup', (_req, res) => {
  if (voiceSetupRunning) {
    return res.json({ ok: true, status: voiceSetupStatus });
  }
  void runVoiceSetup();
  res.json({ ok: true, status: voiceSetupStatus });
});

router.get('/voice/setup/status', (_req, res) => {
  res.json({ status: voiceSetupStatus });
});

router.get('/voice/sidecar/status', async (_req, res) => {
  try {
    const manager = getVoiceSidecarManager();
    const status = manager.getStatus();
    const client = manager.getClient();
    if (client && (status.state === 'ready' || status.state === 'starting')) {
      const health = await client.health(3_000).catch(() => undefined);
      return res.json({ sidecar: { ...status, health } });
    }
    res.json({ sidecar: status });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read sidecar status' });
  }
});

async function ensureVoiceRuntimeReady(): Promise<void> {
  logVoiceEnvironment('ensure-prepare');
  if (!existsSync(SIDE_CAR_PACKAGE_DIR)) {
    throw new Error(`Voice sidecar package missing — reinstall Agent-X or run Settings → Voice → Deploy voice kit`);
  }

  const venvPy = venvPython();
  const checkImport = async (): Promise<boolean> => {
    if (!existsSync(venvPy)) return false;
    try {
      await execVoiceCommand(venvPy, ['-c', 'import agentx_voice'], {
        label: 'check-agentx-voice-import',
        timeout: 15_000,
        env: pythonEnv(),
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!(await checkImport())) {
    voiceInfo('Voice runtime not ready — installing Python dependencies');
    sidecarManager = null;
    const { resetVoiceService } = await import('./voice-runtime.js');
    resetVoiceService();
    await installVoiceDependencies();
    if (!(await checkImport())) {
      throw new Error('Voice Python environment failed to install — open Settings → Voice and run Deploy voice kit');
    }
  }
}

function formatEnsureError(raw: string): string {
  if (raw.includes('fetch failed') || raw.includes('ECONNREFUSED')) {
    return 'Voice engine offline — complete setup in Settings → Voice';
  }
  if (raw.includes('No module named')) {
    return 'Voice Python environment incomplete — open Settings → Voice and run Deploy voice kit';
  }
  if (raw.includes('Timed out waiting for voice sidecar')) {
    return 'Voice engine timed out starting — retry or check Settings → Voice';
  }
  return raw;
}

router.post('/voice/sidecar/ensure', async (_req, res) => {
  try {
    const config = mergeVoiceConfig(getEngine().configManager.load().voice);
    if (!config.enabled) {
      return res.status(400).json({ error: 'Voice is disabled — enable in Settings → Voice' });
    }
    const capabilities = await buildVoiceCapabilities(config);
    if (!capabilities.canRunWeb) {
      return res.status(503).json({
        ok: false,
        error: 'Voice kit incomplete — open Settings → Voice and run Deploy voice kit',
      });
    }
    await ensureVoiceRuntimeReady();
    const { getVoiceService } = await import('./voice-runtime.js');
    await getVoiceService().start();
    const manager = getVoiceSidecarManager();
    const status = manager.getStatus();
    const client = manager.getClient();
    const health = client ? await client.health(5_000) : undefined;
    res.json({
      ok: true,
      sidecar: { ...status, health },
    });
  } catch (error) {
    const raw = formatExecError(error);
    voiceError('sidecar/ensure failed', error);
    res.status(503).json({
      ok: false,
      error: formatEnsureError(raw),
      detail: raw,
    });
  }
});

router.post('/voice/sidecar/release', async (_req, res) => {
  try {
    const config = mergeVoiceConfig(getEngine().configManager.load().voice);
    const { countActiveVoiceWebSocketSessions } = await import('./voice-ws.js');
    if (countActiveVoiceWebSocketSessions() > 0) {
      return res.json({ ok: true, skipped: 'sessions_active' });
    }
    const { getVoiceService } = await import('./voice-runtime.js');
    const service = getVoiceService();
    if (!config.enabled) {
      await service.stop();
      return res.json({ ok: true, stopped: true });
    }
    if (config.sidecar?.autoStart === true) {
      return res.json({ ok: true, skipped: 'always_on' });
    }
    service.requestIdleUnload();
    res.json({ ok: true, scheduled: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to release voice sidecar',
    });
  }
});

router.post('/voice/preview', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  const engine = req.body?.engine === 'styletts2' ? 'styletts2' : 'kokoro';
  const voiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId : undefined;
  if (!text) {
    return res.status(400).json({ error: 'Preview text is required' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Preview text must be 500 characters or less' });
  }

  try {
    if (engine === 'styletts2') {
      if (!buildPublicSystemCapabilities(os.totalmem()).styleTtsSupported) {
        return res.status(400).json({ error: 'StyleTTS 2 requires at least 16 GB system RAM' });
      }
      await ensureStyleTtsPythonInstalled();
    }
    const tmpDir = resolve(voiceDataDir(), 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const outputPath = resolve(tmpDir, `preview-${Date.now()}.wav`);
    const client = await getVoiceSidecarManager().start();
    const result = await client.synthesize({
      text,
      engine,
      voiceId,
      outputPath,
      style: req.body?.style,
    });
    const audioPath = result.audioPath ?? outputPath;
    const audio = readFileSync(audioPath);
    res.json({
      ...result,
      audioBase64: audio.toString('base64'),
      mimeType: 'audio/wav',
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Voice preview failed' });
  }
});

async function buildVoiceCapabilities(config: VoiceConfig): Promise<VoiceCapabilityStatus> {
  const [pythonAvailable, ffmpegAvailable] = await Promise.all([
    commandAvailable(resolvePythonExecutable(), ['--version']),
    commandAvailable(resolveFfmpegExecutable(), ['-version']),
  ]);

  const selectedSttModelId = config.stt?.modelId;
  const selectedTtsEngine = config.tts?.engine ?? 'kokoro';
  const selectedVoiceId = config.tts?.voiceId;

  const sttInstalled = selectedSttModelId ? isVoiceAssetInstalled(config, selectedSttModelId) : false;
  const kokoroInstalled = isVoiceAssetInstalled(config, 'kokoro-82m');
  const styleTts2Installed = isVoiceAssetInstalled(config, 'styletts2');
  const selectedVoiceInstalled = selectedVoiceId ? isVoiceAssetInstalled(config, selectedVoiceId) : false;
  const selectedTtsInstalled = selectedTtsEngine === 'styletts2'
    ? styleTts2Installed && selectedVoiceInstalled
    : kokoroInstalled && selectedVoiceInstalled;
  const vadInstalled = isVoiceAssetInstalled(config, 'silero-vad');
  const sidecarDepsInstalled = kokoroInstalled || styleTts2Installed || sttInstalled || vadInstalled;
  const canRunBase = pythonAvailable && ffmpegAvailable && sidecarDepsInstalled && sttInstalled && selectedTtsInstalled && vadInstalled;

  let sidecarState: VoiceCapabilityStatus['sidecar'] = {
    state: config.enabled && pythonAvailable ? 'stopped' : 'not-installed',
    error: pythonAvailable ? undefined : 'python3 is required for the local voice sidecar',
  };
  if (config.enabled && sidecarManager) {
    const status = sidecarManager.getStatus();
    sidecarState = {
      state: status.state,
      error: status.error,
    };
  }

  return {
    os: process.platform,
    arch: process.arch,
    pythonAvailable,
    ffmpegAvailable,
    sidecar: sidecarState,
    stt: {
      engine: 'faster-whisper',
      selectedModelId: selectedSttModelId,
      selectedModelInstalled: sttInstalled,
    },
    tts: {
      selectedEngine: selectedTtsEngine,
      selectedVoiceId,
      selectedVoiceInstalled,
      kokoroInstalled,
      styleTts2Installed,
    },
    vadInstalled,
    gpuAvailable: detectCudaEnv(),
    canRunWeb: canRunBase && config.enabled !== false,
    canRunChannels: canRunBase && config.mode?.channels !== 'off',
  };
}

function getVoiceConfig(): VoiceConfig {
  const cfg = getEngine().configManager.load();
  return mergeVoiceConfig(cfg.voice);
}

function addDownloadedAsset(asset: VoiceDownloadedAsset): void {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const voice = mergeVoiceConfig(cfg.voice);
  eng.configManager.save({
    ...cfg,
    voice: {
      ...voice,
      downloadedAssets: [
        ...(voice.downloadedAssets ?? []).filter((entry) => entry.assetId !== asset.assetId),
        asset,
      ],
    },
  });
}

function removeDownloadedAsset(assetId: string): void {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const voice = mergeVoiceConfig(cfg.voice);
  eng.configManager.save({
    ...cfg,
    voice: {
      ...voice,
      downloadedAssets: (voice.downloadedAssets ?? []).filter((entry) => entry.assetId !== assetId),
    },
  });
}

function voiceDataDir(): string {
  return resolve(process.env['AGENTX_VOICE_DATA_DIR'] ?? resolve(getDataDir(), 'voice'));
}

function pythonEnv(): NodeJS.ProcessEnv {
  const manifestPath = resolveVoiceManifestPath();
  const bundleDir = resolveVoiceBundleDir();
  return {
    ...process.env,
    PYTHONPATH: [SIDE_CAR_PACKAGE_DIR, process.env['PYTHONPATH']].filter(Boolean).join(':'),
    ...(manifestPath ? { AGENTX_VOICE_MANIFEST_PATH: manifestPath } : {}),
    ...(bundleDir ? { AGENTX_VOICE_BUNDLE_DIR: bundleDir } : {}),
  };
}

function getAssetManager(): VoiceAssetManager {
  if (!assetManager) {
    assetManager = new VoiceAssetManager({
      dataDir: voiceDataDir(),
      sidecarPackageDir: SIDE_CAR_PACKAGE_DIR,
      pythonExecutable: activePython(),
      env: pythonEnv(),
    });
  }
  return assetManager;
}

function getVoiceSidecarManager(): VoiceSidecarManager {
  if (!sidecarManager) {
    sidecarManager = new VoiceSidecarManager({
      dataDir: voiceDataDir(),
      pythonExecutable: activePython(),
      env: pythonEnv(),
      startupTimeoutMs: 60_000,
      onLog: (level, message) => {
        if (level === 'error') voiceError('sidecar process', new Error(message));
        else if (level === 'warn') voiceWarn('sidecar process', { message });
        else voiceInfo('sidecar process', { message });
      },
    });
  }
  return sidecarManager;
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 1024 * 1024 });
    voiceDebug('Command available', { command, args });
    return true;
  } catch (error) {
    voiceWarn('Command unavailable', { command, args, error: formatExecError(error) });
    return false;
  }
}

function detectCudaEnv(): boolean {
  return Boolean(process.env['CUDA_VISIBLE_DEVICES'] && process.env['CUDA_VISIBLE_DEVICES'] !== '-1') ||
    os.platform() === 'linux' && Boolean(process.env['NVIDIA_VISIBLE_DEVICES']);
}

const RUNTIME_SETUP_STEPS = 3;

let lastLoggedSetupKey = '';
let lastLoggedSetupProgress = -1;

function patchVoiceSetupStatus(patch: Partial<VoiceSetupStatus>): void {
  voiceSetupStatus = { ...voiceSetupStatus, ...patch };

  // High-frequency callers (pip output lines, download progress ticks) hit
  // this on every update. Only log when the phase/step/message changes, an
  // error appears, or progress advances by >= 5% — otherwise the log floods
  // with near-identical entries.
  const key = `${voiceSetupStatus.phase}|${voiceSetupStatus.step ?? ''}|${voiceSetupStatus.message}|${voiceSetupStatus.error ?? ''}`;
  const progressJump = Math.abs(voiceSetupStatus.progress - lastLoggedSetupProgress) >= 5;
  if (key === lastLoggedSetupKey && !progressJump) {
    voiceDebug('Voice setup progress (tick)', {
      progress: voiceSetupStatus.progress,
      detail: voiceSetupStatus.detail,
      assetProgress: voiceSetupStatus.assetProgress,
    });
    return;
  }
  lastLoggedSetupKey = key;
  lastLoggedSetupProgress = voiceSetupStatus.progress;

  voiceInfo('Voice setup progress', {
    phase: voiceSetupStatus.phase,
    step: voiceSetupStatus.step,
    stepIndex: voiceSetupStatus.stepIndex,
    totalSteps: voiceSetupStatus.totalSteps,
    progress: voiceSetupStatus.progress,
    message: voiceSetupStatus.message,
    detail: voiceSetupStatus.detail,
    currentAsset: voiceSetupStatus.currentAsset,
    assetProgress: voiceSetupStatus.assetProgress,
    error: voiceSetupStatus.error,
  });
}

async function runVoiceSetup(): Promise<void> {
  voiceSetupRunning = true;
  voiceInfo('Voice deployment started');
  logVoiceEnvironment('deployment-start');

  let cfg = getVoiceConfig();
  let manifest;
  try {
    manifest = loadVoiceModelsManifest();
    voiceInfo('Loaded voice models manifest', { version: manifest.version, assets: manifest.assets.length });
  } catch (error) {
    voiceError('Failed to load voice models manifest', error);
    throw error;
  }

  const assets = resolveSetupCatalogEntries();
  const totalSteps = RUNTIME_SETUP_STEPS + assets.length;
  voiceInfo('Voice deployment plan', {
    assets: assets.map((asset) => asset.id),
    totalSteps,
    installed: cfg.downloadedAssets?.map((entry) => entry.assetId) ?? [],
  });

  patchVoiceSetupStatus({
    phase: 'runtime',
    step: 'Runtime check',
    stepIndex: 1,
    totalSteps,
    message: 'Checking Python and ffmpeg…',
    detail: `Python: ${resolvePythonExecutable()}`,
    progress: 1,
    currentAsset: undefined,
    currentAssetName: undefined,
    assetIndex: undefined,
    totalAssets: assets.length,
    assetProgress: undefined,
  });

  try {
    const [pythonAvailable, ffmpegAvailable] = await Promise.all([
      commandAvailable(resolvePythonExecutable(), ['--version']),
      commandAvailable(resolveFfmpegExecutable(), ['-version']),
    ]);
    if (!pythonAvailable) {
      throw new Error('Python 3 is required. Install Python 3.10+ and retry.');
    }
    if (!ffmpegAvailable) {
      throw new Error(
        'ffmpeg is required but was not found. Reinstall Agent-X (bundled ffmpeg missing), '
        + 'or install a system ffmpeg and ensure it is on PATH, then retry.',
      );
    }

    const bundleDir = resolveVoiceBundleDir();
    if (bundleDir) {
      patchVoiceSetupStatus({
        phase: 'runtime',
        step: 'Bundled assets',
        stepIndex: 2,
        message: 'Installing bundled voice models…',
        detail: `Copying from ${bundleDir}`,
        progress: 3,
      });
      voiceInfo('Bootstrapping bundled voice assets', { bundleDir, voiceDataDir: voiceDataDir() });
      const bootstrapped = await bootstrapBundledVoiceAssets({
        manifest,
        bundleDir,
        dataDir: voiceDataDir(),
        getConfig: getVoiceConfig,
        addAsset: addDownloadedAsset,
      });
      voiceInfo('Bundled voice assets bootstrapped', { bootstrapped });
      if (bootstrapped.length > 0) {
        patchVoiceSetupStatus({
          phase: 'runtime',
          step: 'Bundled assets',
          stepIndex: 2,
          message: 'Bundled models ready',
          detail: bootstrapped.join(', '),
          progress: 6,
        });
        cfg = getVoiceConfig();
      }
    } else {
      voiceWarn('No bundled voice assets directory found; downloads will be used instead');
    }

    patchVoiceSetupStatus({
      phase: 'runtime',
      step: 'Python environment',
      stepIndex: 2,
      message: 'Preparing voice Python environment…',
      detail: existsSync(venvPython()) ? 'Reusing existing virtualenv' : 'Creating new virtualenv',
      progress: 8,
    });

    await installVoiceDependencies((detail, subProgress) => {
      patchVoiceSetupStatus({
        phase: 'runtime',
        step: 'Engine install',
        stepIndex: 3,
        message: 'Installing voice engine packages…',
        detail,
        progress: 4 + subProgress,
      });
    });

    patchVoiceSetupStatus({
      phase: 'runtime',
      step: 'Engine install',
      stepIndex: 3,
      message: 'Voice engine ready',
      detail: 'Sidecar dependencies installed',
      progress: 15,
    });

    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      const assetStepIndex = RUNTIME_SETUP_STEPS + index + 1;
      const baseProgress = 15 + Math.round((index / assets.length) * 80);

      if (isVoiceAssetInstalled(cfg, asset.id)) {
        patchVoiceSetupStatus({
          phase: 'download',
          step: asset.deliveryTier === 'bundled' ? 'Bundled assets' : 'Model download',
          stepIndex: assetStepIndex,
          message: `${asset.displayName} already installed`,
          detail: asset.deliveryTier === 'bundled'
            ? `Bundled copy ready at ${getAssetManager().assetPath(asset)}`
            : `Skipped — cached at ${getAssetManager().assetPath(asset)}`,
          progress: baseProgress + Math.round(80 / assets.length),
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: 100,
        });
        continue;
      }

      // Model files may already exist on disk without a config entry (e.g. the
      // config was reset). Re-register instead of re-downloading.
      if (await getAssetManager().isInstalled(asset.id)) {
        voiceInfo('Asset found on disk; re-registering without download', { assetId: asset.id });
        addDownloadedAsset({
          assetId: asset.id,
          kind: asset.kind,
          engine: asset.engine,
          version: asset.downloadUrl,
          installedAt: new Date().toISOString(),
        });
        await registerAliasAssets(manifest, asset.id, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        cfg = getVoiceConfig();
        patchVoiceSetupStatus({
          phase: 'download',
          step: 'Model download',
          stepIndex: assetStepIndex,
          message: `${asset.displayName} restored from disk`,
          detail: `Found at ${getAssetManager().assetPath(asset)}`,
          progress: baseProgress + Math.round(80 / assets.length),
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: 100,
        });
        continue;
      }

      if (asset.deliveryTier === 'bundled') {
        continue;
      }

      const manifestEntry = getManifestEntry(manifest, asset.id);
      if (manifestEntry?.aliasOf && isVoiceAssetInstalled(getVoiceConfig(), manifestEntry.aliasOf)) {
        await registerAliasAssets(manifest, manifestEntry.aliasOf, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        continue;
      }

      const sourceLabel = formatSourceLabel(asset.id, asset.downloadUrl);

      patchVoiceSetupStatus({
        phase: 'download',
        step: 'Model download',
        stepIndex: assetStepIndex,
        message: `Downloading ${asset.displayName}…`,
        detail: `${sourceLabel} · ~${asset.sizeMB ?? '?'} MB`,
        progress: baseProgress,
        currentAsset: asset.id,
        currentAssetName: asset.displayName,
        assetIndex: index + 1,
        totalAssets: assets.length,
        assetProgress: 0,
      });

      voiceInfo('Starting asset download', { assetId: asset.id, source: sourceLabel, sizeMB: asset.sizeMB });

      try {
        const installed = await getAssetManager().downloadAsset(asset, (progress) => {
        const assetSlice = 80 / assets.length;
        const mapped = baseProgress + Math.round(((progress.progress ?? 0) / 100) * assetSlice);
        const detail = progress.status === 'verifying'
          ? `Verifying checksum for ${asset.displayName}…`
          : progress.status === 'running'
            ? `Fetching ${asset.displayName} from ${sourceLabel}`
            : progress.error ?? `Downloading ${asset.displayName}…`;

        if (progress.error) {
          voiceWarn('Asset download progress reported error', { assetId: asset.id, error: progress.error });
        }

        patchVoiceSetupStatus({
          phase: 'download',
          step: 'Model download',
          stepIndex: assetStepIndex,
          message: progress.status === 'verifying'
            ? `Verifying ${asset.displayName}…`
            : `Downloading ${asset.displayName}…`,
          detail,
          progress: mapped,
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: progress.progress,
        });
        });
        voiceInfo('Asset downloaded', { assetId: asset.id, sha256: installed.sha256, sizeBytes: installed.sizeBytes });
        addDownloadedAsset(installed);
      } catch (error) {
        voiceError(`Asset download failed: ${asset.id}`, error, {
          assetId: asset.id,
          source: sourceLabel,
          path: getAssetManager().assetPath(asset),
        });
        throw error;
      }
      await registerAliasAssets(manifest, asset.id, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
      cfg = getVoiceConfig();
    }

    patchVoiceSetupStatus({
      phase: 'complete',
      step: 'Complete',
      stepIndex: totalSteps,
      message: 'Voice kit ready.',
      detail: `${assets.length} models installed · sidecar ready`,
      progress: 100,
      assetProgress: 100,
    });
    voiceInfo('Voice deployment completed successfully');
  } catch (error) {
    const message = formatExecError(error);
    voiceError('Voice deployment failed', error, {
      progress: voiceSetupStatus.progress,
      step: voiceSetupStatus.step,
      detail: voiceSetupStatus.detail,
      currentAsset: voiceSetupStatus.currentAsset,
    });
    patchVoiceSetupStatus({
      phase: 'error',
      message: 'Voice setup failed',
      detail: message,
      progress: voiceSetupStatus.progress,
      error: message,
    });
  } finally {
    voiceSetupRunning = false;
    voiceInfo('Voice deployment finished', { running: false, phase: voiceSetupStatus.phase });
  }
}

export { getVoiceSidecarManager, voiceDataDir };
export default router;
