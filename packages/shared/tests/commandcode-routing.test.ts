import { describe, it, expect } from 'vitest';
import {
  inferCommandCodeProtocolFromCatalog,
  parseCommandCodeModelProtocol,
  readCommandCodeProtocolFromApiRecord,
  resolveCommandCodeAnthropicBaseUrl,
  resolveCommandCodeOpenAiBaseUrl,
} from '../src/utils/commandcode-routing.js';

describe('inferCommandCodeProtocolFromCatalog', () => {
  it('routes Claude models to Anthropic Messages', () => {
    expect(inferCommandCodeProtocolFromCatalog('claude-haiku-4-5-20251001')).toBe('anthropic-messages');
    expect(inferCommandCodeProtocolFromCatalog('claude-sonnet-4-6')).toBe('anthropic-messages');
  });

  it('routes OpenAI and open-source models to OpenAI Chat Completions', () => {
    expect(inferCommandCodeProtocolFromCatalog('gpt-5.6-terra')).toBe('openai-chat');
    expect(inferCommandCodeProtocolFromCatalog('deepseek/deepseek-v4-flash')).toBe('openai-chat');
    expect(inferCommandCodeProtocolFromCatalog('moonshotai/Kimi-K2.7-Code')).toBe('openai-chat');
  });
});

describe('readCommandCodeProtocolFromApiRecord', () => {
  it('prefers API metadata when CommandCode exposes protocol fields', () => {
    expect(readCommandCodeProtocolFromApiRecord({ api_format: 'anthropic-messages' })).toBe('anthropic-messages');
    expect(readCommandCodeProtocolFromApiRecord({ protocol: 'openai-chat' })).toBe('openai-chat');
  });
});

describe('parseCommandCodeModelProtocol', () => {
  it('uses API metadata over catalog inference', () => {
    expect(parseCommandCodeModelProtocol('claude-sonnet-4-6', { api_format: 'openai-chat' })).toBe('openai-chat');
  });

  it('falls back to catalog inference when metadata is absent', () => {
    expect(parseCommandCodeModelProtocol('claude-sonnet-4-6')).toBe('anthropic-messages');
    expect(parseCommandCodeModelProtocol('gpt-5.4')).toBe('openai-chat');
  });
});

describe('resolveCommandCode base URLs', () => {
  it('normalizes OpenAI-compat base URLs', () => {
    expect(resolveCommandCodeOpenAiBaseUrl()).toBe('https://api.commandcode.ai/provider/v1');
    expect(resolveCommandCodeOpenAiBaseUrl('https://api.commandcode.ai/provider')).toBe(
      'https://api.commandcode.ai/provider/v1',
    );
  });

  it('normalizes Anthropic SDK root base URLs', () => {
    expect(resolveCommandCodeAnthropicBaseUrl()).toBe('https://api.commandcode.ai/provider');
    expect(resolveCommandCodeAnthropicBaseUrl('https://api.commandcode.ai/provider/v1')).toBe(
      'https://api.commandcode.ai/provider',
    );
  });
});
