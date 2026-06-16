import { tool, jsonSchema, streamText, stepCountIs, type ToolSet, type LanguageModelV2 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { createGroq } from '@ai-sdk/groq';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { AgentXConfig, EngineEvent, ToolResult, CompletionChunk, CompletionToolCall } from '@agentx/shared';

const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  opencode: 'https://opencode.ai/zen/go/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
  commandcode: 'https://api.commandcode.ai/provider/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  cohere: 'https://api.cohere.com/compatibility/v1',
};

/**
 * Provider-aware retry configuration.
 * Different providers have different rate limits and error patterns.
 * This maps each provider to appropriate retry behavior for the AI SDK.
 */
function getProviderRetryConfig(providerId: string): { maxRetries: number; initialBackoffMs: number } {
  switch (providerId) {
    // Premium providers — generous retry on rate limits
    case 'openai':
    case 'azure':
      return { maxRetries: 5, initialBackoffMs: 1000 };
    // Anthropic has strict rate limits — fewer retries, longer backoff
    case 'anthropic':
      return { maxRetries: 3, initialBackoffMs: 2000 };
    // Google is fairly permissive
    case 'google':
      return { maxRetries: 5, initialBackoffMs: 500 };
    // Fast inference providers — quick retry
    case 'groq':
    case 'together':
    case 'fireworks':
      return { maxRetries: 3, initialBackoffMs: 500 };
    // Budget providers — conservative retry
    case 'deepseek':
    case 'moonshot':
    case 'mistral':
    case 'cohere':
    case 'commandcode':
    case 'xai':
    case 'perplexity':
      return { maxRetries: 2, initialBackoffMs: 1000 };
    // Local providers — no retry needed
    case 'ollama':
    case 'lmstudio':
      return { maxRetries: 1, initialBackoffMs: 100 };
    // OpenCode providers — standard retry
    case 'opencode':
    case 'opencode-zen':
      return { maxRetries: 3, initialBackoffMs: 1000 };
    default:
      return { maxRetries: 2, initialBackoffMs: 1000 };
  }
}

export function createAiSdkModel(config: AgentXConfig, explicitApiKey?: string): LanguageModelV2 {
  const activeProvider = config.provider.activeProvider;
  const providerCfg = config.provider.providers?.[activeProvider];
  const configApiKey = providerCfg?.apiKey || '';

  const envKey = process.env[`${activeProvider.toUpperCase()}_API_KEY`]
    || process.env['OPENAI_API_KEY']
    || process.env['ANTHROPIC_API_KEY']
    || process.env['GOOGLE_API_KEY']
    || '';

  const apiKey = explicitApiKey || configApiKey || envKey;
  const baseURL = providerCfg?.baseUrl;
  const modelId = config.provider.activeModel;

  switch (activeProvider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return openai(modelId);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return anthropic(modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return google(modelId);
    }
    case 'azure': {
      const azure = createAzure({ apiKey, baseURL: baseURL || '', ...(providerCfg?.azureResourceName ? { resourceName: (providerCfg as any).azureResourceName } : {}) });
      return azure(modelId);
    }
    case 'groq': {
      const groq = createGroq({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return groq(modelId);
    }
    case 'cohere':
    case 'commandcode': {
      const cohere = createCohere({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return cohere(modelId);
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return mistral(modelId);
    }
    case 'xai': {
      const xai = createXai({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return xai(modelId);
    }
    case 'perplexity': {
      const perplexity = createPerplexity({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return perplexity(modelId);
    }
    // All remaining providers are OpenAI-compatible
    case 'ollama':
    case 'lmstudio':
    case 'deepseek':
    case 'together':
    case 'moonshot':
    case 'fireworks':
    case 'opencode':
    case 'opencode-zen':
    default: {
      const resolvedUrl = baseURL || DEFAULT_BASE_URLS[activeProvider] || 'https://api.openai.com/v1';
      const compat = createOpenAICompatible({
        name: activeProvider,
        apiKey,
        baseURL: resolvedUrl,
      });
      return compat(modelId);
    }
  }
}

function convertToJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === 'object' && schema !== null) {
    const s = schema as Record<string, unknown>;
    return {
      type: s.type || 'object',
      properties: s.properties || {},
      required: Array.isArray(s.required) ? s.required : [],
      additionalProperties: false,
    };
  }
  return { type: 'object', properties: {}, required: [] };
}

export function createAiSdkTools(
  toolRegistry: ToolRegistry,
  toolExecutor: { execute: (toolId: string, args: Record<string, unknown>, sessionId: string) => Promise<ToolResult> },
  sessionId: string,
  emit: (event: EngineEvent) => void,
  waitForClarification: (question: string, options: string[], allowFreeform: boolean) => Promise<string>,
  runSubAgent: (instruction: string, tools: string[] | undefined, timeout: number) => Promise<{ success: boolean; output: string; elapsed: number }>,
): ToolSet {
  const allTools = toolRegistry.list();
  const tools: ToolSet = {};

  for (const toolDef of allTools) {
    const schema = convertToJsonSchema(toolDef.schema);

    if (toolDef.id === 'ask_clarification') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          const question = (args as any).question || 'I need more information.';
          const options = Array.isArray((args as any).options) ? (args as any).options : [];
          const allowFreeform = (args as any).allowFreeform !== false;
          const response = await waitForClarification(question, options, allowFreeform);
          return `User response: ${response}`;
        },
      });
      continue;
    }

    if (toolDef.id === 'delegate_to_subagent') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          const mission = (args as any).mission || '';
          const toolsList = Array.isArray((args as any).tools) ? (args as any).tools : undefined;
          const timeout = typeof (args as any).timeout === 'number' ? (args as any).timeout : 120_000;
          emit({ type: 'tool_executing', tool: 'delegate_to_subagent', description: `Spawning sub-agent: ${mission}`, startTime: Date.now(), args: args as Record<string, unknown>, callId: 'subagent' });
          const result = await runSubAgent(mission, toolsList, timeout);
          const output = result.success
            ? `[Sub-agent completed in ${result.elapsed}ms]\n${result.output}`
            : `[Sub-agent failed: ${result.output}]`;
          emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: result.success, output }, elapsed: result.elapsed, args: args as Record<string, unknown>, callId: 'subagent' });
          return output;
        },
      });
      continue;
    }

    tools[toolDef.id] = tool({
      description: toolDef.modelDescription,
      inputSchema: jsonSchema(schema),
      async execute(args, options) {
        const startTime = Date.now();
        const callId = options?.toolCallId || `tc-${toolDef.id}-${startTime}`;
        emit({ type: 'tool_executing', tool: toolDef.id, description: `Executing ${toolDef.name}`, startTime, args: args as Record<string, unknown>, callId });

        try {
          const result: ToolResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId);
          const elapsed = Date.now() - startTime;
          emit({ type: 'tool_complete', tool: toolDef.id, result: { success: result.success, output: result.output }, elapsed, args: args as Record<string, unknown>, callId });

          if (!result.success) {
            return `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
          }
          return result.output;
        } catch (err) {
          const elapsed = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : String(err);
          emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output: errorMsg }, elapsed, args: args as Record<string, unknown>, callId });
          return `[TOOL ERROR] ${errorMsg}`;
        }
      },
    });
  }

  return tools;
}

/**
 * AI SDK-backed replacement for the old `_unifiedStream`.
 * Uses streamText() internally but emits CompletionChunk events for
 * backward compatibility with existing callers (runFastReply, runSingleStep,
 * generatePlan, etc.).
 */
export async function* aiSdkStream(
  config: AgentXConfig,
  messages: Array<{ role: string; content: string }>,
  tools: ToolSet | undefined,
  abortSignal?: AbortSignal,
  explicitApiKey?: string,
): AsyncIterable<CompletionChunk> {
  const model = createAiSdkModel(config, explicitApiKey);

  try {
    const result = streamText({
      model,
      messages: messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      ...(tools ? { tools } : {}),
      temperature: 0,
      stopWhen: stepCountIs(5),
      abortSignal,
    });

    let chunkCount = 0;
    let textChunkCount = 0;
    for await (const chunk of result.fullStream) {
      chunkCount++;
      switch (chunk.type) {
        case 'text-delta':
          textChunkCount++;
          yield { type: 'text_delta', content: (chunk as any).textDelta || (chunk as any).text || '' };
          break;

        case 'tool-call': {
          const tc: CompletionToolCall = {
            id: chunk.toolCallId,
            type: 'function',
            function: {
              name: chunk.toolName,
              arguments: JSON.stringify(chunk.args),
            },
          };
          yield { type: 'tool_call_delta', toolCall: tc };
          break;
        }

        case 'step-finish':
          if (chunk.usage) {
            yield {
              type: 'done',
              usage: {
                inputTokens: chunk.usage.inputTokens || 0,
                outputTokens: chunk.usage.outputTokens || 0,
              },
            };
          }
          break;

        case 'finish':
          if (chunk.usage) {
            yield {
              type: 'done',
              usage: {
                inputTokens: chunk.totalUsage?.inputTokens || chunk.usage?.inputTokens || 0,
                outputTokens: chunk.totalUsage?.outputTokens || chunk.usage?.outputTokens || 0,
              },
            };
          }
          break;

        case 'error':
          throw new Error(String(chunk.error || 'AI SDK stream error'));
      }
    }
    if (chunkCount === 0) {
      getLogger().warn('AI_SDK', `streamText produced ZERO fullStream chunks. Model: ${modelId}, Provider: ${activeProvider}`);
    }
    if (textChunkCount === 0 && chunkCount > 0) {
      getLogger().warn('AI_SDK', `streamText produced ${chunkCount} chunks but ZERO text-delta chunks. Types: check fullStream output`);
    }
  } finally {
    // no cleanup needed — AI SDK handles its own lifecycle
  }
}
