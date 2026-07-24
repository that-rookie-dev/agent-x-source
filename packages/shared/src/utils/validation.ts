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

const voiceDownloadedAssetSchema = z.object({
  assetId: z.string(),
  kind: z.enum([
    'python-runtime',
    'sidecar-dependency',
    'stt-model',
    'tts-model',
    'tts-voice',
    'vad-model',
    'helper-binary',
  ]),
  engine: z.enum(['faster-whisper', 'kokoro']).optional(),
  version: z.string().optional(),
  installedAt: z.string(),
  sizeBytes: z.number().optional(),
  sha256: z.string().optional(),
});

export const voiceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.object({
    web: z.enum(['off', 'push-to-talk', 'duplex']).optional(),
    channels: z.enum(['off', 'voice-notes']).optional(),
  }).optional(),
  engine: z.enum(['stt_llm_tts', 'realtime_xai']).optional(),
  xai: z.object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    voice: z.string().optional(),
    baseUrl: z.string().optional(),
  }).optional(),
  stt: z.object({
    engine: z.literal('faster-whisper').default('faster-whisper'),
    modelId: z.string().optional(),
    computeType: z.enum(['auto', 'int8', 'int8_float16', 'float16', 'float32']).optional(),
    device: z.enum(['auto', 'cpu', 'cuda']).optional(),
  }).optional(),
  tts: z.object({
    engine: z.literal('kokoro').default('kokoro'),
    voiceId: z.string().optional(),
    style: z.object({
      emotion: z.string().optional(),
      expressiveness: z.number().min(0).max(2).optional(),
    }).optional(),
    fillerEngine: z.literal('kokoro').optional(),
  }).optional(),
  sidecar: z.object({
    autoStart: z.boolean().optional(),
    idleUnloadMinutes: z.number().min(0).max(120).optional(),
  }).optional(),
  fillers: z.object({
    enabled: z.boolean().optional(),
    speakToolProgress: z.boolean().optional(),
  }).optional(),
  wakeWord: z.object({
    enabled: z.boolean().optional(),
    phrase: z.string().optional(),
  }).optional(),
  downloadedAssets: z.array(voiceDownloadedAssetSchema).optional(),
  provider: z.object({
    activeProvider: z.string().optional(),
    activeModel: z.string().optional(),
    activeProfile: z.string().optional(),
  }).optional(),
}).optional();

export const featureRoutingConfigSchema = z.object({
  memoryExtraction: z.enum(['cloud', 'local']).optional(),
  memoryConsolidation: z.enum(['cloud', 'local']).optional(),
  embeddings: z.enum(['cloud', 'local']).optional(),
}).optional();

export const webSearchPaidProviderSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
});

export const webSearchProviderIdSchema = z.enum(['duckduckgo', 'brave', 'exa', 'tavily']);

export const webSearchToolsConfigSchema = z.object({
  duckduckgo: z.object({ enabled: z.boolean().default(true) }).optional(),
  brave: webSearchPaidProviderSchema.optional(),
  exa: webSearchPaidProviderSchema.optional(),
  tavily: webSearchPaidProviderSchema.optional(),
  providerOrder: z.array(webSearchProviderIdSchema).optional(),
}).optional();

export const toolsConfigSchema = z.object({
  webSearch: webSearchToolsConfigSchema,
}).optional();

const channelDirectionSchema = z.object({
  enabled: z.boolean().optional(),
  inbound: z.boolean().optional(),
  outbound: z.boolean().optional(),
});

export const notificationChannelsConfigSchema = z.object({
  telegram: channelDirectionSchema.extend({
    botToken: z.string().optional(),
    chatId: z.string().optional(),
  }).optional(),
  slack: channelDirectionSchema.extend({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    appToken: z.string().optional(),
  }).optional(),
  email: channelDirectionSchema.extend({
    smtpHost: z.string().optional(),
    smtpPort: z.number().optional(),
    smtpUser: z.string().optional(),
    smtpPassword: z.string().optional(),
    fromAddress: z.string().optional(),
    toAddress: z.string().optional(),
    useTls: z.boolean().optional(),
  }).optional(),
  discord: channelDirectionSchema.extend({
    webhookUrl: z.string().optional(),
    botToken: z.string().optional(),
    channelId: z.string().optional(),
  }).optional(),
}).optional();

export const performancePresetSchema = z.enum(['quiet', 'balanced', 'moderate', 'ultimate']);

/** Accept current + legacy (`performance`→`moderate`, `max`→`ultimate`) preset ids. */
export const performancePresetInputSchema = z.preprocess((raw) => {
  if (raw === 'performance') return 'moderate';
  if (raw === 'max') return 'ultimate';
  return raw;
}, performancePresetSchema);

export const performanceSettingsSchema = z.object({
  preset: performancePresetInputSchema.optional(),
  budgetPercent: z.number().int().min(10).max(80).optional(),
  /** @deprecated Prefer budgetPercent — accepted for one-release local migrate. */
  cpuBudgetPercent: z.number().int().min(10).max(80).optional(),
  lazyStorageCache: z.boolean().optional(),
  backgroundConcurrency: z.number().int().min(1).max(8).optional(),
}).optional();

/** @deprecated Use performanceSettingsSchema */
export const runtimeSettingsSchema = performanceSettingsSchema;
/** @deprecated Use performancePresetSchema */
export const runtimePresetSchema = performancePresetSchema;

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
  const migratedPerf = obj['performance'];
  if (migratedPerf != null && typeof migratedPerf === 'object') {
    const perf = migratedPerf as Record<string, unknown>;
    if (perf['preset'] === 'performance') perf['preset'] = 'moderate';
    else if (perf['preset'] === 'max') perf['preset'] = 'ultimate';
  }
  delete obj['runtime'];
  return obj;
}

export const agentXConfigSchema = z.preprocess(migrateConfigPerformanceKey, z.object({
  provider: z.object({
    activeProvider: providerIdSchema,
    activeModel: z.string(),
    activeReasoningEffort: z.string().optional(),
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
  tools: toolsConfigSchema,
  channels: notificationChannelsConfigSchema,
  voice: voiceConfigSchema,
  performance: performanceSettingsSchema,
  maxSubAgents: z.number().min(1).max(20).optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  maxOutputTokens: z.number().int().min(256).max(32768).optional(),
  useSandbox: z.boolean().optional(),
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
}));
