import { z } from 'zod';
import { providerIdSchema } from '@agentx/shared';

export const providerCredentialsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  configured: z.boolean(),
});

export const providerSettingsSchema = z.object({
  activeProvider: providerIdSchema,
  activeModel: z.string().min(1),
  providers: z.record(z.string(), providerCredentialsSchema),
});

export const uiSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  showTokenBar: z.boolean().default(true),
  showTimers: z.boolean().default(true),
  animationSpeed: z.enum(['normal', 'fast', 'reduced']).default('normal'),
});

export const organizationConfigSchema = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
}).nullable();

export const agentXConfigSchema = z.object({
  provider: providerSettingsSchema,
  ui: uiSettingsSchema.default({}),
  organization: organizationConfigSchema.default(null),
  telemetry: z.boolean().default(false),
  timezone: z.string().optional(),
});

export type ValidatedConfig = z.infer<typeof agentXConfigSchema>;
