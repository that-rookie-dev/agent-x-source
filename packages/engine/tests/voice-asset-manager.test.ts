import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { VoiceAssetManager, computeDirectorySha256 } from '../src/voice/VoiceAssetManager.js';
import { VOICE_ASSET_CATALOG } from '../src/voice/VoiceAssetCatalog.js';

describe('VoiceAssetManager', () => {
  it('rejects unknown assets on delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-asset-'));
    const manager = new VoiceAssetManager({ dataDir: dir, sidecarPackageDir: dir });
    await expect(manager.deleteAsset('missing-id')).rejects.toThrow(/Unknown voice asset/);
  });

  it('computes stable directory sha256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-hash-'));
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'a.txt'), 'alpha');
    const first = await computeDirectorySha256(dir);
    writeFileSync(join(dir, 'nested', 'b.txt'), 'beta');
    const second = await computeDirectorySha256(dir);
    expect(first).not.toBe(second);
  });

  it('marks running downloads as cancelled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-cancel-'));
    const manager = new VoiceAssetManager({ dataDir: dir, sidecarPackageDir: dir });
    (manager as unknown as { jobs: Map<string, unknown> }).jobs.set('kokoro-onnx', { assetId: 'kokoro-onnx', status: 'running', progress: 10 });
    manager.cancelDownload('kokoro-onnx');
    expect(manager.getJob('kokoro-onnx')?.status).toBe('cancelled');
  });
});
