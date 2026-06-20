import { tool, jsonSchema, streamText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { getLogger } from '@agentx/shared';
import { createGroq } from '@ai-sdk/groq';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { AgentXConfig, EngineEvent, ToolResult, CompletionChunk, CompletionToolCall } from '@agentx/shared';
import { FiberSet } from '../concurrency/FiberSet.js';

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

export function createAiSdkModel(config: AgentXConfig, explicitApiKey?: string): LanguageModel {
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
      const azure = createAzure({ apiKey, baseURL: baseURL || '', ...((providerCfg as any)?.azureResourceName ? { resourceName: (providerCfg as any).azureResourceName } : {}) });
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
  toolExecutor: { execute: (toolId: string, args: Record<string, unknown>, sessionId: string) => Promise<ToolResult>; setToolOutputHandler?: (handler: (output: string) => void) => void },
  sessionId: string,
  emit: (event: EngineEvent) => void,
  waitForClarification: (question: string, options: string[], allowFreeform: boolean) => Promise<string>,
  runSubAgent: (instruction: string, tools: string[] | undefined, timeout: number, background?: boolean) => Promise<{ success: boolean; output: string; elapsed: number }>,
): ToolSet {
  const allTools = toolRegistry.list();
  const tools: ToolSet = {};

  // Wire real-time tool output streaming
  const activeOutputCalls = new Map<string, string>(); // callId -> tool name
  if (toolExecutor.setToolOutputHandler) {
    toolExecutor.setToolOutputHandler((output: string) => {
      // Find the currently executing tool call
      for (const [callId, toolName] of activeOutputCalls) {
        emit({ type: 'tool_output', tool: toolName, callId, output, timestamp: Date.now() });
      }
    });
  }

  for (const toolDef of allTools) {
    const schema = convertToJsonSchema(toolDef.schema);

    if (toolDef.id === 'ask_clarification') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          const fiberSet = new FiberSet();
          fiberSet.run('ask_clarification', async () => {
            const question = (args as any).question || 'I need more information.';
            const options = Array.isArray((args as any).options) ? (args as any).options : [];
            const allowFreeform = (args as any).allowFreeform !== false;
            const response = await waitForClarification(question, options, allowFreeform);
            return `User response: ${response}`;
          });
          const [result] = await fiberSet.joinAll<string>();
          return result;
        },
      });
      continue;
    }

    if (toolDef.id === 'delegate_to_subagent') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          const fiberSet = new FiberSet();
          fiberSet.run('delegate_to_subagent', async () => {
            const mission = (args as any).mission || '';
            const items = Array.isArray((args as any).items) ? (args as any).items as string[] : undefined;
            const toolsList = Array.isArray((args as any).tools) ? (args as any).tools : undefined;
            const timeout = typeof (args as any).timeout === 'number' ? (args as any).timeout : 120_000;
            const background = (args as any).background === true;
            const batchSize = Math.max(1, Math.min(typeof (args as any).batchSize === 'number' ? (args as any).batchSize : 10, 50));

            // Batch mode: auto-parallelize items across sub-agents
            if (items && items.length > 0) {
              const chunks: string[][] = [];
              for (let i = 0; i < items.length; i += batchSize) {
                chunks.push(items.slice(i, i + batchSize));
              }

              emit({
                type: 'tool_executing',
                tool: 'delegate_to_subagent',
                description: `Dispatching ${items.length} items across ${chunks.length} sub-agents (batch size ${batchSize})`,
                startTime: Date.now(),
                args: args as Record<string, unknown>,
                callId: 'subagent',
              });

              const batchResults: string[] = [];
              let totalElapsed = 0;

              // Spawn each chunk as a sub-agent and wait for all
              const pending = chunks.map((chunk) =>
                runSubAgent(
                  `Process these items:\n${chunk.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\nReturn a summary of processing results for each item.`,
                  toolsList,
                  timeout,
                  false,
                ),
              );

              const resolved = await Promise.all(pending);
              for (const r of resolved) {
                totalElapsed += r.elapsed;
                batchResults.push(r.success ? r.output : `[FAILED] ${r.output}`);
              }

              const output = [
                `=== BATCH RESULT ===`,
                `${items.length} items processed across ${chunks.length} sub-agents`,
                `Total elapsed: ${totalElapsed}ms`,
                ``,
                ...batchResults,
              ].join('\n');

              emit({
                type: 'tool_complete',
                tool: 'delegate_to_subagent',
                result: { success: true, output },
                elapsed: totalElapsed,
                args: args as Record<string, unknown>,
                callId: 'subagent',
              });
              return output;
            }

            // Single mode
            emit({ type: 'tool_executing', tool: 'delegate_to_subagent', description: `Spawning sub-agent: ${mission}`, startTime: Date.now(), args: args as Record<string, unknown>, callId: 'subagent' });
            const result2 = await runSubAgent(mission, toolsList, timeout, background);
            const output = result2.success
              ? `[Sub-agent completed in ${result2.elapsed}ms]\n${result2.output}`
              : `[Sub-agent failed: ${result2.output}]`;
            emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: result2.success, output }, elapsed: result2.elapsed, args: args as Record<string, unknown>, callId: 'subagent' });
            return output;
          });
          const [result] = await fiberSet.joinAll<string>();
          return result;
        },
      });
      continue;
    }

    tools[toolDef.id] = tool({
      description: toolDef.modelDescription,
      inputSchema: jsonSchema(schema),
      async execute(args, options) {
        const fiberSet = new FiberSet();
        fiberSet.run(toolDef.id, async () => {
          const startTime = Date.now();
          const callId = options?.toolCallId || `tc-${toolDef.id}-${startTime}`;
          activeOutputCalls.set(callId, toolDef.id);
          emit({ type: 'tool_executing', tool: toolDef.id, description: `Executing ${toolDef.name}`, startTime, args: args as Record<string, unknown>, callId });

          try {
            const result: ToolResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId);
            const elapsed = Date.now() - startTime;
            activeOutputCalls.delete(callId);
            emit({ type: 'tool_complete', tool: toolDef.id, result: { success: result.success, output: result.output }, elapsed, args: args as Record<string, unknown>, callId });

            if (!result.success) {
              if (result.error === 'PERMISSION_DENIED' || result.error === 'MODE_RESTRICTED') {
                emit({ type: 'mode_restricted', tool: toolDef.id, error: result.error, message: result.output } as any);
                return `[${result.error}] "${toolDef.id}" is blocked in your current mode. ${result.output}\n\nTell the user this tool requires Agent mode. Ask them to switch modes or press Enter to switch now. Do NOT fabricate any output.`;
              }
              return `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
            }
            return result.output;
          } catch (err) {
            activeOutputCalls.delete(callId);
            const elapsed = Date.now() - startTime;
            const errorMsg = err instanceof Error ? err.message : String(err);
            emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output: errorMsg }, elapsed, args: args as Record<string, unknown>, callId });
            return `[TOOL ERROR] ${errorMsg}`;
          }
        });
        const results = await fiberSet.joinAll<string>();
        return results[0];
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
            id: (chunk as any).toolCallId,
            type: 'function',
            function: {
              name: (chunk as any).toolName,
              arguments: JSON.stringify((chunk as any).args || (chunk as any).input || {}),
            },
          };
          yield { type: 'tool_call_delta', toolCall: tc };
          break;
        }

        case 'finish': {
          const usage = (chunk as any).usage || (chunk as any).totalUsage;
          if (usage) {
            yield {
              type: 'done',
              usage: {
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
              },
            };
          }
          break;
        }

        case 'error':
          throw new Error(String((chunk as any).error || 'AI SDK stream error'));
      }
    }
    if (chunkCount === 0) {
      getLogger().warn('AI_SDK', `streamText produced ZERO fullStream chunks. Model: ${config.provider.activeModel}, Provider: ${config.provider.activeProvider}`);
    }
    if (textChunkCount === 0 && chunkCount > 0) {
      getLogger().warn('AI_SDK', `streamText produced ${chunkCount} chunks but ZERO text-delta chunks`);
    }
  } finally {
    // no cleanup needed — AI SDK handles its own lifecycle
  }
}
