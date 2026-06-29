import { z } from 'zod';

export const providerIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'ollama',
  'lmstudio',
  'moonshot',
  'deepseek',
  'groq',
  'mistral',
  'together',
  'xai',
  'fireworks',
  'perplexity',
  'azure',
  'cohere',
  'commandcode',
  'opencode',
  'opencode-zen',
]);

export const permissionDecisionSchema = z.enum([
  'allow_once',
  'allow_always',
  'deny',
]);

export const sessionStatusSchema = z.enum([
  'active',
  'paused',
  'completed',
  'archived',
]);

export const toolRiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

// ─── Config validation schema ────────────────────────────

export const providerProfileSchema = z.object({
  label: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  createdAt: z.string().optional(),
});

export const providerCredentialsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  configured: z.boolean(),
  activeProfile: z.string().optional(),
  profiles: z.record(providerProfileSchema).optional(),
});

export const ragConfigSchema = z.object({
  enabled: z.boolean().optional(),
  chunkSize: z.number().positive().optional(),
  chunkOverlap: z.number().min(0).optional(),
  topK: z.number().positive().optional(),
  minScore: z.number().min(0).max(1).optional(),
}).optional();

export const localModelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  modelId: z.string().optional(),
  modelName: z.string().optional(),
  displayName: z.string().optional(),
  cacheDir: z.string().optional(),
  downloadedAt: z.string().optional(),
  dtype: z.enum(['q4', 'q4f16', 'fp32', 'fp16', 'int8']).optional(),
  downloadedModels: z.array(z.object({
    modelId: z.string(),
    modelName: z.string(),
    displayName: z.string().optional(),
    downloadedAt: z.string(),
    dtype: z.enum(['q4', 'q4f16', 'fp32', 'fp16', 'int8']).optional(),
  })).optional(),
}).optional();

export const featureRoutingConfigSchema = z.object({
  memoryDistillation: z.enum(['cloud', 'local']).optional(),
  memoryExtraction: z.enum(['cloud', 'local']).optional(),
  memoryConsolidation: z.enum(['cloud', 'local']).optional(),
  embeddings: z.enum(['cloud', 'local']).optional(),
  graphRagExtraction: z.enum(['cloud', 'local']).optional(),
  graphRagSummarization: z.enum(['cloud', 'local']).optional(),
}).optional();

export const agentXConfigSchema = z.object({
  provider: z.object({
    activeProvider: providerIdSchema,
    activeModel: z.string(),
    providers: z.record(providerCredentialsSchema),
  }),
  localModel: localModelConfigSchema,
  featureRouting: featureRoutingConfigSchema,
  ui: z.object({
    theme: z.enum(['dark', 'light']),
    showTokenBar: z.boolean(),
    showTimers: z.boolean(),
    animationSpeed: z.enum(['normal', 'fast', 'reduced']),
    disabledTools: z.array(z.string()).optional(),
  }),
  organization: z.object({
    name: z.string(),
    contact: z.string().optional(),
  }).nullable(),
  telemetry: z.boolean(),
  timezone: z.string().optional(),
  user: z.object({
    callsign: z.string(),
  }).optional(),
  setupComplete: z.boolean().optional(),
  rag: ragConfigSchema,
  maxSubAgents: z.number().min(1).max(20).optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  maxOutputTokens: z.number().int().min(256).max(32768).optional(),
  useSandbox: z.boolean().optional(),
  neuralBrain: z.boolean().optional(),
  permissions: z.record(z.enum(['allow', 'deny', 'ask'])).optional(),
  agents: z.record(z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    systemPrompt: z.string().optional(),
    deniedTools: z.array(z.string()).optional(),
    permissions: z.array(z.object({
      id: z.string(),
      action: z.string(),
      pattern: z.string().optional(),
      effect: z.string(),
      comment: z.string().optional(),
    })).optional(),
  })).optional(),
});
