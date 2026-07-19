import { tool, jsonSchema, streamText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { normalizeAiSdkMessagesForProvider } from './context-profile.js';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { getLogger, resolveMaxOutputTokens } from '@agentx/shared';
import { createGroq } from '@ai-sdk/groq';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createXai } from '@ai-sdk/xai';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { AgentXConfig, EngineEvent, ToolResult, CompletionChunk, CompletionToolCall, QuestionnairePayload, ToolDefinition } from '@agentx/shared';
import { normalizeAskClarificationArgs, shouldUseQuestionnaireClarification, TEXT_CLARIFICATION_REJECTED_MESSAGE } from '@agentx/shared';
import {
  shouldDisclose,
  getCoreTools,
  createBridgeTools,
  resolveBridgeToolCall,
} from '../tools/ProgressiveDisclosure.js';
import {
  resolveCommandCodeAnthropicBaseUrl,
  resolveCommandCodeModelProtocol,
  resolveCommandCodeOpenAiBaseUrl,
} from '@agentx/shared';
import { resolveGoogleNativeBaseUrl } from '../providers/google/gemini-metadata.js';

/** Defaults for OpenAI-compatible chat paths only. Native SDK providers use their package defaults. */
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
};

/** Ignore stale OpenAI-compat URLs saved before native Cohere restore. */
function resolveCohereNativeBaseUrl(configured?: string): string | undefined {
  if (!configured) return undefined;
  if (configured.includes('/compatibility/')) return undefined;
  return configured;
}

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
      const google = createGoogleGenerativeAI({
        apiKey,
        baseURL: resolveGoogleNativeBaseUrl(baseURL),
      });
      return google(modelId);
    }
    case 'azure': {
      const azure = createAzure({ apiKey, baseURL: baseURL || '', ...(providerCfg?.azureResourceName ? { resourceName: providerCfg.azureResourceName } : {}) });
      return azure(modelId);
    }
    case 'groq': {
      const groq = createGroq({ apiKey, ...(baseURL ? { baseURL } : {}) });
      return groq(modelId);
    }
    case 'cohere': {
      // Native Cohere Chat API (default https://api.cohere.com/v2). Never use /compatibility/v1 here.
      const nativeBase = resolveCohereNativeBaseUrl(baseURL);
      const cohere = createCohere({
        apiKey,
        ...(nativeBase ? { baseURL: nativeBase } : {}),
      });
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
    // OpenAI-compatible vendors & gateways (documented base URLs — never native vendor SDKs)
    case 'opencode':
    case 'opencode-zen':
    case 'ollama':
    case 'lmstudio':
    case 'deepseek':
    case 'together':
    case 'moonshot':
    case 'fireworks': {
      const resolvedUrl = baseURL || DEFAULT_BASE_URLS[activeProvider] || 'https://api.openai.com/v1';
      const compat = createOpenAICompatible({
        name: activeProvider,
        apiKey,
        baseURL: resolvedUrl,
      });
      return compat(modelId);
    }
    case 'commandcode': {
      const protocol = resolveCommandCodeModelProtocol(modelId);
      if (protocol === 'anthropic-messages') {
        const anthropic = createAnthropic({
          apiKey,
          baseURL: resolveCommandCodeAnthropicBaseUrl(baseURL),
        });
        return anthropic(modelId);
      }
      const compat = createOpenAICompatible({
        name: 'commandcode',
        apiKey,
        baseURL: resolveCommandCodeOpenAiBaseUrl(baseURL),
      });
      return compat(modelId);
    }
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

type SchemaRecord = Record<string, unknown>;

const ARRAY_OBJECT_ITEM_PROPERTIES: Record<string, SchemaRecord> = {
  slides: { title: { type: 'string' }, content: { type: 'string' } },
  sections: { heading: { type: 'string' }, content: { type: 'string' }, code: { type: 'string' } },
  datasets: {
    label: { type: 'string' },
    data: { type: 'array', items: { type: 'number' } },
    color: { type: 'string' },
  },
  todos: { id: { type: 'number' }, content: { type: 'string' }, status: { type: 'string' } },
  edits: { search: { type: 'string' }, replace: { type: 'string' } },
};

function inferArrayItems(schema: SchemaRecord, propName?: string): SchemaRecord {
  const desc = String(schema.description ?? '').toLowerCase();
  const name = (propName ?? '').toLowerCase();

  if (name === 'rows' || desc.includes('row array')) {
    return { type: 'array', items: { type: 'string' } };
  }

  if (name in ARRAY_OBJECT_ITEM_PROPERTIES) {
    return { type: 'object', properties: ARRAY_OBJECT_ITEM_PROPERTIES[name] };
  }

  if (desc.includes('{') || desc.includes('object')) {
    return { type: 'object', properties: {} };
  }

  return { type: 'string' };
}

/** Recursively ensure array schemas include items — required by Gemini function declarations. */
export function normalizeJsonSchemaNode(node: unknown, propName?: string): SchemaRecord {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return { type: 'string' };
  }

  const source = node as SchemaRecord;
  const out: SchemaRecord = { ...source };

  if (Array.isArray(out.type)) {
    const primary = out.type.find((t) => t !== 'null');
    out.type = primary ?? 'string';
  }

  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const normalized: SchemaRecord = {};
    for (const [key, value] of Object.entries(out.properties as SchemaRecord)) {
      normalized[key] = normalizeJsonSchemaNode(value, key);
    }
    out.properties = normalized;
  }

  if (out.type === 'array' && !out.items) {
    out.items = inferArrayItems(out, propName);
  }

  if (out.items) {
    out.items = normalizeJsonSchemaNode(out.items, propName);
  }

  for (const combiner of ['oneOf', 'anyOf', 'allOf'] as const) {
    const combinerVal = out[combiner];
    if (Array.isArray(combinerVal)) {
      out[combiner] = combinerVal.map((entry, index) =>
        normalizeJsonSchemaNode(entry, propName ? `${propName}_${combiner}_${index}` : undefined),
      );
    }
  }

  return out;
}

export function convertToJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === 'object' && schema !== null) {
    const normalized = normalizeJsonSchemaNode(schema);
    return {
      type: normalized.type || 'object',
      properties: normalized.properties || {},
      required: Array.isArray(normalized.required) ? normalized.required : [],
      additionalProperties: false,
    };
  }
  return { type: 'object', properties: {}, required: [], additionalProperties: false };
}

export interface AiSdkToolExecutor {
  execute: (toolId: string, args: Record<string, unknown>, sessionId: string, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
  setToolOutputHandler?: (handler: (output: string) => void) => void;
  isTurnAborted: () => boolean;
  shouldDisclose?: (toolCount: number) => boolean;
  getCoreTools?: (tools: ToolDefinition[]) => ToolDefinition[];
  createBridgeTools?: () => ToolDefinition[];
  resolveBridgeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    allTools: ToolDefinition[],
  ) => { resolved: ToolDefinition | null; resolvedArgs: Record<string, unknown>; error?: string };
}

export function createAiSdkTools(
  toolRegistry: ToolRegistry,
  toolExecutor: AiSdkToolExecutor,
  sessionId: string,
  emit: (event: EngineEvent) => void,
  waitForClarification: (questionnaire: QuestionnairePayload) => Promise<string>,
  runSubAgent: (instruction: string, tools: string[] | undefined, timeout: number, background?: boolean) => Promise<{ success: boolean; output: string; elapsed: number; agentId?: string }>,
  onToolExecuted?: (toolId: string, success: boolean, output: string, elapsed: number, args?: Record<string, unknown>) => void,
): ToolSet {
  const allTools = toolRegistry.list();
  const tools: ToolSet = {};
  let filteredTools = allTools;

  if (toolExecutor.shouldDisclose?.(filteredTools.length) ?? shouldDisclose(filteredTools.length)) {
    // Progressive disclosure hides the large builtin catalog behind tool_search, but
    // connected MCP integrations must stay directly callable — otherwise the model is
    // told Maps/Gmail/etc. are "not in the active toolset" and falls back to web search.
    const core = (toolExecutor.getCoreTools?.(filteredTools) ?? getCoreTools(filteredTools));
    const bridges = (toolExecutor.createBridgeTools?.() ?? createBridgeTools());
    const integrationTools = filteredTools.filter((t) => t.id.startsWith('integration__'));
    const seen = new Set<string>();
    filteredTools = [];
    for (const toolDef of [...core, ...bridges, ...integrationTools]) {
      if (seen.has(toolDef.id)) continue;
      seen.add(toolDef.id);
      filteredTools.push(toolDef);
    }
  }

  // Full catalog for tool_search / tool_describe / tool_call resolution
  const discoveryCatalog = allTools;

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

  // Helpers shared by dedicated tools and tool_call bridge (avoids toolkit stubs)
  // Guard: only one ask_clarification per turn — additional calls in the same turn
  // would overwrite the resolve/reject handlers and lose the first promise.
  let clarificationInProgress = false;
  const runAskClarification = async (args: Record<string, unknown>): Promise<string> => {
    if (clarificationInProgress) {
      return '[TOOL ERROR] Another clarification is already in progress this turn. Ask one question at a time — wait for the user to answer before asking the next.';
    }
    clarificationInProgress = true;
    try {
      const questionnaire = normalizeAskClarificationArgs(args as import('@agentx/shared').AskClarificationToolArgs);
      if (!shouldUseQuestionnaireClarification(questionnaire)) {
        return `[TOOL ERROR] ${TEXT_CLARIFICATION_REJECTED_MESSAGE}`;
      }
      const response = await waitForClarification(questionnaire);
      return `User response: ${response}`;
    } finally {
      clarificationInProgress = false;
    }
  };

  const runDelegateToSubagent = async (args: Record<string, unknown>): Promise<string> => {
    const mission = typeof args.mission === 'string' ? args.mission : '';
    const items = Array.isArray(args.items) ? args.items as string[] : undefined;
    const toolsList = Array.isArray(args.tools) ? args.tools as string[] : undefined;
    const timeout = typeof args.timeout === 'number' ? args.timeout : 120_000;
    const background = args.background === true;
    const batchSize = Math.max(1, Math.min(typeof args.batchSize === 'number' ? args.batchSize : 10, 50));

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
  };

  const BRIDGE_META_IDS = new Set(['tool_search', 'tool_describe', 'tool_call']);

   for (const toolDef of filteredTools) {
    const schema = convertToJsonSchema(toolDef.schema);

    if (toolDef.id === 'ask_clarification') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          return runAskClarification(args as Record<string, unknown>);
        },
      });
      continue;
    }

    if (toolDef.id === 'tool_search' || toolDef.id === 'tool_describe' || toolDef.id === 'tool_call') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args, options) {
          const startTime = Date.now();
          const callId = `tc-${toolDef.id}-${startTime}`;
          emit({
            type: 'tool_executing',
            tool: toolDef.id,
            description: `Bridge: ${toolDef.id}`,
            startTime,
            args: args as Record<string, unknown>,
            callId,
          });

          const resolved = (toolExecutor.resolveBridgeToolCall?.(toolDef.id, args as Record<string, unknown>, discoveryCatalog) ??
            resolveBridgeToolCall(toolDef.id, args as Record<string, unknown>, discoveryCatalog));

          if (resolved.error) {
            emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output: resolved.error }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
            return `[TOOL ERROR] ${resolved.error}`;
          }

          if (toolDef.id === 'tool_call') {
            if (!resolved.resolved) {
              const output = resolved.error ?? 'Tool not found';
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return `[TOOL ERROR] ${output}`;
            }
            const targetId = resolved.resolved.id;
            if (BRIDGE_META_IDS.has(targetId)) {
              const output = `Cannot tool_call meta-tool "${targetId}". Call it directly.`;
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return `[TOOL ERROR] ${output}`;
            }
            // Route special tools through real handlers — toolkit stubs are placeholders only
            if (targetId === 'ask_clarification') {
              const output = await runAskClarification(resolved.resolvedArgs);
              onToolExecuted?.(targetId, true, output, Date.now() - startTime, resolved.resolvedArgs);
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: true, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return output;
            }
            if (targetId === 'delegate_to_subagent') {
              const output = await runDelegateToSubagent(resolved.resolvedArgs);
              onToolExecuted?.(targetId, true, output, Date.now() - startTime, resolved.resolvedArgs);
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: true, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return output;
            }
            const result = await toolExecutor.execute(targetId, resolved.resolvedArgs, sessionId, { signal: options?.abortSignal });
            onToolExecuted?.(targetId, result.success, result.output, Date.now() - startTime, resolved.resolvedArgs);
            emit({ type: 'tool_complete', tool: toolDef.id, result, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
            return result.success ? result.output : `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
          }

          if (resolved.error) {
            emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output: resolved.error }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
            return `[TOOL ERROR] ${resolved.error}`;
          }

          const output = JSON.stringify(resolved.resolvedArgs, null, 2);
          emit({ type: 'tool_complete', tool: toolDef.id, result: { success: true, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
          return output;
        },
      });
      continue;
    }

    if (toolDef.id === 'delegate_to_subagent') {
      tools[toolDef.id] = tool({
        description: toolDef.modelDescription,
        inputSchema: jsonSchema(schema),
        async execute(args) {
          return runDelegateToSubagent(args as Record<string, unknown>);
        },
      });
      continue;
    }

    tools[toolDef.id] = tool({
      description: toolDef.modelDescription,
      inputSchema: jsonSchema(schema),
        async execute(args, options) {
           if (toolExecutor.isTurnAborted()) {
             const err = new Error('Turn aborted');
             err.name = 'AbortError';
             throw err;
           }
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
             const result: ToolResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId, { signal: options?.abortSignal });
             const elapsed = Date.now() - startTime;
             activeOutputCalls.delete(callId);
             onToolExecuted?.(toolDef.id, result.success, result.output, elapsed, args as Record<string, unknown>);
              emit({ 
                type: 'tool_complete', 
                tool: toolDef.id, 
                result, 
                elapsed, 
                args: args as Record<string, unknown>, 
                callId,
                message: result.success ? `✅ ${toolDef.name} completed in ${elapsed}ms` : `❌ ${toolDef.name} failed`
              });

               if (!result.success) {
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
      messages: normalizeAiSdkMessagesForProvider(messages, config.provider.activeProvider).map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      ...(tools ? { tools, stopWhen: stepCountIs(100), toolChoice: 'auto' as const } : {}),
      temperature: 0,
      maxOutputTokens: resolveMaxOutputTokens(config.maxOutputTokens),
      abortSignal,
    });

    let chunkCount = 0;
    let textChunkCount = 0;
    for await (const chunk of result.fullStream) {
      chunkCount++;
      switch (chunk.type) {
        case 'text-delta':
          textChunkCount++;
          yield { type: 'text_delta', content: chunk.text };
          break;

        case 'tool-call': {
          const tc: CompletionToolCall = {
            id: chunk.toolCallId,
            type: 'function',
            function: {
              name: chunk.toolName,
              arguments: JSON.stringify(chunk.input || {}),
            },
          };
          yield { type: 'tool_call_delta', toolCall: tc };
          break;
        }

        case 'finish': {
          const usage = chunk.totalUsage;
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
          throw new Error(String(chunk.error || 'AI SDK stream error'));
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
