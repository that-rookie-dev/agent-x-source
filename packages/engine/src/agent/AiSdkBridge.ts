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
import type { AgentXConfig, EngineEvent, ToolResult, CompletionChunk, CompletionToolCall, ClarificationRequestMeta } from '@agentx/shared';
import { isToolAllowedInPlanMode } from './plan-mode-utils.js';

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
  waitForClarification: (question: string, options: string[], allowFreeform: boolean, meta?: ClarificationRequestMeta) => Promise<string>,
  runSubAgent: (instruction: string, tools: string[] | undefined, timeout: number, background?: boolean) => Promise<{ success: boolean; output: string; elapsed: number; agentId?: string }>,
  planMode: boolean = false,
  waitForModeEscalation?: (toolId: string, reason: string) => Promise<boolean>,
  onToolExecuted?: (toolId: string, success: boolean, output: string, elapsed: number, args?: Record<string, unknown>) => void,
): ToolSet {
  const allTools = toolRegistry.list();
  const tools: ToolSet = {};

  // ─── Plan Mode: strict allowlist — read/explore only; plans stay in chat ───
  const filteredTools = planMode
    ? allTools.filter((t) => isToolAllowedInPlanMode(t.id))
    : allTools;

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

   for (const toolDef of filteredTools) {
    const schema = convertToJsonSchema(toolDef.schema);

    if (toolDef.id === 'ask_clarification') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          const question = (args as any).question || 'I need more information.';
          const options = Array.isArray((args as any).options) ? (args as any).options : [];
          const allowFreeform = (args as any).allowFreeform !== false;
          const multiple = (args as any).multiple === true;
          const fields = Array.isArray((args as any).fields)
            ? (args as any).fields.filter((f: unknown) => f && typeof f === 'object')
            : undefined;
          const recommended = typeof (args as any).recommended === 'string' ? (args as any).recommended : undefined;
          const meta: ClarificationRequestMeta = {
            selectionMode: fields?.length ? undefined : multiple ? 'multiple' : options.length > 0 ? 'single' : undefined,
            fields,
            recommended,
          };
          const response = await waitForClarification(question, options, allowFreeform, meta);
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
          const items = Array.isArray((args as any).items) ? (args as any).items as string[] : undefined;
          const toolsList = Array.isArray((args as any).tools) ? (args as any).tools : undefined;
          const timeout = typeof (args as any).timeout === 'number' ? (args as any).timeout : 120_000;
          const background = (args as any).background === true;
          const batchSize = Math.max(1, Math.min(typeof (args as any).batchSize === 'number' ? (args as any).batchSize : 10, 50));

          if (items && items.length > 0) {
            const chunks: string[][] = [];
            for (let i = 0; i < items.length; i += batchSize) {
              chunks.push(items.slice(i, i + batchSize));
            }
            emit({
              type: 'tool_executing',
              tool: 'delegate_to_subagent',
              description: `Dispatching ${items.length} items across ${chunks.length} sub-agents`,
              startTime: Date.now(),
              args: args as Record<string, unknown>,
              callId: 'subagent',
            });
            const pending = chunks.map((chunk) =>
              runSubAgent(`Process:\n${chunk.map((item, i) => `${i + 1}. ${item}`).join('\n')}`, toolsList, timeout, false),
            );
            const resolved = await Promise.all(pending);
            let totalElapsed = 0;
            const batchResults: string[] = [];
            for (const r of resolved) {
              totalElapsed += r.elapsed;
              batchResults.push(r.success ? r.output : `[FAILED] ${r.output}`);
            }
            const output = [`=== BATCH RESULT ===`, `${items.length} items processed`, `Total elapsed: ${totalElapsed}ms`, '', ...batchResults].join('\n');
            emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: true, output }, elapsed: totalElapsed, args: args as Record<string, unknown>, callId: 'subagent' });
            return output;
          }

          emit({ type: 'tool_executing', tool: 'delegate_to_subagent', description: `Spawning sub-agent: ${mission}`, startTime: Date.now(), args: args as Record<string, unknown>, callId: 'subagent' });
          const result2 = await runSubAgent(mission, toolsList, timeout, background);
          const callId = result2.agentId ?? 'subagent';
          const output = result2.success
            ? `[Sub-agent completed in ${result2.elapsed}ms]\n${result2.output}`
            : `[Sub-agent failed: ${result2.output}]`;
          emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: result2.success, output }, elapsed: result2.elapsed, args: args as Record<string, unknown>, callId });
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
           activeOutputCalls.set(callId, toolDef.id);
           const argsStr = JSON.stringify(args).slice(0, 100);
           emit({ 
             type: 'tool_executing', 
             tool: toolDef.id, 
             description: `Executing ${toolDef.name} with args: ${argsStr}`,
             startTime, 
             args: args as Record<string, unknown>, 
             callId,
             message: `⏳ Running ${toolDef.name}...`
           });

           try {
             const result: ToolResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId);
             const elapsed = Date.now() - startTime;
             activeOutputCalls.delete(callId);
             onToolExecuted?.(toolDef.id, result.success, result.output, elapsed, args as Record<string, unknown>);
             const resultPreview = result.output.slice(0, 100) + (result.output.length > 100 ? '...' : '');
             emit({ 
               type: 'tool_complete', 
               tool: toolDef.id, 
               result: { success: result.success, output: result.output }, 
               elapsed, 
               args: args as Record<string, unknown>, 
               callId,
               message: result.success ? `✅ ${toolDef.name} completed in ${elapsed}ms` : `❌ ${toolDef.name} failed`
             });

               if (!result.success) {
                 if (result.error === 'PERMISSION_DENIED' || result.error === 'MODE_RESTRICTED') {
                   emit({ type: 'mode_restricted', tool: toolDef.id, error: result.error, message: result.output });

                   if (result.error === 'MODE_RESTRICTED' && waitForModeEscalation) {
                     emit({
                       type: 'mode_escalation_required',
                       tool: toolDef.id,
                       reason: result.output,
                       pendingAction: `${toolDef.id}(${argsStr})`,
                     });
                     const accepted = await waitForModeEscalation(toolDef.id, result.output);
                     if (accepted) {
                       emit({ type: 'mode_escalation_accepted', tool: toolDef.id });
                       const retryResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId);
                       const retryElapsed = Date.now() - startTime;
                       onToolExecuted?.(toolDef.id, retryResult.success, retryResult.output, retryElapsed, args as Record<string, unknown>);
                       emit({
                         type: 'tool_complete',
                         tool: toolDef.id,
                         result: { success: retryResult.success, output: retryResult.output },
                         elapsed: retryElapsed,
                         args: args as Record<string, unknown>,
                         callId,
                         message: retryResult.success ? `✅ ${toolDef.name} completed after mode switch` : `❌ ${toolDef.name} still failed`,
                       });
                       if (retryResult.success) return retryResult.output;
                       return `[TOOL ERROR: ${retryResult.error || 'Unknown'}] ${retryResult.output}`;
                     }
                     emit({ type: 'mode_escalation_declined', tool: toolDef.id });
                     throw new Error('MODE_ESCALATION_DECLINED');
                   }

                   const modeNeeded = result.error === 'MODE_RESTRICTED' ? 'Agent Mode' : 'higher permissions';
                   const instructions = `🚨 CRITICAL RESTRICTION 🚨

The "${toolDef.id}" tool FAILED with error: MODE_RESTRICTED

The user is in Plan Mode (read-only). The "${toolDef.id}" tool requires ${modeNeeded} and CANNOT be executed right now.

YOUR RESPONSE MUST:
1. ❌ NEVER claim you created/edited/deleted/executed anything. The action FAILED.
2. ❌ NEVER show fake code or fake output. It didn't actually run.
3. ✅ TELL the user the action failed and why: you're in Plan Mode and need ${modeNeeded}
4. ✅ EXPLAIN which specific action you tried to perform and why it failed
5. ✅ SUGGEST the user click the Agent Mode button in the UI to switch modes
6. ✅ TELL them what you'll do once they switch modes

This is NOT a suggestion - it's an instruction. If you claim the tool succeeded when it failed, you're deceiving the user.

ERROR MESSAGE FROM SYSTEM: ${result.output}`;
                   return instructions;
                 }
                 return `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
               }
             return result.output;
           } catch (err) {
             activeOutputCalls.delete(callId);
             const elapsed = Date.now() - startTime;
             const errorMsg = err instanceof Error ? err.message : String(err);
             emit({ 
               type: 'tool_complete', 
               tool: toolDef.id, 
               result: { success: false, output: errorMsg }, 
               elapsed, 
               args: args as Record<string, unknown>, 
               callId,
               message: `❌ ${toolDef.name} errored: ${errorMsg}`
             });
             return `[TOOL ERROR] ${errorMsg}`;
           }
         },
    });
  }

  // Log tool count for debugging
  const toolCount = Object.keys(tools).length;
  getLogger().info('AI_SDK_TOOLS', `Created ${toolCount} AI SDK tools from ${allTools.length} registered tools`);

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
      ...(tools ? { tools, stopWhen: stepCountIs(100), toolChoice: 'auto' as const } : {}),
      temperature: 0,
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
