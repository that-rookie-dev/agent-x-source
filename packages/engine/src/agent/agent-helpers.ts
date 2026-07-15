/**
 * Standalone helper functions extracted from Agent.ts (REFACTOR-2, Group 1).
 * These are pure module-scope utilities with no `this` dependencies.
 */
import type { RemediationAction, EngineEvent, Message } from '@agentx/shared';
import { resolveSpaceError, ContextBudgetExceededError, getLogger, generateMessageId, getTokenThresholds, isTokenOverflow, estimateTokens, estimateMessagesTokens, resolveClientTimezone } from '@agentx/shared';
import type { TaskType } from '../session/ModelRouter.js';
import { buildProviderConnectivityProbeUrl } from '../providers/google/gemini-metadata.js';
import { estimateOutputTokens } from '../session/tokenCount.js';
import { COMPACTION_PROMPT, COMPACTION_UPDATE_PROMPT } from './compaction-prompt.js';
import { globalNarrativeStore } from '../context/SessionNarrativeStore.js';
import { renderNarrativeText } from '../context/NarrativeBuilder.js';

export interface SimpleCompleteContext {
  provider: { complete(request: unknown): AsyncIterable<{ type: string; content?: string }> };
  config: { provider: { activeModel: string } };
}

/**
 * Simple non-streaming completion for internal tasks (summarization, memory extraction).
 */
export async function simpleComplete(ctx: SimpleCompleteContext, prompt: string): Promise<string> {
  let result = '';
  const stream = ctx.provider.complete({
    messages: [{ role: 'user', content: prompt }],
    model: ctx.config.provider.activeModel,
    maxTokens: 600,
    stream: true,
  });
  for await (const chunk of stream) {
    if (chunk.type === 'text_delta' && chunk.content) {
      result += chunk.content;
    }
  }
  return result;
}

export interface SessionLifecycleContext {
  contextTracker: { clear(): void };
  secretSauce: {
    identity: { recordInteraction(): void };
    recordDiary(summary: string, importance: number, highlights: string[], tags: string[]): void;
    memories: { getRecentMemories(n: number): unknown[] };
    diary: { getRecent(n: number): unknown[] };
    summarizer: {
      buildMemorySummarizationPrompt(memories: unknown[]): string | null;
      storeMemorySummary(content: string): void;
      buildDiarySummarizationPrompt(diary: unknown[]): string | null;
      storeDiarySummary(content: string): void;
    };
  };
  messages: Array<{ role: string; content: string | unknown }>;
  simpleComplete(prompt: string): Promise<string>;
}

/**
 * End the session — records diary entry and updates identity.
 */
export function endSession(ctx: SessionLifecycleContext): void {
  try {
    ctx.contextTracker.clear();
    ctx.secretSauce.identity.recordInteraction();

    const userMsgs = ctx.messages.filter((m) => m.role === 'user');
    const assistantMsgs = ctx.messages.filter((m) => m.role === 'assistant');

    if (userMsgs.length > 0) {
      const highlights = userMsgs.slice(0, 3).map((m) =>
        typeof m.content === 'string' ? m.content.slice(0, 60) : 'tool interaction'
      );
      const summary = `Session with ${userMsgs.length} user messages and ${assistantMsgs.length} responses.`;
      ctx.secretSauce.recordDiary(summary, 1, highlights, []);
    }
  } catch {
    // Silent failure — diary is non-critical
  }
}

/**
 * Run background summarization of memories and diary.
 * Non-blocking — failures are silently ignored.
 */
export async function runSummarization(ctx: SessionLifecycleContext): Promise<void> {
  try {
    const summarizer = ctx.secretSauce.summarizer;

    const recentMemories = ctx.secretSauce.memories.getRecentMemories(50);
    if (recentMemories.length > 5) {
      const memPrompt = summarizer.buildMemorySummarizationPrompt(recentMemories);
      if (memPrompt) {
        const content = await ctx.simpleComplete(memPrompt);
        if (content) summarizer.storeMemorySummary(content);
      }
    }

    const recentDiary = ctx.secretSauce.diary.getRecent(14);
    if (recentDiary.length > 3) {
      const diaryPrompt = summarizer.buildDiarySummarizationPrompt(recentDiary);
      if (diaryPrompt) {
        const content = await ctx.simpleComplete(diaryPrompt);
        if (content) summarizer.storeDiarySummary(content);
      }
    }
  } catch {
    // Non-critical — silent failure
  }
}

export interface HealthContext {
  sessionId: string;
  tokenTracker: { totalCost: number; tokensUsed: number };
  toolExecutor: unknown;
  _responseTimes: number[];
  _experienceEngine: { getAverageConfidence(): number } | null;
  subAgents: { getConcurrencyStats(): { running: number; pending: number } };
  _sessionStartTime: number;
  _llmCallCount: number;
  _toolExecCount: number;
  _errorCount: number;
  _maxSessionCost: number;
  config: { provider: { activeModel: string; activeProvider: string } };
  getContextWindow(): number;
  _compactionCount: number;
  planMode: boolean;
  _hyperdriveMode: boolean;
}

/**
 * Build a health snapshot for the agent session.
 */
export function getHealth(ctx: HealthContext): Record<string, unknown> {
  const cost = ctx.tokenTracker.totalCost;
  const cbStatus = ctx.toolExecutor instanceof Object && 'getCircuitBreakerStatus' in ctx.toolExecutor
    ? (ctx.toolExecutor as { getCircuitBreakerStatus(): Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> }).getCircuitBreakerStatus()
    : [] as Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }>;
  const avgResp = ctx._responseTimes.length ? Math.round(ctx._responseTimes.reduce((a, b) => a + b, 0) / ctx._responseTimes.length) : 0;
  const neuralAvg = ctx._experienceEngine?.getAverageConfidence() ?? 0;
  const subStats = ctx.subAgents.getConcurrencyStats();
  const toolStats = ctx.toolExecutor instanceof Object && 'getToolConcurrencyStats' in ctx.toolExecutor
    ? (ctx.toolExecutor as { getToolConcurrencyStats(): unknown }).getToolConcurrencyStats()
    : null;
  return {
    sessionId: ctx.sessionId,
    uptimeMs: Date.now() - ctx._sessionStartTime,
    llmCalls: ctx._llmCallCount,
    toolExecs: ctx._toolExecCount,
    errors: ctx._errorCount,
    avgResponseMs: avgResp,
    totalCost: cost,
    budgetLimit: ctx._maxSessionCost,
    budgetPct: ctx._maxSessionCost > 0 ? Math.round((cost / ctx._maxSessionCost) * 10000) / 100 : 0,
    circuitBreakers: cbStatus.filter((c) => c.blacklisted).length,
    model: ctx.config.provider.activeModel,
    provider: ctx.config.provider.activeProvider,
    activeSubAgents: subStats.running,
    queuedSubAgents: subStats.pending,
    toolConcurrency: toolStats,
    contextTokens: ctx.tokenTracker.tokensUsed,
    contextWindow: ctx.getContextWindow(),
    compactionCount: ctx._compactionCount,
    planMode: ctx.planMode,
    hyperdriveMode: ctx._hyperdriveMode,
    neuralConfidenceAvg: Math.round(neuralAvg * 100),
  };
}

export interface DiagnosticsContext {
  scopePath: string;
  diagnosticsSystem: { performSessionHealthCheck(scopePath: string): Promise<{ scopePath: string; fallbackReason?: string }> };
  setSessionContext(ctx: unknown): void;
  emit(event: EngineEvent): void;
  setScopePath(path: string): void;
  toolExecutor: { setScopePath(path: string): void } | null;
}

/**
 * Perform async session health check and scope path fallback.
 */
export async function initializeDiagnosticsAsync(ctx: DiagnosticsContext): Promise<void> {
  try {
    getLogger().info('DIAGNOSTICS', `Starting session health check for scope: ${ctx.scopePath}`);
    const sessionContext = await ctx.diagnosticsSystem.performSessionHealthCheck(ctx.scopePath);
    getLogger().info('DIAGNOSTICS', `Session health check completed. Scope verified: ${sessionContext.scopePath}`);
    if (sessionContext?.fallbackReason) {
      getLogger().warn('DIAGNOSTICS', `Fallback triggered: ${sessionContext.fallbackReason}`);
      ctx.emit({
        type: 'task_progress',
        status: 'processing',
        description: `Scope path fallback: ${sessionContext.fallbackReason}`,
        details: { original: ctx.scopePath, fallback: sessionContext.scopePath }
      } as EngineEvent);
      if (sessionContext.scopePath !== ctx.scopePath) {
        ctx.setScopePath(sessionContext.scopePath);
        ctx.toolExecutor?.setScopePath(sessionContext.scopePath);
        getLogger().info('DIAGNOSTICS', `Scope path updated to fallback: ${sessionContext.scopePath}`);
      }
    }
    getLogger().info('DIAGNOSTICS', `Session context initialized successfully for: ${sessionContext.scopePath}`);
    ctx.setSessionContext(sessionContext);
  } catch (error) {
    getLogger().error('DIAGNOSTICS', `Session health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ResearchContext {
  sessionId: string;
  emit(event: EngineEvent): void;
  researchEngineCapability: { research(question: string, agent: unknown): Promise<string> };
  agent: unknown;
  sessionLogger: { logErrorUser(msg: string, code: string): void } | null;
  lifecycle: { forceTransition(state: string): void };
}

/**
 * Run a research query and return a Message with the report.
 */
export async function research(
  ctx: ResearchContext,
  question: string,
): Promise<{ id: string; sessionId: string; role: 'assistant'; content: string; toolCalls: null; createdAt: string; tokenCount: number }> {
  const startTime = Date.now();
  const userMessage = {
    id: generateMessageId(),
    sessionId: ctx.sessionId,
    role: 'user' as const,
    content: `/research ${question}`,
    toolCalls: null,
    createdAt: new Date().toISOString(),
    tokenCount: 0,
  };

  ctx.emit({ type: 'message_sent', message: userMessage } as EngineEvent);
  ctx.emit({ type: 'loading_start', stage: 'research' } as EngineEvent);

  try {
    const report = await ctx.researchEngineCapability.research(question, ctx.agent);

    const assistantMessage = {
      id: generateMessageId(),
      sessionId: ctx.sessionId,
      role: 'assistant' as const,
      content: report,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: estimateOutputTokens(report),
    };

    ctx.emit({ type: 'loading_end' } as EngineEvent);
    ctx.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime } as EngineEvent);
    return assistantMessage;
  } catch (error) {
    ctx.emit({ type: 'loading_end' } as EngineEvent);
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.sessionLogger?.logErrorUser(errorMessage, 'RESEARCH_FAILED');
    const fallback = {
      id: generateMessageId(),
      sessionId: ctx.sessionId,
      role: 'assistant' as const,
      content: `Research failed: ${errorMessage}`,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };
    ctx.emit({ type: 'message_received', message: fallback, elapsed: Date.now() - startTime } as EngineEvent);
    return fallback;
  } finally {
    ctx.lifecycle.forceTransition('idle');
  }
}

export interface CompactContext {
  getContextWindow(): number;
  tokenTracker: { tokensUsed: number; tokensTotal: number; addUsage(delta: number): void };
  compactionMarkerIndices: number[];
  messages: Array<{ role: string; content: string | unknown }>;
  emit(event: EngineEvent): void;
  lastCompactionSummary: string | null;
  setLastCompactionSummary(s: string): void;
  simpleComplete(prompt: string): Promise<string>;
  setMessages(msgs: Array<{ role: string; content: string | unknown }>): void;
  setCompactionMarkerIndices(indices: number[]): void;
  _compactionCount: number;
  setCompactionCount(n: number): void;
  sessionManager: { persistSessionFields?(sessionId: string, fields: Record<string, unknown>): void } | null;
  sessionId: string;
}

/**
 * Compact the context window by summarizing older messages.
 */
export async function compactContext(ctx: CompactContext, promptEstimate?: number): Promise<boolean> {
  const contextWindow = ctx.getContextWindow();
  const thresholds = getTokenThresholds(contextWindow);
  const usedTokens = Math.max(ctx.tokenTracker.tokensUsed, promptEstimate ?? 0);
  if (!isTokenOverflow(usedTokens, thresholds)) return false;

  const lastMarkerIdx: number = ctx.compactionMarkerIndices.length > 0
    ? ctx.compactionMarkerIndices[ctx.compactionMarkerIndices.length - 1]!
    : -1;
  const recentMessages = ctx.messages.slice(lastMarkerIdx + 1)
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');
  if (!recentMessages.trim()) return false;

  ctx.emit({ type: 'compaction_start', currentTokens: usedTokens, threshold: contextWindow } as EngineEvent);

  let summary = '';
  try {
    const prompt = ctx.lastCompactionSummary
      ? COMPACTION_UPDATE_PROMPT.replace('{previousSummary}', ctx.lastCompactionSummary) + '\n\n' + recentMessages
      : COMPACTION_PROMPT + '\n\n' + recentMessages;
    summary = await ctx.simpleComplete(prompt);
  } catch {
    return false;
  }
  if (!summary.trim()) return false;

  ctx.setLastCompactionSummary(summary);

  const insertIdx = ctx.messages.length;
  const newMessages = [...ctx.messages];
  newMessages.push({ role: 'system', content: `[COMPACTION SUMMARY — ${new Date().toISOString()}]\n${summary}` });
  const newIndices = [...ctx.compactionMarkerIndices, insertIdx];

  const pruneStart = lastMarkerIdx + 1;
  const pruneEnd = insertIdx;
  if (pruneStart < pruneEnd) {
    const removeCount = pruneEnd - pruneStart;
    newMessages.splice(pruneStart, removeCount);
    const adjustedIndices = newIndices
      .filter(i => i !== insertIdx)
      .map(i => i >= pruneEnd ? i - removeCount : i)
      .concat(pruneStart);
    ctx.setCompactionMarkerIndices(adjustedIndices);
  }

  ctx.setMessages(newMessages);

  const saved = pruneEnd - pruneStart;
  if (saved > 0) {
    const compactedMessages = newMessages.slice(pruneStart, pruneStart + (pruneEnd - pruneStart) || 0);
    const prunedTokens = estimateMessagesTokens(compactedMessages as never);
    const summaryTokens = estimateTokens(summary);
    const netSavings = Math.max(0, prunedTokens - summaryTokens);
    ctx.tokenTracker.addUsage(-netSavings);
    getLogger().info('COMPACTION', `Compacted ${saved} messages (${estimateTokens(summary)} token summary, saved ~${netSavings} tokens, ${usedTokens} → ${ctx.tokenTracker.tokensUsed})`);
  }
  ctx.emit({ type: 'compaction_complete', saved, summary } as EngineEvent);
  const newCount = ctx._compactionCount + 1;
  ctx.setCompactionCount(newCount);
  try {
    ctx.sessionManager?.persistSessionFields?.(ctx.sessionId, { compactionCount: newCount });
  } catch { /* best-effort */ }
  return true;
}

export interface CrewPrivateContext {
  options: { promptProfile?: string; crewPrivateHost?: { id: string; name: string; callsign: string; color?: string; icon?: string } };
}

/**
 * Tag an assistant message with crew-private metadata if applicable.
 */
export function tagCrewPrivateAssistant(ctx: CrewPrivateContext, msg: Message): Message {
  const host = ctx.options.crewPrivateHost;
  if (ctx.options.promptProfile !== 'crew_private' || !host || msg.crew) return msg;
  return {
    ...msg,
    crew: {
      crewId: host.id,
      name: host.name,
      callsign: host.callsign,
      color: host.color,
      icon: host.icon,
    },
  };
}

export interface LinkedContextContext {
  options: { channelSession?: boolean };
  linkedContextSessionId: string | null;
  sessionManager: { getSessionById?(id: string): { title?: string } | null } | null;
}

/**
 * Build the linked desktop session context prompt block.
 */
export function buildLinkedContextPromptBlock(ctx: LinkedContextContext): string | null {
  if (!ctx.options.channelSession || !ctx.linkedContextSessionId) return null;
  const linked = ctx.sessionManager?.getSessionById?.(ctx.linkedContextSessionId);
  const title = linked?.title?.trim() || ctx.linkedContextSessionId;
  const narrative = globalNarrativeStore.load(ctx.linkedContextSessionId);
  const narrativeText = narrative ? renderNarrativeText(narrative) : '';
  return [
    '[LINKED_DESKTOP_SESSION]',
    `Telegram is context-linked to desktop session "${title}" (${ctx.linkedContextSessionId}).`,
    'Telegram chat history is separate from the desktop transcript — use linked narrative and resume state for goals.',
    ...(narrativeText ? ['', 'Linked session narrative:', narrativeText] : []),
    '[/LINKED_DESKTOP_SESSION]',
  ].join('\n');
}

export interface ProviderCredentialsContext {
  config: {
    provider: {
      activeProvider: string;
      providers?: Record<string, {
        activeProfile?: string;
        apiKey?: string;
        baseUrl?: string;
        profiles?: Record<string, { apiKey?: string; baseUrl?: string }>;
      }>;
    };
  };
}

/**
 * Get provider credentials (API key + base URL) from config.
 */
export function getProviderCredentials(ctx: ProviderCredentialsContext): { apiKey?: string; baseUrl?: string } {
  const providerSettings = ctx.config.provider.providers?.[ctx.config.provider.activeProvider];
  if (!providerSettings) return {};
  const activeProfileId = providerSettings.activeProfile;
  const profile = activeProfileId ? providerSettings.profiles?.[activeProfileId] : undefined;
  return {
    apiKey: profile?.apiKey ?? providerSettings.apiKey,
    baseUrl: profile?.baseUrl ?? providerSettings.baseUrl,
  };
}

export interface TimezoneContext {
  clientSituation: unknown;
  config: { timezone?: string };
}

/**
 * Get the user's timezone from config, falling back to system timezone.
 */
export function getUserTimezone(ctx: TimezoneContext): string {
  return resolveClientTimezone(ctx.clientSituation as never, ctx.config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Get the UTC offset string for the user's timezone (e.g. "+05:30", "-04:00").
 */
export function getUtcOffset(ctx: TimezoneContext): string {
  const tz = getUserTimezone(ctx);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  const raw = tzPart?.value ?? '';
  const match = raw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (match) {
    const sign = match[1];
    const hrs = match[2]!.padStart(2, '0');
    const mins = (match[3] ?? '00').padStart(2, '0');
    return `${sign}${hrs}:${mins}`;
  }
  return '+00:00';
}

export function getLoadingSteps(_intent: string): Array<{ id: string; label: string; status: 'active' | 'completed' | 'pending' }> {
  const labels: string[] = ['Thinking…', 'Working…', 'Processing…', 'One moment…'];
  return [{ id: 'load', label: labels[Math.floor(Math.random() * labels.length)]!, status: 'active' as const }];
}

/**
 * Build a human/voice-friendly preview of what a tool wants to do, for permission prompts.
 * `commandPreview` is a raw string (e.g. shell command); `argsSummary` is a short spoken phrase.
 */
export function summarizePermissionArgs(
  args?: Record<string, unknown>,
): { commandPreview?: string; argsSummary?: string } {
  if (!args) return {};
  const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

  const cmd = str(args['command'] ?? args['cmd']);
  if (cmd) {
    const trimmed = cmd.trim().slice(0, 400);
    return { commandPreview: trimmed, argsSummary: `run the command ${trimmed.slice(0, 160)}` };
  }

  const url = str(args['url']);
  if (url) {
    return { commandPreview: url, argsSummary: `access ${url.slice(0, 160)}` };
  }

  const path = str(args['path'] ?? args['file'] ?? args['filePath'] ?? args['target'] ?? args['to']);
  if (path) {
    return { commandPreview: path, argsSummary: `use the path ${path.slice(0, 160)}` };
  }

  const query = str(args['query']);
  if (query) {
    return { commandPreview: query, argsSummary: `search for ${query.slice(0, 160)}` };
  }

  return {};
}

export function generateDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lines: string[] = [];
  let o = 0, n = 0;
  while (o < oldLines.length || n < newLines.length) {
    if (o < oldLines.length && n < newLines.length && oldLines[o] === newLines[n]) {
      lines.push(` ${oldLines[o]}`);
      o++; n++;
    } else if (o < oldLines.length && (n >= newLines.length || oldLines[o] !== newLines[n])) {
      lines.push(`-${oldLines[o]}`);
      o++;
    } else if (n < newLines.length) {
      lines.push(`+${newLines[n]}`);
      n++;
    }
  }
  return lines.join('\n');
}

/** Detect failure-indicating phrases in assistant content. */
export function isFailureAssistantContent(content: string): boolean {
  return /\b(unable to generate|i apologize|i was unable|provider error|encountered an error|cannot assist|tell me which|please tell me|which action you)\b/i.test(content);
}

/** Convert model message content (string | array | null) to plain text. */
export function modelMessageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') return p.text;
        if (typeof p.toolName === 'string') return `tool:${p.toolName}`;
        return JSON.stringify(part);
      }
      return '';
    }).join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

/** Estimate the character count of tool schemas for token budgeting. */
export function estimateToolSchemaChars(tools: Record<string, unknown>): number {
  let chars = 0;
  for (const name of Object.keys(tools)) {
    const t = tools[name] as { description?: string; inputSchema?: unknown } | undefined;
    chars += JSON.stringify({ description: t?.description, inputSchema: t?.inputSchema }).length;
  }
  return chars;
}

/** Convert an error into a user-friendly message with remediation actions. */
export function toFriendlyError(error: unknown): { message: string; actions: RemediationAction[] } {
  const spaceErr = resolveSpaceError(error);
  const msg = error instanceof Error ? error.message : String(error);

  if (error instanceof ContextBudgetExceededError) {
    return {
      message: `⚠️ ${error.message}`,
      actions: [
        { type: 'switch_model', label: 'Switch model' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  if (msg.includes('max_output_tokens') && msg.includes('below minimum')) {
    return {
      message: '⚠️ Model trial or completion used an output token budget below the provider minimum (16). Retry after selecting the model again, or pick a different model.',
      actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'switch_model', label: 'Switch model' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }

  // Determine actions based on category
  if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API')) {
    return {
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      actions: [
        { type: 'reconfigure_key', label: 'Update API key' },
        { type: 'switch_model', label: 'Switch provider' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
    return {
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'switch_model', label: 'Switch model' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return {
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      actions: [
        { type: 'switch_model', label: 'Pick a different model' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
    return {
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      actions: [
        { type: 'switch_model', label: 'Switch provider' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
  // Generic — retry + dismiss
  return {
    message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
    actions: [
      { type: 'retry', label: 'Retry' },
      { type: 'dismiss', label: 'Dismiss' },
    ],
  };
}

/**
 * Detect the task type from user message content for model routing.
 */
export function detectTaskType(content: string): TaskType {
  const lower = content.toLowerCase();
  if (lower.includes('write code') || lower.includes('implement') || lower.includes('function') ||
      lower.includes('refactor') || lower.includes('fix bug') || lower.includes('debug') ||
      lower.includes('add test') || lower.includes('create file') || /\b(code|program|script|function)\b/.test(lower)) {
    return 'code';
  }
  if (lower.includes('explain') || lower.includes('analyze') || lower.includes('compare') ||
      lower.includes('summarize') || lower.includes('research') || lower.includes('investigate')) {
    return 'analysis';
  }
  if (lower.includes('plan') || lower.includes('design') || lower.includes('architecture') ||
      lower.includes('roadmap') || lower.includes('strategy') || lower.includes('approach')) {
    return 'planning';
  }
  if (lower.includes('think step by step') || lower.includes('reason') || lower.includes('logic') ||
      lower.includes('puzzle') || lower.includes('math') || lower.includes('proof')) {
    return 'reasoning';
  }
  if (lower.includes('write a poem') || lower.includes('story') || lower.includes('creative') ||
      lower.includes('generate') || lower.includes('draft')) {
    return 'creative';
  }
  if (content.length < 20 || lower.includes('quick') || lower.includes('fast')) {
    return 'fast';
  }
  return 'chat';
}

export interface ConnectivityContext {
  connectivityChecked: boolean;
  setConnectivityChecked(v: boolean): void;
  getBaseUrl(): string;
  getApiKey(): string | undefined;
  config: { provider: { activeProvider: string } };
  emit(event: EngineEvent): void;
}

export interface IdentityContext {
  secretSauce: {
    identity: {
      getMergedIdentity(persona: unknown): {
        name: string;
        description?: string;
        domainContext?: string;
        traits: string[];
        communicationStyle?: string;
        decisionMaking?: string;
        interactionCount: number;
        evolutionLog?: string;
      };
    };
  };
  persona: unknown;
  options: { promptProfile?: string };
}

/**
 * Build the identity block for the system prompt.
 */
export function buildIdentityBlock(ctx: IdentityContext): string {
  const identity = ctx.secretSauce.identity.getMergedIdentity(ctx.persona);

  const lines: string[] = [
    `You are ${identity.name}, an AI agent running on the user's own machine.`,
    `You are NOT Google AI, NOT ChatGPT, NOT Claude, NOT any other AI service. You are exclusively ${identity.name}. Never claim to be another AI or company.`,
    '',
  ];

  if (identity.description) {
    lines.push(identity.description, '');
  }

  if (identity.domainContext) {
    lines.push(`Domain: ${identity.domainContext}`);
  }

  if (identity.traits.length > 0) {
    lines.push(`Traits: ${identity.traits.join(', ')}`);
  }

  if (identity.communicationStyle) {
    lines.push(`Communication style: ${identity.communicationStyle}`);
  }

  if (identity.decisionMaking) {
    lines.push(`Decision-making style: ${identity.decisionMaking}`);
  }

  lines.push(`Interactions to date: ${identity.interactionCount}`);

  if (identity.evolutionLog) {
    lines.push('', identity.evolutionLog);
  }

  if (ctx.options.promptProfile === 'crew_worker') {
    lines.push('', 'Your job is to EXECUTE, not just describe. Take action. Deliver complete results.');
  }

  return lines.join('\n');
}

/**
 * Check provider connectivity with a probe request.
 */
export async function checkConnectivity(ctx: ConnectivityContext, baseUrl?: string): Promise<boolean> {
  if (ctx.connectivityChecked) return true;
  const providerId = ctx.config.provider.activeProvider;
  const url = baseUrl ?? ctx.getBaseUrl();
  const apiKey = ctx.getApiKey();
  const probeUrl = buildProviderConnectivityProbeUrl(providerId, url, apiKey);
  if (!probeUrl) return true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {};
    if (apiKey && providerId === 'google' && probeUrl.includes('/openai/')) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(probeUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    ctx.setConnectivityChecked(true);
    return res.ok || res.status < 500;
  } catch {
    ctx.emit({
      type: 'error',
      code: 'NETWORK_ERROR',
      message: `Cannot reach provider at ${url ?? probeUrl}. Check your internet connection and provider URL.`,
      recoverable: true,
      actions: [
        { type: 'dismiss', label: 'Dismiss' },
        { type: 'switch_model', label: 'Switch Provider' },
      ],
    });
    return false;
  }
}
