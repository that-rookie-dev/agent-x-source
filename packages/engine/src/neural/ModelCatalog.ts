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
  dtype: 'q4' | 'q4f16' | 'fp32' | 'fp16' | 'int8';
  /** Rank for the local-model selection page (1 = best recommendation). */
  rank: number;
  /** Short label for the best use case. */
  bestFor: string;
  /** Human-readable note about why to pick this model. */
  recommendation: string;
}

export const MODEL_CATALOG: ModelOption[] = [
  {
    id: 'smollm-135m',
    name: 'HuggingFaceTB/SmolLM-135M-Instruct',
    displayName: 'SmolLM 2 (135M)',
    description: 'Tiny instruction-tuned model. Extremely fast on low-end hardware. Best for simple memory extraction and basic summarization.',
    sizeGB: 0.18,
    ramRequirementGB: 2,
    minCpuCores: 2,
    capabilities: {
      embedding: true,
      generation: true,
      speed: 'fast',
      quality: 'basic',
      multilingual: false,
    },
    tier: 'basic',
    huggingFaceId: 'HuggingFaceTB/SmolLM-135M-Instruct',
    embeddingDimension: 1536,
    contextWindow: 2048,
    dtype: 'q4',
    rank: 2,
    bestFor: 'Speed / basic extraction',
    recommendation: 'Pick this if you want fast background memory extraction on modest hardware.',
  },
  {
    id: 'smollm-360m',
    name: 'HuggingFaceTB/SmolLM-360M-Instruct',
    displayName: 'SmolLM 2 (360M)',
    description: 'Small but capable instruction model. Faster than Qwen 0.5B while still handling extraction and consolidation well.',
    sizeGB: 0.39,
    ramRequirementGB: 4,
    minCpuCores: 2,
    capabilities: {
      embedding: true,
      generation: true,
      speed: 'fast',
      quality: 'standard',
      multilingual: false,
    },
    tier: 'basic',
    huggingFaceId: 'HuggingFaceTB/SmolLM-360M-Instruct',
    embeddingDimension: 1536,
    contextWindow: 2048,
    dtype: 'q4',
    rank: 1,
    bestFor: 'Best speed/quality balance',
    recommendation: 'Recommended for most users: fast enough to run on every chat turn but still produces reliable extraction JSON.',
  },
  {
    id: 'qwen-0.5b',
    name: 'onnx-community/Qwen2.5-0.5B-Instruct',
    displayName: 'Qwen 2.5 (0.5B)',
    description: 'Lightweight model for basic tasks. Good for memory extraction and simple text generation. Fast on most systems.',
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
    dtype: 'q4',
    rank: 3,
    bestFor: 'Reliable basic extraction',
    recommendation: 'A safe default if you prefer the Qwen family. Slightly larger than SmolLM 360M but still very fast.',
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
    dtype: 'q4',
    rank: 4,
    bestFor: 'Multilingual / better quality',
    recommendation: 'Pick this if you need multilingual support or higher-quality local distillation and consolidation.',
  },
  {
    id: 'qwen-3b',
    name: 'onnx-community/Qwen2.5-Coder-3B-Instruct',
    displayName: 'Qwen 2.5 Coder (3B)',
    description: 'Advanced 3B model for high-quality distillation, complex reasoning, and coding tasks. Requires more resources.',
    sizeGB: 3.2,
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
    huggingFaceId: 'onnx-community/Qwen2.5-Coder-3B-Instruct',
    embeddingDimension: 1536,
    contextWindow: 8192,
    dtype: 'q4',
    rank: 5,
    bestFor: 'High-quality local reasoning',
    recommendation: 'Only choose this if you have plenty of RAM and CPU. Best quality for local distillation/consolidation but noticeably slower.',
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
