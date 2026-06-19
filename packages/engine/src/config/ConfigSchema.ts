import { z } from 'zod';
import { providerIdSchema } from '@agentx/shared';

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

export const agentXConfigSchema = z.object({
  provider: providerSettingsSchema,
  ui: uiSettingsSchema.default({}),
  organization: organizationConfigSchema.default(null),
  telemetry: z.boolean().default(false),
  timezone: z.string().optional(),
  user: userConfigSchema,
  setupComplete: z.boolean().optional(),
  rag: ragConfigSchema,
});

export type ValidatedConfig = z.infer<typeof agentXConfigSchema>;
