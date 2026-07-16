import { execFile, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getDataDir, getLogger, envWithoutEmbeddedPostgresLibs } from '@agentx/shared';
import {
  VoiceAssetManager,
  VoiceSidecarManager,
  resolveVoiceBundleDir,
  resolveVoiceManifestPath,
} from '@agentx/engine';

const execFileAsync = promisify(execFile);
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
      env: envWithoutEmbeddedPostgresLibs(options.env ?? process.env),
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
  voiceState.assetManager = null;
  voiceState.sidecarManager = null;
  const { resetVoiceService } = await import('../voice-runtime.js');
  resetVoiceService();
}

const voiceJobStatuses = new Map<string, { status: 'pending' | 'running' | 'verifying' | 'complete' | 'error' | 'cancelled'; progress?: number; error?: string; detail?: string; downloadedMB?: number; totalMB?: number }>();

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

const voiceState = {
  setupStatus: {
    phase: 'idle',
    message: 'Standby',
    progress: 0,
  } as VoiceSetupStatus,
  setupRunning: false,
  sidecarManager: null as VoiceSidecarManager | null,
  assetManager: null as VoiceAssetManager | null,
};

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
  if (!voiceState.assetManager) {
    voiceState.assetManager = new VoiceAssetManager({
      dataDir: voiceDataDir(),
      sidecarPackageDir: SIDE_CAR_PACKAGE_DIR,
      pythonExecutable: activePython(),
      env: pythonEnv(),
    });
  }
  return voiceState.assetManager;
}

function getVoiceSidecarManager(): VoiceSidecarManager {
  if (!voiceState.sidecarManager) {
    voiceState.sidecarManager = new VoiceSidecarManager({
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
  return voiceState.sidecarManager;
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      env: envWithoutEmbeddedPostgresLibs(),
    });
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

export {
  voiceInfo,
  voiceWarn,
  voiceDebug,
  voiceError,
  logVoiceEnvironment,
  execVoiceCommand,
  tail,
  formatExecError,
  SIDE_CAR_PACKAGE_DIR,
  resolvePythonExecutable,
  resolveFfmpegExecutable,
  voiceVenvDir,
  venvPython,
  activePython,
  ensureVoiceVenv,
  installVoiceDependencies,
  voiceJobStatuses,
  voiceState,
  type VoiceSetupStatus,
  voiceDataDir,
  pythonEnv,
  getAssetManager,
  getVoiceSidecarManager,
  commandAvailable,
  detectCudaEnv,
};
