import { tool, jsonSchema, streamText, stepCountIs, type ToolSet, type LanguageModel } from 'ai';
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { withSpan } from '../observability/tracer.js';
import { normalizeAiSdkMessagesForProvider } from './context-profile.js';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import { getLogger, ollamaOpenAiBaseUrl, resolveMaxOutputTokens } from '@agentx/shared';
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
import { looksLikeFailedPdfExtract } from '../documents/text-quality.js';

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

const VISION_MODEL_RE = /gpt-4o|gpt-4-turbo|claude-3|claude-4|gemini|llava|vision|pixtral|gpt-5|o4-mini/;

/**
 * Standalone vision-capability check (mirrors Agent.modelSupportsVision without
 * the runtime cachedModelInfo map). Used by background paths like the Document
 * Studio analyzer that don't have an Agent instance handy.
 */
export function modelSupportsVision(config: AgentXConfig): boolean {
  const modelId = config.provider.activeModel ?? '';
  const combined = `${config.provider.activeProvider} ${modelId}`.toLowerCase();
  return VISION_MODEL_RE.test(combined);
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
      const resolvedUrl = activeProvider === 'ollama'
        ? ollamaOpenAiBaseUrl(baseURL)
        : (baseURL || DEFAULT_BASE_URLS[activeProvider] || 'https://api.openai.com/v1');
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
    case 'custom': {
      // Wire protocol is chosen per-profile via ProviderProfile.apiType.
      const apiType = (providerCfg?.profiles?.[providerCfg.activeProfile ?? '']?.apiType
        ?? providerCfg?.profiles?.[Object.keys(providerCfg?.profiles ?? {})[0] ?? '']?.apiType
        ?? 'openai-compatible') as string;
      if (apiType === 'anthropic') {
        const anthropic = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
        return anthropic(modelId);
      }
      if (apiType === 'google') {
        const google = createGoogleGenerativeAI({ apiKey, baseURL: baseURL });
        return google(modelId);
      }
      const compat = createOpenAICompatible({
        name: 'custom',
        apiKey,
        baseURL: baseURL || 'https://api.openai.com/v1',
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
  onToolExecuted?: (toolId: string, success: boolean, output: string, elapsed: number, args?: Record<string, unknown>, metadata?: Record<string, unknown>) => void,
  parentSpan?: Span,
  filteredToolIds?: string[],
  preToolCallCheck?: (toolId: string, args: Record<string, unknown>) => string | null,
): ToolSet {
  const allTools = toolRegistry.list();
  const tools: ToolSet = {};
  const toolCtx = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;
  const bindCtx = <F extends (...args: any[]) => any>(fn: F): F => (toolCtx ? context.bind(toolCtx, fn) : fn) as F;
  // An empty array means "no tools allowed" (deliberate restriction); undefined means
  // "all tools allowed". Treat both correctly.
  let filteredTools = filteredToolIds !== undefined
    ? allTools.filter((t) => filteredToolIds.includes(t.id))
    : allTools;

  // Even when the policy restricts tools, always include ask_clarification so the model
  // can surface structured questionnaires, and bridge tools so the model can discover
  // more tools via tool_search when progressive disclosure is active.
  if (filteredToolIds !== undefined && filteredToolIds.length > 0) {
    const clarifyTool = allTools.find((t) => t.id === 'ask_clarification');
    if (clarifyTool && !filteredTools.some((t) => t.id === 'ask_clarification')) {
      filteredTools.push(clarifyTool);
    }
  }

  if (filteredTools.length > 0 && (toolExecutor.shouldDisclose?.(filteredTools.length) ?? shouldDisclose(filteredTools.length))) {
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

  // Lightweight deterministic guard to stop looped/dead-end tool calls
  const recentCalls: Array<{ id: string; key: string; argsSummary: string; outputSummary: string; timestamp: number; success: boolean }> = [];
  const MAX_RECENT_CALLS = 24;

  function toolCallKey(toolId: string, args: Record<string, unknown>): string {
    if (toolId === 'knowledge_base_search' && typeof args['query'] === 'string') return `kb:${String(args['query'])}`;
    if ((toolId === 'deep_web_search' || toolId === 'web_search') && typeof args['query'] === 'string') {
      return `web:${String(args['query'])}`;
    }
    if (toolId === 'web_fetch' && typeof args['url'] === 'string') return `fetch:${String(args['url'])}`;
    if (toolId === 'python_rpc' && typeof args['script'] === 'string') return `py:${String(args['script']).slice(0, 200)}`;
    if (toolId === 'shell_exec' && typeof args['command'] === 'string') return `sh:${String(args['command']).slice(0, 200)}`;
    if (toolId === 'bash' && typeof args['command'] === 'string') return `sh:${String(args['command']).slice(0, 200)}`;
    if (toolId === 'run_command' && (typeof args['command'] === 'string' || typeof args['cmd'] === 'string')) return `sh:${String(args['command'] ?? args['cmd']).slice(0, 200)}`;
    if (toolId === 'execute' && typeof args['command'] === 'string') return `sh:${String(args['command']).slice(0, 200)}`;
    if (toolId === 'tool_search' && typeof args['query'] === 'string') return `search:${String(args['query']).toLowerCase().trim()}`;
    if (toolId === 'tool_describe' && typeof args['tool'] === 'string') return `describe:${String(args['tool'])}`;
    if (toolId === 'tool_call') {
      const inner = typeof args['tool'] === 'string' ? args['tool'] : 'unknown';
      const innerArgs = args['arguments'] ?? args['args'] ?? {};
      return `call:${inner}:${JSON.stringify(innerArgs).slice(0, 180)}`;
    }
    if ((toolId === 'pdf_read' || toolId === 'file_read' || toolId === 'image_ocr') && typeof args['path'] === 'string') {
      return `${toolId}:${String(args['path'])}`;
    }
    return `${toolId}:${JSON.stringify(args).slice(0, 200)}`;
  }

  function looksLikeJsRenderedHtml(output: string): boolean {
    const o = output.toLowerCase();
    return o.includes('<!doctype html>') || o.includes('<html') || o.includes('</html>');
  }

  const CONSECUTIVE_FAILURE_THRESHOLD = 5;
  const NON_PROGRESS_THRESHOLD = 4;
  let consecutiveFailures = 0;
  let consecutiveNonProgress = 0;

  function guardTool(toolId: string, args: Record<string, unknown>): { error: string; message: string } | null {
    const now = Date.now();
    // prune old entries (older than 5 minutes)
    while (recentCalls.length > 0 && now - recentCalls[0]!.timestamp > 300_000) {
      recentCalls.shift();
    }

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      return { error: 'CIRCUIT_BREAKER', message: `${consecutiveFailures} consecutive tool calls have failed in this turn. Stop invoking more tools, summarize what you know for the user, and deliver the best answer possible — or ask one clear question if blocked.` };
    }

    if (consecutiveNonProgress >= NON_PROGRESS_THRESHOLD) {
      return {
        error: 'STALL_BREAKER',
        message: `${consecutiveNonProgress} consecutive tool calls produced no progress (repeated/garbage/empty results). Stop tool thrashing. Use the document content already in context (or tell the user what is blocked) and deliver the deliverable.`,
      };
    }

    const key = toolCallKey(toolId, args);
    const previous = recentCalls.filter((c) => c.id === toolId && c.key === key);

    if (toolId === 'web_fetch' && previous.length > 0) {
      return { error: 'REPEAT_FETCH', message: `You already fetched this URL in this turn. Re-fetching the same URL is not allowed. Use the result you have, try a different source, or ask the user.` };
    }

    if ((toolId === 'knowledge_base_search' || toolId === 'deep_web_search' || toolId === 'web_search') && previous.length > 0) {
      return { error: 'REPEAT_SEARCH', message: `You already ran this exact ${toolId} query in this turn. Repeating the same search is not allowed. Use the results already returned, [SESSION RESEARCH] from prior turns, or ask the user.` };
    }

    // Meta-discovery thrash: tool_search/tool_describe must not dominate the turn.
    if (toolId === 'tool_search') {
      const searches = recentCalls.filter((c) => c.id === 'tool_search');
      if (previous.length >= 1) {
        return { error: 'REPEAT_META', message: `You already searched for that tool query. Use tool_call/pdf_read/image_ocr on the known tool — do not keep searching.` };
      }
      if (searches.length >= 3) {
        return { error: 'META_BUDGET', message: `tool_search budget exhausted this turn (${searches.length} searches). Stop discovering tools and execute the task with tools you already know (pdf_read, image_ocr, file_read).` };
      }
    }
    if (toolId === 'tool_describe' && previous.length >= 1) {
      return { error: 'REPEAT_META', message: `You already described that tool. Call it now with tool_call or the dedicated tool id.` };
    }

    // General identical replay: same tool + same args more than once is almost always a loop.
    if (previous.length >= 1 && !['todo_write', 'ask_clarification'].includes(toolId)) {
      return {
        error: 'REPEAT_TOOL',
        message: `You already ran ${toolId} with the same arguments this turn. Do not repeat it. Use the prior result, switch strategy once, or answer the user with what you have.`,
      };
    }

    // Path-level PDF thrash across file_read/pdf_read/tool_call wrappers.
    if (toolId === 'pdf_read' || toolId === 'file_read' || toolId === 'tool_call' || toolId === 'image_ocr') {
      const path = typeof args['path'] === 'string'
        ? args['path']
        : (typeof (args['arguments'] as { path?: string } | undefined)?.path === 'string'
          ? (args['arguments'] as { path: string }).path
          : null);
      if (path) {
        const samePath = recentCalls.filter((c) =>
          (c.id === 'pdf_read' || c.id === 'file_read' || c.id === 'tool_call' || c.id === 'image_ocr')
          && c.argsSummary.includes(path),
        );
        if (samePath.length >= 2) {
          return {
            error: 'REPEAT_DOC_READ',
            message: `You already attempted to read "${path}" multiple times. Stop re-reading it. If OCR text is already in the user message, analyse it and produce the deliverable. If not, tell the user extraction failed — do not loop.`,
          };
        }
      }
    }

    return null;
  }

  function recordCall(toolId: string, args: Record<string, unknown>, output: string, success: boolean): void {
    const key = toolCallKey(toolId, args);
    recentCalls.push({
      id: toolId,
      key,
      argsSummary: JSON.stringify(args).slice(0, 200),
      outputSummary: output.slice(0, 200),
      timestamp: Date.now(),
      success,
    });
    if (recentCalls.length > MAX_RECENT_CALLS) recentCalls.shift();

    // Treat "success" with garbage PDF extract / empty discovery as non-progress failures.
    let effectiveSuccess = success;
    let progressed = success;
    if (success && (toolId === 'pdf_read' || toolId === 'file_read' || toolId === 'tool_call') && looksLikeFailedPdfExtract(output)) {
      effectiveSuccess = false;
      progressed = false;
    }
    if (success && (toolId === 'tool_search' || toolId === 'tool_describe' || toolId === 'file_find' || toolId === 'folder_list' || toolId === 'folder_tree')) {
      progressed = false; // discovery alone is not task progress
    }
    if (success && /PERMISSION DENIED|PERMISSION_INSTRUCTED|\[Security\] Blocked|No files matched|No knowledge-base matches/i.test(output)) {
      effectiveSuccess = false;
      progressed = false;
    }

    if (effectiveSuccess) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
    }
    if (progressed) {
      consecutiveNonProgress = 0;
    } else {
      consecutiveNonProgress += 1;
    }
  }

  function reflectOutput(toolId: string, output: string): string {
    // Add a concise reflection note when a result suggests the agent is drifting
    const lower = output.toLowerCase();
    if (toolId === 'web_fetch' && looksLikeJsRenderedHtml(output)) {
      return `[REFLECTION: this page is JS-rendered or HTML-only with no extracted text. Do not fetch more pages from the same site. If the data you need is not in structured form, ask the user or use a different source.]\n${output}`;
    }
    if ((toolId === 'knowledge_base_search' || toolId === 'deep_web_search') && output.startsWith('Knowledge base search failed')) {
      return `[REFLECTION: search failed. Do not run the same query again. Fix the arguments (e.g., sourceId must be a UUID, not a filename) or ask the user.]\n${output}`;
    }
    if (toolId === 'deep_web_search' && lower.includes('found 0 ') || output.toLowerCase().includes('no results')) {
      return `[REFLECTION: web search returned no useful results. Do not repeat with the same query. Use what you know, try a different query, or ask the user.]\n${output}`;
    }
    if ((toolId === 'pdf_read' || toolId === 'file_read' || toolId === 'tool_call') && /PDF_UNREADABLE|no usable extractable text|ÿÿÿ/i.test(output)) {
      return `[REFLECTION: PDF extraction failed or returned garbage. Do NOT retry the same read. If OCR text is already in the user message, analyse it now. Otherwise ask the user one clear question.]\n${output}`;
    }
    if (toolId === 'tool_search') {
      return `[REFLECTION: prefer calling pdf_read/image_ocr/file_read directly for attached documents. Avoid further tool_search.]\n${output}`;
    }
    return output;
  }

  async function promptForLogin(toolId: string, result: ToolResult): Promise<string | null> {
    if (result.success || result.error !== 'LOGIN_REQUIRED') return null;
    const metadata = (result.metadata ?? {}) as { url?: string; title?: string };
    const site = metadata.title || metadata.url || toolId;
    const q: QuestionnairePayload = {
      id: 'browser-login-continue',
      title: 'Login required',
      questions: [{
        id: 'continue',
        prompt: result.output || `Please log in to ${site} and then click Continue, or say "continue".`,
        type: 'single_choice',
        options: [{ value: 'continue', label: 'Continue' }],
      }],
    };
    const response = await waitForClarification(q);
    return `User response: ${response}`;
  }

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
    const timeout = typeof args.timeout === 'number' ? args.timeout : 600_000;
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
            const bridgeGuard = guardTool(targetId, resolved.resolvedArgs);
            if (bridgeGuard) {
              const output = `[TOOL GUARD: ${bridgeGuard.error}] ${bridgeGuard.message}`;
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return output;
            }
            const bridgeCodingGuard = preToolCallCheck?.(targetId, resolved.resolvedArgs) ?? null;
            if (bridgeCodingGuard) {
              const output = `[TOOL GUARD: CODING_TURN_GUARD] ${bridgeCodingGuard}`;
              emit({ type: 'tool_complete', tool: toolDef.id, result: { success: false, output }, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
              return output;
            }
            const result = await toolExecutor.execute(targetId, resolved.resolvedArgs, sessionId, { signal: options?.abortSignal });
            const reflectedOutput = reflectOutput(targetId, result.output);
            result.output = reflectedOutput;
            recordCall(targetId, resolved.resolvedArgs, reflectedOutput, result.success);
            onToolExecuted?.(targetId, result.success, reflectedOutput, Date.now() - startTime, resolved.resolvedArgs, result.metadata);
            emit({ type: 'tool_complete', tool: toolDef.id, result, elapsed: Date.now() - startTime, args: args as Record<string, unknown>, callId });
            const loginResponse = await promptForLogin(targetId, result);
            if (loginResponse) return loginResponse;
            return result.success ? reflectedOutput : `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
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
        execute: bindCtx(async (args, options) => {
           return withSpan(`tool_decision.${toolDef.id}`, 'tool_decision', async (decisionSpan) => {
             decisionSpan.setAttribute('trace.domain', 'AGENT');
             decisionSpan.setAttribute('openinference.span.kind', 'tool');
             decisionSpan.setAttribute('decision', true);
             decisionSpan.setAttribute('tool.id', toolDef.id);
             decisionSpan.setAttribute('tool.name', toolDef.name);
             decisionSpan.setAttribute('tool.args', JSON.stringify(args).slice(0, 2000));
             if (toolExecutor.isTurnAborted()) {
             const err = new Error('Turn aborted');
             err.name = 'AbortError';
             throw err;
           }
           const startTime = Date.now();
           const callId = options?.toolCallId || `tc-${toolDef.id}-${startTime}`;
           activeOutputCalls.set(callId, toolDef.id);
           const argsStr = JSON.stringify(args).slice(0, 100);

           const guard = guardTool(toolDef.id, args as Record<string, unknown>);
           if (guard) {
             activeOutputCalls.delete(callId);
             const elapsed = Date.now() - startTime;
             const output = `[TOOL GUARD: ${guard.error}] ${guard.message}`;
             emit({
               type: 'tool_complete',
               tool: toolDef.id,
               result: { success: false, output },
               elapsed,
               args: args as Record<string, unknown>,
               callId,
               message: `🚫 ${toolDef.name} blocked by guard`,
             });
             decisionSpan.setAttribute('tool.success', false);
            decisionSpan.setAttribute('tool.elapsed', elapsed);
            decisionSpan.setAttribute('tool.guard', guard.error ?? 'blocked');
            decisionSpan.setStatus({ code: SpanStatusCode.ERROR, message: guard.error ?? 'tool guard blocked' });
            return output;
           }

           // CodingTurnGuard pre-execution check (read-before-write, safety gate)
           const codingGuard = preToolCallCheck?.(toolDef.id, args as Record<string, unknown>) ?? null;
           if (codingGuard) {
             activeOutputCalls.delete(callId);
             const elapsed = Date.now() - startTime;
             const output = `[TOOL GUARD: CODING_TURN_GUARD] ${codingGuard}`;
             emit({
               type: 'tool_complete',
               tool: toolDef.id,
               result: { success: false, output },
               elapsed,
               args: args as Record<string, unknown>,
               callId,
               message: `🚫 ${toolDef.name} blocked by coding turn guard`,
             });
             decisionSpan.setAttribute('tool.success', false);
             decisionSpan.setAttribute('tool.elapsed', elapsed);
             decisionSpan.setAttribute('tool.guard', 'CODING_TURN_GUARD');
             decisionSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'coding turn guard blocked' });
             return output;
           }

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
             return await withSpan(`tool.${toolDef.id}`, 'tool', async (span) => {
               span.setAttribute('trace.domain', 'AGENT');
               span.setAttribute('openinference.span.kind', 'tool');
               span.setAttribute('tool.name', toolDef.id);
               span.setAttribute('tool.args', JSON.stringify(args).slice(0, 2000));
               span.setAttribute('session.id', sessionId);
               const result: ToolResult = await toolExecutor.execute(toolDef.id, args as Record<string, unknown>, sessionId, { signal: options?.abortSignal });
               const elapsed = Date.now() - startTime;
               activeOutputCalls.delete(callId);
               const reflectedOutput = reflectOutput(toolDef.id, result.output);
               result.output = reflectedOutput;
               recordCall(toolDef.id, args as Record<string, unknown>, reflectedOutput, result.success);
               onToolExecuted?.(toolDef.id, result.success, reflectedOutput, elapsed, args as Record<string, unknown>, result.metadata);
               emit({
                 type: 'tool_complete',
                 tool: toolDef.id,
                 result,
                 elapsed,
                 args: args as Record<string, unknown>,
                 callId,
                 message: result.success ? `✅ ${toolDef.name} completed in ${elapsed}ms` : `❌ ${toolDef.name} failed`,
               });
               span.setAttribute('tool.success', result.success);
               span.setAttribute('tool.output', reflectedOutput.slice(0, 2000));
               span.setAttribute('tool.elapsed', elapsed);
               if (!result.success) {
                 span.setStatus({ code: SpanStatusCode.ERROR, message: result.error ?? 'tool failed' });
                 const loginResponse = await promptForLogin(toolDef.id, result);
                 if (loginResponse) return loginResponse;
                 return `[TOOL ERROR: ${result.error || 'Unknown'}] ${result.output}`;
               }
               return reflectedOutput;
             });
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
             recordCall(toolDef.id, args as Record<string, unknown>, errorMsg, false);
             return `[TOOL ERROR] ${errorMsg}`;
           }
         });
         }),
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
      maxRetries: 2,
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
