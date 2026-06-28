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

const router: import('express').Router = Router();

// Get system capabilities
router.get('/local-model/capabilities', async (_req: Request, res: Response) => {
  try {
    const capabilities = await SystemCapabilityDetector.detect();
    res.json({ capabilities });
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

// Get local model status (installed model from config)
router.get('/local-model/status', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const modelId = cfg.localModel?.modelId ?? null;
    const enabled = cfg.localModel?.enabled ?? false;
    const model = modelId ? getModelById(modelId) : null;
    res.json({
      installed: modelId,
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

// Delete downloaded model
function clearLocalModelConfig(eng: ReturnType<typeof getEngine>) {
  const cfg = eng.configManager.load();
  if (cfg.localModel?.modelId) {
    const { localModel: _, ...rest } = cfg;
    eng.configManager.save(rest);
  }
}

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
    const cacheDir = path.join(os.homedir(), '.agentx', 'models');
    // Transformers.js stores the model under a directory named after the model id
    const modelCacheDir = path.join(cacheDir, model.huggingFaceId);
    rmSync(modelCacheDir, { recursive: true, force: true });
    // Also remove the older HuggingFace-style cache directory if it exists
    const sanitized = model.huggingFaceId.replace(/[^a-zA-Z0-9_.-]/g, '-');
    rmSync(path.join(cacheDir, `models--${sanitized}`), { recursive: true, force: true });

    // Clear the localModel config entry so the UI shows no model installed
    const eng = getEngine();
    try {
      clearLocalModelConfig(eng);
      syncLocalModelConfig(eng.configManager);
    } catch (cfgErr) {
      console.error('Failed to clear local model config:', cfgErr);
    }

    res.json({ ok: true, message: 'Model deleted' });
  } catch (e) {
    console.error('Failed to delete model:', e);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Switch back to the primary cloud provider: delete the local model and clear config.
router.post('/local-model/switch-to-primary', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const modelId = cfg.localModel?.modelId;

    if (modelId) {
      const model = getModelById(modelId);
      if (model) {
        const cacheDir = path.join(os.homedir(), '.agentx', 'models');
        rmSync(path.join(cacheDir, model.huggingFaceId), { recursive: true, force: true });
        const sanitized = model.huggingFaceId.replace(/[^a-zA-Z0-9_.-]/g, '-');
        rmSync(path.join(cacheDir, `models--${sanitized}`), { recursive: true, force: true });
      }
    }

    clearLocalModelConfig(eng);
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
  const dtype = model.dtype ?? 'q4';

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
    } as any);

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

    // Save configuration so the local model is used for distillation, extraction, and consolidation.
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      eng.configManager.save({
        ...cfg,
        localModel: {
          enabled: true,
          modelId: model.id,
          modelName: model.huggingFaceId,
          displayName: model.displayName,
          cacheDir,
          downloadedAt: new Date().toISOString(),
          dtype,
        },
        featureRouting: {
          memoryDistillation: 'local',
          memoryExtraction: 'local',
          memoryConsolidation: 'local',
          ...(cfg.featureRouting || {}),
        },
      });
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
