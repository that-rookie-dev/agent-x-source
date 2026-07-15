import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { VoiceAssetCatalogEntry, VoiceDownloadedAsset } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { VOICE_ASSET_CATALOG } from './VoiceAssetCatalog.js';

export interface VoiceAssetDownloadProgress {
  assetId: string;
  status: 'pending' | 'running' | 'verifying' | 'complete' | 'error' | 'cancelled';
  progress?: number;
  error?: string;
}

export interface VoiceAssetManagerOptions {
  dataDir: string;
  pythonExecutable?: string;
  sidecarPackageDir: string;
  env?: NodeJS.ProcessEnv;
}

interface PythonAssetResult {
  assetId: string;
  path?: string;
  kind?: string;
  sha256?: string;
}

export class VoiceAssetManager {
  private readonly dataDir: string;
  private readonly pythonExecutable: string;
  private readonly sidecarPackageDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly jobs = new Map<string, VoiceAssetDownloadProgress>();
  private readonly cancelFlags = new Set<string>();

  constructor(options: VoiceAssetManagerOptions) {
    this.dataDir = resolve(options.dataDir);
    this.pythonExecutable = options.pythonExecutable ?? 'python3';
    this.sidecarPackageDir = resolve(options.sidecarPackageDir);
    this.env = options.env ?? process.env;
  }

  getJob(assetId: string): VoiceAssetDownloadProgress | undefined {
    return this.jobs.get(assetId);
  }

  cancelDownload(assetId: string): void {
    this.cancelFlags.add(assetId);
    const job = this.jobs.get(assetId);
    if (job?.status === 'running') {
      this.jobs.set(assetId, { ...job, status: 'cancelled', error: 'Download cancelled' });
    }
  }

  async deleteAsset(assetId: string): Promise<void> {
    const asset = this.findAsset(assetId);
    await this.execPython(['-m', 'agentx_voice.assets', 'delete', '--asset-id', asset.id, '--data-dir', this.dataDir]);
    await rm(this.assetPath(asset), { recursive: true, force: true });
    this.jobs.delete(assetId);
  }

  async downloadAsset(
    asset: VoiceAssetCatalogEntry,
    onProgress?: (progress: VoiceAssetDownloadProgress) => void,
  ): Promise<VoiceDownloadedAsset> {
    if (this.jobs.get(asset.id)?.status === 'running') {
      throw new Error(`Download already running for ${asset.id}`);
    }
    if (!asset.downloadUrl?.match(/^(hf|github):\/\//)) {
      throw new Error(`Voice asset ${asset.id} does not have a downloadable source`);
    }

    this.cancelFlags.delete(asset.id);
    const job: VoiceAssetDownloadProgress = { assetId: asset.id, status: 'running', progress: 10 };
    this.jobs.set(asset.id, job);
    onProgress?.(job);

    try {
      if (this.cancelFlags.has(asset.id)) throw new Error('Download cancelled');

      this.jobs.set(asset.id, { ...job, progress: 15 });
      onProgress?.(this.jobs.get(asset.id)!);

      const { stdout } = await this.execPythonWithProgress(
        ['-m', 'agentx_voice.assets', 'download', '--asset-id', asset.id, '--data-dir', this.dataDir],
        60 * 60_000,
        (progress, detail) => {
          const mapped = Math.min(90, 15 + Math.round(progress * 0.75));
          this.jobs.set(asset.id, {
            assetId: asset.id,
            status: 'running',
            progress: mapped,
            error: detail,
          });
          onProgress?.(this.jobs.get(asset.id)!);
        },
      );
      if (this.cancelFlags.has(asset.id)) throw new Error('Download cancelled');

      this.jobs.set(asset.id, { assetId: asset.id, status: 'running', progress: 75 });
      onProgress?.(this.jobs.get(asset.id)!);

      let result: PythonAssetResult;
      try {
        result = JSON.parse(stdout.trim()) as PythonAssetResult;
      } catch (error) {
        getLogger().warn('VOICE', `Failed to parse python asset result: ${error instanceof Error ? error.message : String(error)}`);
        result = {} as PythonAssetResult;
      }
      this.jobs.set(asset.id, { assetId: asset.id, status: 'verifying', progress: 90 });
      onProgress?.(this.jobs.get(asset.id)!);

      const installedPath = this.assetPath(asset);
      const computedSha = result.sha256 ?? await computeDirectorySha256(installedPath);
      if (asset.sha256 && computedSha !== asset.sha256) {
        throw new Error(`Checksum mismatch for ${asset.id}`);
      }

      const installed: VoiceDownloadedAsset = {
        assetId: asset.id,
        kind: asset.kind,
        engine: asset.engine,
        version: asset.downloadUrl,
        installedAt: new Date().toISOString(),
        sizeBytes: await directorySizeBytes(installedPath),
        sha256: computedSha,
      };

      this.jobs.set(asset.id, { assetId: asset.id, status: 'complete', progress: 100 });
      onProgress?.(this.jobs.get(asset.id)!);
      return installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.jobs.set(asset.id, { assetId: asset.id, status: 'error', error: message });
      onProgress?.(this.jobs.get(asset.id)!);
      throw error;
    }
  }

  assetPath(asset: VoiceAssetCatalogEntry): string {
    switch (asset.kind) {
      case 'stt-model':
        return join(this.dataDir, 'models', 'stt', asset.id);
      case 'tts-model':
        return join(this.dataDir, 'models', 'tts', asset.engine ?? 'kokoro', asset.id);
      case 'tts-voice':
        return join(this.dataDir, 'models', 'tts', asset.engine ?? 'kokoro', asset.id === 'kokoro-af' ? 'kokoro-82m' : asset.id);
      case 'vad-model':
        return join(this.dataDir, 'models', 'vad', asset.id);
      default:
        return join(this.dataDir, 'assets', asset.id);
    }
  }

  async isInstalled(assetId: string): Promise<boolean> {
    const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
    if (!asset) return false;
    try {
      await stat(this.assetPath(asset));
      return true;
    } catch {
      return false;
    }
  }

  async cleanupOldTempFiles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const tmpRoot = join(this.dataDir, 'tmp');
    let removed = 0;
    try {
      const entries = await readdir(tmpRoot, { withFileTypes: true });
      const cutoff = Date.now() - maxAgeMs;
      for (const entry of entries) {
        const path = join(tmpRoot, entry.name);
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await rm(path, { recursive: true, force: true });
          removed += 1;
        }
      }
    } catch {
      // tmp may not exist
    }
    return removed;
  }

  private findAsset(assetId: string): VoiceAssetCatalogEntry {
    const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
    if (!asset) throw new Error(`Unknown voice asset: ${assetId}`);
    return asset;
  }

  private execPython(args: string[], timeout = 10 * 60_000): Promise<{ stdout: string; stderr: string }> {
    return this.execPythonWithProgress(args, timeout);
  }

  private execPythonWithProgress(
    args: string[],
    timeout = 10 * 60_000,
    onProgress?: (progress: number, detail?: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    getLogger().info('VOICE', 'Running python asset command', {
      python: this.pythonExecutable,
      args,
      sidecarPackageDir: this.sidecarPackageDir,
      timeout,
    });

    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.pythonExecutable, args, {
        env: {
          ...this.env,
          PYTHONPATH: [this.sidecarPackageDir, this.env.PYTHONPATH].filter(Boolean).join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Python asset command timed out after ${timeout}ms`));
      }, timeout);

      const handleStderr = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        for (const line of text.split('\n')) {
          const match = line.match(/^AGENTX_PROGRESS:(\d+):?(.*)$/);
          if (match) {
            onProgress?.(Number(match[1]), match[2] || undefined);
          }
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr?.on('data', handleStderr);

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          if (stderr.trim()) {
            getLogger().debug('VOICE', 'Python asset command stderr', { stderr: stderr.slice(-4000) });
          }
          resolvePromise({ stdout, stderr });
          return;
        }
        const err = new Error(`Python asset command failed with exit code ${code}`);
        getLogger().error('VOICE', err, {
          detail: 'Python asset command failed',
          python: this.pythonExecutable,
          args,
          stderr: stderr.slice(-4000),
        });
        reject(err);
      });
    });
  }
}

export async function computeDirectorySha256(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of (await walkFiles(root)).sort()) {
    hash.update(file.slice(root.length + 1));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

async function directorySizeBytes(root: string): Promise<number> {
  let total = 0;
  for (const file of await walkFiles(root)) {
    total += (await stat(file)).size;
  }
  return total;
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
