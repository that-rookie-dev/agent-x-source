/**
 * Model catalog for local LLM options.
 *
 * Defines available models with their capabilities, requirements,
 * and metadata for user selection and system compatibility checking.
 */
import type { SystemCapabilities } from './SystemCapabilityDetector.js';

export interface ModelCapability {
  embedding: boolean;
  generation: boolean;
  speed: 'fast' | 'medium' | 'slow';
  quality: 'basic' | 'standard' | 'advanced';
  multilingual: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  displayName: string;
  description: string;
  sizeGB: number;
  ramRequirementGB: number;
  minCpuCores: number;
  capabilities: ModelCapability;
  tier: 'basic' | 'standard' | 'advanced';
  huggingFaceId: string;
  embeddingDimension: number;
  contextWindow: number;
}

export const MODEL_CATALOG: ModelOption[] = [
  {
    id: 'qwen-0.5b',
    name: 'onnx-community/Qwen2.5-0.5B-Instruct',
    displayName: 'Qwen 2.5 (0.5B)',
    description: 'Lightweight model for basic tasks. Good for embeddings and simple text generation. Fast on most systems.',
    sizeGB: 0.3,
    ramRequirementGB: 4,
    minCpuCores: 2,
    capabilities: {
      embedding: true,
      generation: true,
      speed: 'fast',
      quality: 'basic',
      multilingual: false,
    },
    tier: 'basic',
    huggingFaceId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    embeddingDimension: 1536,
    contextWindow: 2048,
  },
  {
    id: 'qwen-1.5b',
    name: 'onnx-community/Qwen2.5-1.5B-Instruct',
    displayName: 'Qwen 2.5 (1.5B)',
    description: 'Balanced model for most tasks. Better quality for distillation, extraction, and consolidation. Supports multiple languages.',
    sizeGB: 0.9,
    ramRequirementGB: 8,
    minCpuCores: 4,
    capabilities: {
      embedding: true,
      generation: true,
      speed: 'medium',
      quality: 'standard',
      multilingual: true,
    },
    tier: 'standard',
    huggingFaceId: 'onnx-community/Qwen2.5-1.5B-Instruct',
    embeddingDimension: 1536,
    contextWindow: 4096,
  },
  {
    id: 'qwen-3b',
    name: 'opalitestudios/Qwen2.5-3B-Instruct-ONNX',
    displayName: 'Qwen 2.5 (3B)',
    description: 'Advanced model for high-quality distillation, complex reasoning, and multilingual tasks. Requires more resources.',
    sizeGB: 1.8,
    ramRequirementGB: 16,
    minCpuCores: 8,
    capabilities: {
      embedding: true,
      generation: true,
      speed: 'slow',
      quality: 'advanced',
      multilingual: true,
    },
    tier: 'advanced',
    huggingFaceId: 'opalitestudios/Qwen2.5-3B-Instruct-ONNX',
    embeddingDimension: 1536,
    contextWindow: 8192,
  },
];

export function getModelById(id: string): ModelOption | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

export function getModelsByTier(tier: 'basic' | 'standard' | 'advanced'): ModelOption[] {
  return MODEL_CATALOG.filter(m => m.tier === tier);
}

export function getCompatibleModels(capabilities: SystemCapabilities): ModelOption[] {
  return MODEL_CATALOG.filter(model => {
    if (model.tier === 'basic') return capabilities.canRunBasic;
    if (model.tier === 'standard') return capabilities.canRunStandard;
    if (model.tier === 'advanced') return capabilities.canRunAdvanced;
    return false;
  });
}

export function getRecommendedModel(capabilities: SystemCapabilities): ModelOption | undefined {
  const compatible = getCompatibleModels(capabilities);
  // Return the highest tier compatible model
  return compatible.sort((a, b) => {
    const tierOrder = { advanced: 3, standard: 2, basic: 1 };
    return tierOrder[b.tier] - tierOrder[a.tier];
  })[0];
}
