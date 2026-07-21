import { z } from 'zod';
import {
  providerIdSchema,
  localModelConfigSchema,
  featureRoutingConfigSchema,
  notificationChannelsConfigSchema,
  toolsConfigSchema,
  voiceConfigSchema,
} from '@agentx/shared';

export const providerProfileSchema = z.object({
  label: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  createdAt: z.string().optional(),
});

export const providerCredentialsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  configured: z.boolean(),
  activeProfile: z.string().optional(),
  profiles: z.record(z.string(), providerProfileSchema).optional(),
});

export const providerSettingsSchema = z.object({
  activeProvider: providerIdSchema,
  activeModel: z.string(),
  activeReasoningEffort: z.string().optional(),
  providers: z.record(z.string(), providerCredentialsSchema),
});

export const uiSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  showTokenBar: z.boolean().default(true),
  showTimers: z.boolean().default(true),
  animationSpeed: z.enum(['normal', 'fast', 'reduced']).default('normal'),
  disabledTools: z.array(z.string()).optional(),
});

export const organizationConfigSchema = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
}).nullable();

export const userConfigSchema = z.object({
  callsign: z.string().min(1).max(30),
}).optional();

export const agentPersonaConfigSchema = z.object({
  name: z.string().default('Agent-X'),
  description: z.string().default('A proactive, autonomous AI assistant'),
  communicationStyle: z.enum(['formal', 'casual', 'direct', 'empathetic']).default('direct'),
  decisionMaking: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  domainContext: z.string().default('general'),
  traits: z.array(z.string()).default([]),
}).optional();

export const ragConfigSchema = z.object({
  enabled: z.boolean().default(false),
  embeddingModel: z.string().default('text-embedding-3-small'),
  chunkSize: z.number().default(512),
  chunkOverlap: z.number().default(64),
  topK: z.number().default(5),
  minScore: z.number().default(0.0),
}).optional();

/** Grounded retrieval knobs (see GROUNDED_EMBEDDING_RETRIEVAL_PLAN.md / RETRIEVAL_DEFAULTS). */
export const retrievalConfigSchema = z.object({
  chunkTargetChars: z.number().int().min(200).max(8000).default(1200),
  chunkOverlapChars: z.number().int().min(0).max(2000).default(120),
  minScoreMemory: z.number().min(0).max(1).default(0.42),
  minScoreKb: z.number().min(0).max(1).default(0.40),
  vectorOverFetch: z.number().int().min(5).max(200).default(40),
  rerankKeep: z.number().int().min(1).max(50).default(8),
  injectKeep: z.number().int().min(1).max(30).default(6),
  maxEvidenceCharsFull: z.number().int().min(500).max(20000).default(4000),
  maxEvidenceCharsCompact: z.number().int().min(200).max(8000).default(1500),
  maxEvidenceLineChars: z.number().int().min(100).max(2000).default(500),
  maxChunksPerSource: z.number().int().min(1).max(20).default(3),
  hybridEnabled: z.boolean().default(true),
  rerankEnabled: z.boolean().default(true),
  evidenceOnlyPrompt: z.boolean().default(true),
  graphExpandDepth: z.number().int().min(0).max(2).default(1),
  similarityEdgeMinScore: z.number().min(0).max(1).default(0.82),
  similarityEdgeMaxDegree: z.number().int().min(0).max(20).default(5),
}).optional();

export { notificationChannelsConfigSchema, toolsConfigSchema } from '@agentx/shared';

function migrateConfigPerformanceKey(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const legacyRuntime = obj['runtime'];
  const performance = obj['performance'];
  if (performance == null && legacyRuntime != null && typeof legacyRuntime === 'object') {
    const rt = { ...(legacyRuntime as Record<string, unknown>) };
    if (rt['budgetPercent'] == null && typeof rt['cpuBudgetPercent'] === 'number') {
      rt['budgetPercent'] = rt['cpuBudgetPercent'];
    }
    obj['performance'] = rt;
  } else if (performance != null && typeof performance === 'object') {
    const perf = { ...(performance as Record<string, unknown>) };
    if (perf['budgetPercent'] == null && typeof perf['cpuBudgetPercent'] === 'number') {
      perf['budgetPercent'] = perf['cpuBudgetPercent'];
    }
    obj['performance'] = perf;
  }
  delete obj['runtime'];
  return obj;
}

export const agentXConfigSchema = z.preprocess(migrateConfigPerformanceKey, z.object({
  provider: providerSettingsSchema,
  ui: uiSettingsSchema.default({}),
  organization: organizationConfigSchema.default(null),
  telemetry: z.boolean().default(false),
  timezone: z.string().optional(),
  user: userConfigSchema,
  setupComplete: z.boolean().optional(),
  workspacePath: z.string().min(1).optional(),
  rag: ragConfigSchema,
  retrieval: retrievalConfigSchema,
  tools: toolsConfigSchema,
  channels: notificationChannelsConfigSchema,
  voice: voiceConfigSchema,
  localModel: localModelConfigSchema,
  featureRouting: featureRoutingConfigSchema,
  performance: z.object({
    preset: z.enum(['quiet', 'balanced', 'performance', 'max']).optional(),
    budgetPercent: z.number().int().min(10).max(80).optional(),
    cpuBudgetPercent: z.number().int().min(10).max(80).optional(),
    lazyStorageCache: z.boolean().optional(),
    backgroundConcurrency: z.number().int().min(1).max(8).optional(),
  }).optional(),
  maxSubAgents: z.number().int().min(1).max(20).optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  maxOutputTokens: z.number().int().min(256).max(32768).optional(),
  useSandbox: z.boolean().optional(),
  postgres: z.object({
    connectionString: z.string().optional(),
    poolSize: z.number().int().min(1).max(100).optional(),
  }).optional(),
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
    }).passthrough()).optional(),
  }).passthrough()).optional(),
}));

export type ValidatedConfig = z.infer<typeof agentXConfigSchema>;
