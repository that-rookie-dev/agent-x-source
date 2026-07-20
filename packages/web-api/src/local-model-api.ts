/**
 * API endpoints for local model management.
 *
 * Provides system capability detection, model catalog, and model download
 * functionality for the setup wizard and settings pages.
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';
import os from 'os';
import { rmSync, existsSync, statSync } from 'fs';
import { pipeline } from '@huggingface/transformers';
import { SystemCapabilityDetector } from '@agentx/engine';
import { MODEL_CATALOG, getModelById, getCompatibleModels, getRecommendedModel } from '@agentx/engine';
import { getEngine, syncLocalModelConfig } from './engine.js';
import type { AgentXConfig, DownloadedLocalModel, LocalModelConfig } from '@agentx/shared';

const router: import('express').Router = Router();

// Get system capabilities
router.get('/local-model/capabilities', async (_req: Request, res: Response) => {
  try {
    const capabilities = await SystemCapabilityDetector.detect();
    res.json({ capabilities, localModelSupported: SystemCapabilityDetector.isLocalModelSupported() });
  } catch (e) {
    console.error('Failed to detect system capabilities:', e);
    res.status(500).json({ error: 'Failed to detect system capabilities' });
  }
});

// Get model catalog
router.get('/local-model/catalog', async (_req: Request, res: Response) => {
  try {
    const capabilities = await SystemCapabilityDetector.detect();
    const compatibleModels = getCompatibleModels(capabilities);
    const recommendedModel = getRecommendedModel(capabilities);
    
    res.json({
      catalog: MODEL_CATALOG,
      compatible: compatibleModels.map(m => m.id),
      recommended: recommendedModel?.id || null,
    });
  } catch (e) {
    console.error('Failed to get model catalog:', e);
    res.status(500).json({ error: 'Failed to get model catalog' });
  }
});

// Download model
router.post('/local-model/download', async (req: Request, res: Response) => {
  const { modelId } = req.body;
  
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  
  const model = getModelById(modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }
  
  // Verify system compatibility
  const capabilities = await SystemCapabilityDetector.detect();
  const canRun = (
    (model.tier === 'basic' && capabilities.canRunBasic) ||
    (model.tier === 'standard' && capabilities.canRunStandard) ||
    (model.tier === 'advanced' && capabilities.canRunAdvanced)
  );
  
  if (!canRun) {
    return res.status(400).json({ 
      error: 'System does not meet requirements',
      requirements: {
        ram: model.ramRequirementGB,
        cpu: model.minCpuCores,
        available: {
          ram: capabilities.totalMemoryGB,
          cpu: capabilities.cpuCores,
        },
      },
    });
  }
  
  // Check disk space
  if (capabilities.availableDiskGB < model.sizeGB + 1) {
    return res.status(400).json({ 
      error: 'Insufficient disk space',
      required: model.sizeGB,
      available: capabilities.availableDiskGB,
    });
  }
  
  // Start download (background)
  downloadModel(model)
    .then(() => {
      // Send completion event via WebSocket
      broadcastModelEvent({
        type: 'model_download_complete',
        modelId,
        timestamp: new Date().toISOString(),
      });
    })
    .catch((e) => {
      console.error('Model download failed:', e);
      broadcastModelEvent({
        type: 'model_download_error',
        modelId,
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      });
    });
  
  res.json({ 
    ok: true, 
    modelId,
    sizeGB: model.sizeGB,
    message: 'Download started',
  });
});

// Get download status
router.get('/local-model/download-status/:modelId', async (req: Request, res: Response) => {
  const modelId = req.params.modelId;
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const status = downloadStatuses.get(modelId);

  if (!status) {
    res.json({ status: 'not_started' });
  } else {
    res.json(status);
  }
});

function getCacheDir(): string {
  return path.join(os.homedir(), '.agentx', 'models');
}

function deleteModelCache(model: { huggingFaceId: string }) {
  const cacheDir = getCacheDir();
  rmSync(path.join(cacheDir, model.huggingFaceId), { recursive: true, force: true });
  const sanitized = model.huggingFaceId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  rmSync(path.join(cacheDir, `models--${sanitized}`), { recursive: true, force: true });
}

function isModelCacheOnDisk(model: { huggingFaceId: string }, dtype: string, cacheDir?: string): boolean {
  const dir = cacheDir ?? getCacheDir();
  const onnxPath = getModelOnnxPath(dir, model.huggingFaceId, dtype);
  return existsSync(onnxPath);
}

export function scanDiskForCatalogModels(cacheDir?: string): DownloadedLocalModel[] {
  const found: DownloadedLocalModel[] = [];
  for (const model of MODEL_CATALOG) {
    const dtype = (model.dtype ?? 'q4') as NonNullable<LocalModelConfig['dtype']>;
    if (isModelCacheOnDisk(model, dtype, cacheDir)) {
      found.push({
        modelId: model.id,
        modelName: model.huggingFaceId,
        displayName: model.displayName,
        downloadedAt: new Date().toISOString(),
        dtype,
      });
    }
  }
  return found;
}

export function mergeDownloadedModels(
  recorded: DownloadedLocalModel[],
  disk: DownloadedLocalModel[],
): DownloadedLocalModel[] {
  const map = new Map<string, DownloadedLocalModel>();
  for (const entry of recorded) map.set(entry.modelId, entry);
  for (const entry of disk) {
    if (!map.has(entry.modelId)) map.set(entry.modelId, entry);
  }
  return Array.from(map.values());
}

function getActiveModelId(cfg: { localModel?: { modelId?: string } | null }): string | null {
  return cfg.localModel?.modelId ?? null;
}

function setActiveModel(
  cfg: AgentXConfig,
  model: { id: string; huggingFaceId: string; displayName: string },
  dtype: NonNullable<LocalModelConfig['dtype']>,
): AgentXConfig {
  const cacheDir = getCacheDir();
  return {
    ...cfg,
    localModel: {
      enabled: true,
      modelId: model.id,
      modelName: model.huggingFaceId,
      displayName: model.displayName,
      cacheDir,
      downloadedAt: new Date().toISOString(),
      dtype,
      downloadedModels: cfg.localModel?.downloadedModels,
    },
  };
}

function addToDownloadedModels(
  cfg: AgentXConfig,
  model: { id: string; huggingFaceId: string; displayName: string },
  dtype: NonNullable<LocalModelConfig['dtype']>,
): AgentXConfig {
  const existing: DownloadedLocalModel[] = cfg.localModel?.downloadedModels ?? [];
  const filtered = existing.filter((m) => m.modelId !== model.id);
  const entry: DownloadedLocalModel = {
    modelId: model.id,
    modelName: model.huggingFaceId,
    displayName: model.displayName,
    downloadedAt: new Date().toISOString(),
    dtype,
  };
  return {
    ...cfg,
    localModel: {
      ...(cfg.localModel || {}),
      downloadedModels: [...filtered, entry],
    },
  };
}

function removeFromDownloadedModels(cfg: AgentXConfig, modelId: string): AgentXConfig {
  const existing: DownloadedLocalModel[] = cfg.localModel?.downloadedModels ?? [];
  const remaining = existing.filter((m) => m.modelId !== modelId);
  if (remaining.length === existing.length) return cfg;
  return {
    ...cfg,
    localModel: {
      ...(cfg.localModel || {}),
      downloadedModels: remaining,
    },
  };
}

function pickNextActiveModel(cfg: AgentXConfig): AgentXConfig | null {
  const remaining: DownloadedLocalModel[] = cfg.localModel?.downloadedModels ?? [];
  const next = remaining[0];
  if (!next) return null;
  const model = getModelById(next.modelId);
  if (!model) return null;
  return setActiveModel(cfg, model, (next.dtype ?? 'q4') as NonNullable<LocalModelConfig['dtype']>);
}

function clearActiveModel(cfg: AgentXConfig): AgentXConfig {
  if (!cfg.localModel) return cfg;
  return {
    ...cfg,
    localModel: {
      ...cfg.localModel,
      enabled: false,
      modelId: undefined,
      modelName: undefined,
      displayName: undefined,
      cacheDir: undefined,
      downloadedAt: undefined,
      dtype: undefined,
    },
  };
}

// Get local model status (active model from config)
router.get('/local-model/status', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const activeModelId = getActiveModelId(cfg);
    const enabled = cfg.localModel?.enabled ?? false;
    const model = activeModelId ? getModelById(activeModelId) : null;
    res.json({
      installed: activeModelId,
      activeModelId,
      enabled,
      model: model
        ? {
            id: model.id,
            displayName: model.displayName,
            huggingFaceId: model.huggingFaceId,
            sizeGB: model.sizeGB,
            downloadedAt: cfg.localModel?.downloadedAt ?? null,
          }
        : null,
    });
  } catch (e) {
    console.error('Failed to get local model status:', e);
    res.status(500).json({ error: 'Failed to get local model status' });
  }
});

// Get all downloaded models available on disk
router.get('/local-model/installed', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const activeModelId = getActiveModelId(cfg);
    const recorded: DownloadedLocalModel[] = cfg.localModel?.downloadedModels ?? [];
    const diskModels = scanDiskForCatalogModels();
    const merged = mergeDownloadedModels(recorded, diskModels);
    const models: (DownloadedLocalModel & { isActive: boolean })[] = [];
    const stillValid: DownloadedLocalModel[] = [];

    for (const entry of merged) {
      const model = getModelById(entry.modelId);
      if (!model) continue;
      const dtype = (entry.dtype ?? 'q4') as NonNullable<LocalModelConfig['dtype']>;
      if (!isModelCacheOnDisk(model, dtype)) continue;
      stillValid.push(entry);
      models.push({ ...entry, isActive: entry.modelId === activeModelId });
    }

    // Persist merged/pruned list back to config
    if (stillValid.length !== recorded.length || diskModels.length > 0) {
      try {
        const updated = {
          ...cfg,
          localModel: {
            ...(cfg.localModel || {}),
            downloadedModels: stillValid,
          },
        };
        const activeStillValid = activeModelId && stillValid.some((m) => m.modelId === activeModelId);
        if (!activeStillValid && activeModelId) {
          const next = pickNextActiveModel(updated);
          eng.configManager.save(next ?? clearActiveModel(updated));
        } else {
          eng.configManager.save(updated);
        }
        syncLocalModelConfig(eng.configManager);
      } catch (e) {
        console.error('Failed to update downloaded models config:', e);
      }
    }

    res.json({ models });
  } catch (e) {
    console.error('Failed to get installed local models:', e);
    res.status(500).json({ error: 'Failed to get installed local models' });
  }
});

// Activate a downloaded model
router.post('/local-model/activate/:modelId', async (req: Request, res: Response) => {
  const modelId = req.params.modelId;
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const model = getModelById(modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const dtype = (model.dtype ?? 'q4') as NonNullable<LocalModelConfig['dtype']>;
    if (!isModelCacheOnDisk(model, dtype)) {
      return res.status(400).json({ error: 'Model files are missing. Download it again.' });
    }

    // Ensure the model is recorded as downloaded so it survives config reloads
    let updated = addToDownloadedModels(cfg, model, dtype);
    updated = setActiveModel(updated, model, dtype);
    eng.configManager.save(updated);
    syncLocalModelConfig(eng.configManager);
    res.json({ ok: true, modelId, message: 'Model activated' });
  } catch (e) {
    console.error('Failed to activate local model:', e);
    res.status(500).json({ error: 'Failed to activate local model' });
  }
});

// Delete downloaded model
router.delete('/local-model/:modelId', async (req: Request, res: Response) => {
  const modelId = req.params.modelId;
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const model = getModelById(modelId);

  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  try {
    deleteModelCache(model);

    const eng = getEngine();
    try {
      let cfg = eng.configManager.load();
      const wasActive = cfg.localModel?.modelId === modelId;
      cfg = removeFromDownloadedModels(cfg, modelId);
      if (wasActive) {
        const next = pickNextActiveModel(cfg);
        cfg = next ?? clearActiveModel(cfg);
      }
      eng.configManager.save(cfg);
      syncLocalModelConfig(eng.configManager);
    } catch (cfgErr) {
      console.error('Failed to update local model config after delete:', cfgErr);
    }

    res.json({ ok: true, message: 'Model deleted' });
  } catch (e) {
    console.error('Failed to delete model:', e);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Switch back to the primary cloud provider: disable the active local model without deleting files.
router.post('/local-model/switch-to-primary', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const updated = clearActiveModel(cfg);
    eng.configManager.save(updated);
    syncLocalModelConfig(eng.configManager);
    res.json({ ok: true, message: 'Switched to primary provider' });
  } catch (e) {
    console.error('Failed to switch to primary provider:', e);
    res.status(500).json({ error: 'Failed to switch to primary provider' });
  }
});

// Download status tracking
const downloadStatuses = new Map<string, {
  status: 'downloading' | 'complete' | 'error';
  progress: number;
  error?: string;
}>();

async function getExpectedOnnxSize(modelId: string, dtype: string): Promise<number | null> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main/onnx`, {
      headers: { 'User-Agent': 'agent-x' },
    });
    if (!res.ok) return null;
    const files = await res.json() as Array<{ path: string; size: number }>;
    const target = files.find((f) =>
      f.path === `onnx/model_${dtype}.onnx` ||
      (dtype === 'fp32' && f.path === 'onnx/model.onnx')
    );
    return target?.size ?? null;
  } catch {
    return null;
  }
}

function getModelOnnxPath(cacheDir: string, modelId: string, dtype: string): string {
  const fileName = dtype === 'fp32' ? 'model.onnx' : `model_${dtype}.onnx`;
  return path.join(cacheDir, modelId, 'onnx', fileName);
}

async function verifyModelCache(cacheDir: string, model: any, dtype: string): Promise<boolean> {
  const onnxPath = getModelOnnxPath(cacheDir, model.huggingFaceId, dtype);
  if (!existsSync(onnxPath)) return false;

  const expected = await getExpectedOnnxSize(model.huggingFaceId, dtype);
  if (!expected) return true; // can't verify, assume ok

  const actual = statSync(onnxPath).size;
  if (actual !== expected) {
    console.warn(`Model ${model.huggingFaceId} ONNX file size mismatch: ${actual} vs expected ${expected}. Clearing cache.`);
    rmSync(path.join(cacheDir, model.huggingFaceId), { recursive: true, force: true });
    return false;
  }
  return true;
}

async function downloadModel(model: any): Promise<void> {
  const cacheDir = path.join(os.homedir(), '.agentx', 'models');
  const dtype = (model.dtype ?? 'q4') as NonNullable<LocalModelConfig['dtype']>;

  // Remove any incomplete/corrupted cache for this model before downloading
  await verifyModelCache(cacheDir, model, dtype);

  downloadStatuses.set(model.id, {
    status: 'downloading',
    progress: 0,
  });

  // Simulate progress updates while the actual download runs synchronously
  const progressInterval = setInterval(() => {
    const current = downloadStatuses.get(model.id);
    if (!current || current.status !== 'downloading') {
      clearInterval(progressInterval);
      return;
    }
    const nextProgress = Math.min(current.progress + Math.random() * 5, 95);
    downloadStatuses.set(model.id, {
      status: 'downloading',
      progress: Math.round(nextProgress),
    });
  }, 1000);

  try {
    // Download for local text-generation tasks (extraction, consolidation, distillation).
    // Embeddings are handled by the bundled all-MiniLM-L6-v2 model, not the user-downloaded model.
    await pipeline('text-generation', model.huggingFaceId, {
      dtype,
      cache_dir: cacheDir,
      session_options: {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
    });

    // Verify the downloaded file is complete
    const valid = await verifyModelCache(cacheDir, model, dtype);
    if (!valid) {
      throw new Error('Downloaded model file appears incomplete. Please try downloading again.');
    }

    clearInterval(progressInterval);
    downloadStatuses.set(model.id, {
      status: 'complete',
      progress: 100,
    });

    // Save configuration so the local model is used for extraction and consolidation.
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      let updated = addToDownloadedModels(cfg, model, dtype);
      updated = setActiveModel(updated, model, dtype);
      updated = {
        ...updated,
        featureRouting: {
          memoryExtraction: 'local',
          memoryConsolidation: 'local',
          ...(updated.featureRouting || {}),
        },
      };
      eng.configManager.save(updated);
      syncLocalModelConfig(eng.configManager);
    } catch (e) {
      console.error('Failed to save local model config:', e);
    }
  } catch (e) {
    downloadStatuses.set(model.id, {
      status: 'error',
      progress: downloadStatuses.get(model.id)?.progress || 0,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// WebSocket event broadcasting
function broadcastModelEvent(event: any): void {
  // TODO: Integrate with existing WebSocket system
  // For now, this is a placeholder
  console.log('Model event:', event);
}

export default router;
