import type { ModelCapability, ModelInfo, ModelReasoningInfo, ReasoningEffortLevel } from '@agentx/shared';
export const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** OpenAI-compatible Gemini chat base — see https://ai.google.dev/gemini-api/docs/openai */
export const GEMINI_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

export function normalizeGoogleModelId(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

/** Native `Model` resource from models.list / models.get — https://ai.google.dev/api/models#Model */
export interface GeminiNativeModelRecord {
  name: string;
  baseModelId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  thinking?: boolean;
  temperature?: number;
  maxTemperature?: number;
}

interface GeminiThinkingProfile {
  pattern: RegExp;
  nativeLevels: Array<'minimal' | 'low' | 'medium' | 'high'>;
  defaultLevel: ReasoningEffortLevel;
  allowNone: boolean;
}

/**
 * Thinking levels per model family — derived from:
 * https://ai.google.dev/gemini-api/docs/thinking
 * https://ai.google.dev/gemini-api/docs/openai (reasoning_effort mapping)
 */
const THINKING_PROFILES: GeminiThinkingProfile[] = [
  { pattern: /gemini-3\.1-pro/i, nativeLevels: ['low', 'medium', 'high'], defaultLevel: 'high', allowNone: false },
  { pattern: /gemini-3\.1-flash-lite/i, nativeLevels: ['minimal', 'high'], defaultLevel: 'minimal', allowNone: false },
  { pattern: /gemini-3(?:\.|-)flash/i, nativeLevels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'high', allowNone: false },
  { pattern: /gemini-3-pro/i, nativeLevels: ['low', 'high'], defaultLevel: 'high', allowNone: false },
  { pattern: /gemini-3\.5-flash/i, nativeLevels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'medium', allowNone: false },
  { pattern: /gemini-2\.5-pro/i, nativeLevels: ['low', 'medium', 'high'], defaultLevel: 'medium', allowNone: false },
  { pattern: /gemini-2\.5-flash-lite/i, nativeLevels: ['low', 'medium', 'high'], defaultLevel: 'low', allowNone: true },
  { pattern: /gemini-2\.5-flash/i, nativeLevels: ['low', 'medium', 'high'], defaultLevel: 'medium', allowNone: true },
];

function matchThinkingProfile(modelKey: string): GeminiThinkingProfile | undefined {
  return THINKING_PROFILES.find((p) => p.pattern.test(modelKey));
}

/** Map OpenAI-compat reasoning_effort to native thinking_level for providerOptions. */
export function mapReasoningEffortToThinkingLevel(
  effort: ReasoningEffortLevel,
  modelId: string,
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  if (effort === 'none') return undefined;
  const profile = matchThinkingProfile(normalizeGoogleModelId(modelId));
  const level = effort as 'minimal' | 'low' | 'medium' | 'high';
  if (profile && profile.nativeLevels.includes(level)) return level;
  if (['minimal', 'low', 'medium', 'high'].includes(level)) return level;
  return 'medium';
}

export function resolveGeminiReasoningInfo(record: GeminiNativeModelRecord): ModelReasoningInfo | undefined {
  if (!record.thinking) return undefined;

  const modelKey = record.baseModelId ?? normalizeGoogleModelId(record.name);
  const profile = matchThinkingProfile(modelKey);
  if (!profile) {
    return {
      supported: true,
      effortLevels: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      control: 'reasoning_effort',
    };
  }

  const effortLevels: ReasoningEffortLevel[] = profile.allowNone ? ['none', ...profile.nativeLevels] : [...profile.nativeLevels];
  return {
    supported: true,
    effortLevels,
    defaultEffort: profile.defaultLevel,
    control: 'reasoning_effort',
  };
}

function inferCapabilities(record: GeminiNativeModelRecord, id: string): ModelCapability[] {
  const caps: ModelCapability[] = ['text', 'function_calling', 'streaming'];
  const key = id.toLowerCase();
  if (key.includes('flash') || key.includes('pro') || key.includes('vision') || key.includes('image')) {
    caps.push('vision');
  }
  if (record.thinking) caps.push('reasoning');
  if (key.includes('flash') || key.includes('pro') || key.includes('json')) {
    caps.push('json_mode');
  }
  return caps;
}

export function nativeRecordToModelInfo(record: GeminiNativeModelRecord): ModelInfo | null {
  if (!record.name.includes('gemini')) return null;
  if (!record.supportedGenerationMethods?.includes('generateContent')) return null;

  const id = normalizeGoogleModelId(record.name);
  return {
    id,
    name: record.displayName ?? id,
    providerId: 'google',
    contextWindow: record.inputTokenLimit ?? 1_000_000,
    outputTokenLimit: record.outputTokenLimit,
    capabilities: inferCapabilities(record, id),
    reasoning: resolveGeminiReasoningInfo(record),
  };
}

/** Paginated models.list — https://ai.google.dev/api/models#method:-models.list */
export async function fetchAllNativeGeminiModels(apiKey: string): Promise<GeminiNativeModelRecord[]> {
  const models: GeminiNativeModelRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GEMINI_NATIVE_BASE}/models`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`Gemini models.list failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      models?: GeminiNativeModelRecord[];
      nextPageToken?: string;
    };
    models.push(...(data.models ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return models;
}

/** models.get for a single model — https://ai.google.dev/api/models#method:-models.get */
export async function fetchNativeGeminiModel(
  apiKey: string,
  modelId: string,
): Promise<GeminiNativeModelRecord | null> {
  const name = modelId.startsWith('models/') ? modelId : `models/${normalizeGoogleModelId(modelId)}`;
  const response = await fetch(`${GEMINI_NATIVE_BASE}/${name}?key=${apiKey}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as GeminiNativeModelRecord;
}

export async function listGeminiModels(apiKey: string, openAiBaseUrl: string): Promise<ModelInfo[]> {
  const merged = new Map<string, ModelInfo>();

  try {
    const nativeRecords = await fetchAllNativeGeminiModels(apiKey);
    for (const record of nativeRecords) {
      const info = nativeRecordToModelInfo(record);
      if (info) merged.set(info.id, info);
    }
  } catch {
    // fall through to OpenAI-compat list
  }

  try {
    const response = await fetch(`${openAiBaseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      for (const m of data.data ?? []) {
        if (!m.id.includes('gemini')) continue;
        const id = normalizeGoogleModelId(m.id);
        if (merged.has(id)) continue;
        const stub: GeminiNativeModelRecord = {
          name: `models/${id}`,
          baseModelId: id,
          supportedGenerationMethods: ['generateContent'],
          thinking: /gemini-(2\.5|3)/i.test(id),
        };
        merged.set(id, nativeRecordToModelInfo(stub)!);
      }
    }
  } catch { /* ignore */ }

  const models = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (models.length === 0) {
    throw new Error('Failed to fetch Gemini models from native and OpenAI-compatible endpoints');
  }
  return models;
}

type GoogleThinkingConfig =
  | { thinkingBudget: number }
  | { thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' };

/** Provider options for @ai-sdk/google streamText — maps config effort to thinkingConfig. */
export function buildGoogleAiSdkProviderOptions(
  modelId: string,
  reasoningEffort?: ReasoningEffortLevel,
): { google: { thinkingConfig: GoogleThinkingConfig } } | undefined {
  if (!reasoningEffort) return undefined;
  if (reasoningEffort === 'none') {
    return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  }
  const thinkingLevel = mapReasoningEffortToThinkingLevel(reasoningEffort, modelId);
  if (!thinkingLevel) return undefined;
  return { google: { thinkingConfig: { thinkingLevel } } };
}

/** Build a probe URL for provider reachability checks (GET, not HEAD). */
export function buildProviderConnectivityProbeUrl(
  providerId: string,
  baseUrl: string | undefined,
  apiKey?: string,
): string | null {
  if (providerId === 'google') {
    if (apiKey) {
      return `${GEMINI_NATIVE_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=1`;
    }
    const base = (baseUrl ?? GEMINI_OPENAI_BASE).replace(/\/+$/, '');
    return `${base}/models`;
  }
  if (!baseUrl) return null;
  const trimmed = baseUrl.replace(/\/+$/, '');
  // Only strip a trailing /v1 segment — never mutate v1beta.
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/models`;
}

/** Native Gemini base for @ai-sdk/google (not the OpenAI-compat path). */
export function resolveGoogleNativeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return GEMINI_NATIVE_BASE;
  return baseUrl.replace(/\/openai\/?$/, '').replace(/\/+$/, '') || GEMINI_NATIVE_BASE;
}
