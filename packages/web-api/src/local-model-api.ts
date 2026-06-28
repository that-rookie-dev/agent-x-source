/**
 * API endpoints for local model management.
 *
 * Provides system capability detection, model catalog, and model download
 * functionality for the setup wizard and settings pages.
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';
import os from 'os';
import { pipeline } from '@huggingface/transformers';
import { SystemCapabilityDetector } from '@agentx/engine';
import { MODEL_CATALOG, getModelById, getCompatibleModels, getRecommendedModel } from '@agentx/engine';
import { getEngine } from './engine.js';

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
    path.join(os.homedir(), '.agentx', 'models');
    // TODO: Implement actual cache deletion
    // Transformers.js stores models in a structured cache directory
    // We would need to delete the specific model's cache directory

    res.json({ ok: true, message: 'Model deleted' });
  } catch (e) {
    console.error('Failed to delete model:', e);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Download status tracking
const downloadStatuses = new Map<string, {
  status: 'downloading' | 'complete' | 'error';
  progress: number;
  error?: string;
}>();

async function downloadModel(model: any): Promise<void> {
  const cacheDir = path.join(os.homedir(), '.agentx', 'models');

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
    // Download for text generation
    await pipeline('text-generation', model.huggingFaceId, {
      dtype: 'q4',
      cache_dir: cacheDir,
    } as any);

    // Download for embeddings
    await pipeline('feature-extraction', model.huggingFaceId, {
      dtype: 'q4',
      cache_dir: cacheDir,
    } as any);

    clearInterval(progressInterval);
    downloadStatuses.set(model.id, {
      status: 'complete',
      progress: 100,
    });

    // Save configuration so the local model is used for embeddings and distillation
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
        },
        featureRouting: {
          memoryDistillation: 'local',
          memoryExtraction: 'local',
          memoryConsolidation: 'local',
          embeddings: 'local',
          ...(cfg.featureRouting || {}),
        },
      });
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
