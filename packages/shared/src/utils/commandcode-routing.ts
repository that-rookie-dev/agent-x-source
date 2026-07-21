import type { ModelInfo } from '../types/provider.js';

/** OpenAI Chat Completions base — lists models and serves non-Anthropic models. */
export const COMMANDCODE_OPENAI_V1_BASE = 'https://api.commandcode.ai/provider/v1';

/**
 * Anthropic Messages root — the Anthropic SDK appends `/v1/messages`.
 * @see https://docs.commandcode.ai/provider-api
 */
export const COMMANDCODE_ANTHROPIC_ROOT = 'https://api.commandcode.ai/provider';

/** Native API transport shapes exposed by this multi-protocol provider API. */
export type CommandCodeApiProtocol = 'openai-chat' | 'anthropic-messages';

const API_PROTOCOL_FIELD_ALIASES = [
  'api_format',
  'apiFormat',
  'api_protocol',
  'apiProtocol',
  'protocol',
  'endpoint_format',
  'endpointFormat',
  'transport',
  'api_shape',
  'apiShape',
] as const;

function normalizeProtocolToken(raw: string): CommandCodeApiProtocol | undefined {
  const normalized = raw.trim().toLowerCase().replace(/-/g, '_');
  if (
    normalized.includes('anthropic')
    || normalized === 'messages'
    || normalized === 'anthropic_messages'
  ) {
    return 'anthropic-messages';
  }
  if (
    normalized.includes('openai')
    || normalized === 'chat_completions'
    || normalized === 'chat'
    || normalized === 'openai_chat'
  ) {
    return 'openai-chat';
  }
  return undefined;
}

/** Read per-model protocol metadata when the provider (or a proxy) exposes it on /models records. */
export function readCommandCodeProtocolFromApiRecord(
  record: Record<string, unknown>,
): CommandCodeApiProtocol | undefined {
  for (const key of API_PROTOCOL_FIELD_ALIASES) {
    const raw = record[key];
    if (typeof raw === 'string') {
      const parsed = normalizeProtocolToken(raw);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

/**
 * Catalog fallback when /models omits protocol metadata.
 * CommandCode documents: `/v1/messages` for Anthropic (Claude); `/v1/chat/completions`
 * for OpenAI, Google, and open-source models.
 */
export function inferCommandCodeProtocolFromCatalog(modelId: string): CommandCodeApiProtocol {
  const id = modelId.trim().toLowerCase();
  const leaf = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  if (leaf.startsWith('claude-')) return 'anthropic-messages';
  return 'openai-chat';
}

export function parseCommandCodeModelProtocol(
  modelId: string,
  record?: Record<string, unknown>,
): CommandCodeApiProtocol {
  if (record) {
    const fromApi = readCommandCodeProtocolFromApiRecord(record);
    if (fromApi) return fromApi;
  }
  return inferCommandCodeProtocolFromCatalog(modelId);
}

export function resolveCommandCodeModelProtocol(
  modelId: string,
  modelInfo?: Pick<ModelInfo, 'apiProtocol'>,
  record?: Record<string, unknown>,
): CommandCodeApiProtocol {
  if (modelInfo?.apiProtocol) return modelInfo.apiProtocol;
  return parseCommandCodeModelProtocol(modelId, record);
}

export function resolveCommandCodeOpenAiBaseUrl(configured?: string): string {
  const trimmed = configured?.replace(/\/+$/, '');
  if (!trimmed) return COMMANDCODE_OPENAI_V1_BASE;
  if (trimmed.endsWith('/provider')) return `${trimmed}/v1`;
  return trimmed;
}

export function resolveCommandCodeAnthropicBaseUrl(configured?: string): string {
  const trimmed = configured?.replace(/\/+$/, '');
  if (!trimmed) return COMMANDCODE_ANTHROPIC_ROOT;
  if (trimmed.endsWith('/v1')) return trimmed.slice(0, -'/v1'.length);
  return trimmed;
}
