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
