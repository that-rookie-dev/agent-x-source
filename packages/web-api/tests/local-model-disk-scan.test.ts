import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDiskForCatalogModels, mergeDownloadedModels } from '../src/local-model-api.js';

describe('local-model disk scan', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-local-model-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds catalog models that exist on disk', () => {
    // The SmolLM 360M model is in the catalog with dtype 'q4'
    const modelId = 'HuggingFaceTB/SmolLM-360M-Instruct';
    const onnxDir = join(tempDir, modelId, 'onnx');
    mkdirSync(onnxDir, { recursive: true });
    writeFileSync(join(onnxDir, 'model_q4.onnx'), 'fake-onnx');

    const found = scanDiskForCatalogModels(tempDir);
    const match = found.find((m) => m.modelId === 'smollm-360m');

    expect(match).toBeDefined();
    expect(match?.modelName).toBe(modelId);
    expect(match?.dtype).toBe('q4');
  });

  it('ignores catalog models that are not on disk', () => {
    const found = scanDiskForCatalogModels(tempDir);
    expect(found).toEqual([]);
  });

  it('merges disk-only models with recorded models without duplicates', () => {
    const recorded = [
      {
        modelId: 'smollm-360m',
        modelName: 'HuggingFaceTB/SmolLM-360M-Instruct',
        displayName: 'SmolLM 2 (360M)',
        downloadedAt: '2024-01-01T00:00:00.000Z',
        dtype: 'q4' as const,
      },
    ];
    const disk = [
      {
        modelId: 'smollm-360m',
        modelName: 'HuggingFaceTB/SmolLM-360M-Instruct',
        displayName: 'SmolLM 2 (360M)',
        downloadedAt: '2024-06-01T00:00:00.000Z',
        dtype: 'q4' as const,
      },
      {
        modelId: 'qwen-0.5b',
        modelName: 'onnx-community/Qwen2.5-0.5B-Instruct',
        displayName: 'Qwen 2.5 (0.5B)',
        downloadedAt: '2024-06-01T00:00:00.000Z',
        dtype: 'q4' as const,
      },
    ];

    const merged = mergeDownloadedModels(recorded, disk);

    expect(merged).toHaveLength(2);
    // Recorded entry should win for existing modelId
    expect(merged.find((m) => m.modelId === 'smollm-360m')?.downloadedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(merged.find((m) => m.modelId === 'qwen-0.5b')).toBeDefined();
  });
});
