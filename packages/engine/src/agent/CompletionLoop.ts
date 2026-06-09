/**
 * CompletionLoop — extracted from Agent.ts.
 *
 * Handles the multi-round LLM completion loop:
 *   - Tool filtering and schema preparation
 *   - Message compaction
 *   - Streaming LLM responses
 *   - Tool call parsing and batch execution (with parallel dispatch)
 *   - Grace call when budget is exhausted
 *
 * All dependencies are injected via CompletionLoopDeps so this module has
 * no import of Agent itself, keeping the dependency graph acyclic.
 */

import type {
  Message,
  EngineEvent,
  CompletionRequest,
  CompletionMessage,
  CompletionToolCall,
  CompletionChunk,
  AgentXConfig,
} from '@agentx/shared';
import { generateMessageId, getLogger } from '@agentx/shared';
import type { IntentResult, PromptEngine } from '../prompt/PromptEngine.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import { ParallelClassifier } from '../tools/ParallelClassifier.js';
import { ToolCallRepairer } from '../tools/ToolCallRepairer.js';
import type { CompactionManager } from '../communication/CompactionManager.js';
import type { TelemetryEmitter } from '../communication/telemetry/TelemetryEmitter.js';
import type { DoomLoopDetector } from '../tools/DoomLoopDetector.js';
import type { TokenTracker } from '../session/TokenTracker.js';
import { estimateOutputTokens } from '../session/tokenCount.js';
import type { GitManager } from '../session/GitManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dependency contract (implemented by Agent)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionLoopDeps {
  // Static config
  readonly config: AgentXConfig;
  readonly sessionId: string;
  readonly gitAutoCommit: boolean;
  readonly gitManager: GitManager | null;
  readonly turnStartTokens: number;
  readonly turnStartCost: number;

  // Shared mutable array refs — mutated in-place so Agent sees all changes
  readonly messages: CompletionMessage[];
  readonly toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }>;
  readonly ragResults: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>;

  // Infrastructure (read-only from CompletionLoop's perspective)
  readonly toolRegistry: ToolRegistry | undefined;
  readonly toolExecutor: EnhancedToolExecutor | undefined;
  readonly promptEngine: PromptEngine;
  readonly compactionManager: CompactionManager;
  readonly telemetry: TelemetryEmitter;
  readonly doomLoopDetector: DoomLoopDetector;
  readonly tokenTracker: TokenTracker;
  onTokenLog: ((opts: { inputTokens: number; outputTokens: number; costUsd: number }) => void) | null;

  // Mutable scalar accessors
  getIntent(): IntentResult | null;
  getAbortController(): AbortController | null;
  getPendingInstruction(): string | null;
  clearPendingInstruction(): void;

  // Delegates to Agent private methods
  emit(event: EngineEvent): void;
  retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T>;
  unifiedStream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  isEditTool(toolId: string): boolean;
  getContextWindow(): number;

  // Sub-agent execution factory
  runSubAgent(
    instruction: string,
    tools: string[] | undefined,
    timeout: number,
  ): Promise<{ success: boolean; output: string; elapsed: number }>;

  // Clarification dialog
  waitForClarification(question: string, options: string[], allowFreeform: boolean): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CompletionLoop
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 10;

export class CompletionLoop {
  private readonly deps: CompletionLoopDeps;
  // Created once per instance — no mutable state between rounds
  private readonly parallelClassifier = new ParallelClassifier();
  private readonly toolCallRepairer = new ToolCallRepairer();

  constructor(deps: CompletionLoopDeps) {
    this.deps = deps;
  }

  /**
   * Run the multi-round completion loop and return the final assistant message.
   */
  async run(startTime: number): Promise<Message> {
    // Track accumulated content across ALL rounds for proper streaming to UI
    let accumulatedContent = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // ─── SMART TOOL SELECTION ───
      // Filter tools based on detected intent to reduce token usage
      let filteredTools: Array<{ id: string; name: string; modelDescription: string; schema: unknown; category: string; riskLevel: string }> = this.deps.toolRegistry?.list() ?? [];
      const currentIntent = this.deps.getIntent();
      if (currentIntent && this.deps.toolRegistry) {
        const categoryMap = new Map<string, string>();
        for (const t of this.deps.toolRegistry.list()) {
          categoryMap.set(t.id, t.category ?? 'General');
        }
        const selectedSchemas = this.deps.promptEngine.selectTools(
          this.deps.toolRegistry.toSchemas(),
          currentIntent,
          categoryMap,
        );
        filteredTools = selectedSchemas.map((s) => ({
          id: s.function.name,
          name: s.function.name,
          modelDescription: s.function.description,
          schema: s.function.parameters,
          category: categoryMap.get(s.function.name) ?? 'General',
          riskLevel: 'low' as const,
        }));
      }
      const toolSchemas = filteredTools.length > 0
        ? filteredTools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.id,
              description: t.modelDescription,
              parameters: t.schema as unknown as Record<string, unknown>,
            },
          }))
        : undefined;

      // ─── BUILD MESSAGES WITH RAG + COMPACTION ───
      let requestMessages = [...this.deps.messages];

      // Inject per-message instruction as a system directive (not stored in history)
      const pendingInstruction = this.deps.getPendingInstruction();
      if (pendingInstruction) {
        const userIdx = requestMessages.findLastIndex((m) => m.role === 'user');
        if (userIdx >= 0) {
          requestMessages.splice(userIdx, 0, { role: 'system', content: pendingInstruction });
        }
        this.deps.clearPendingInstruction();
      }

      // Inject RAG results as temporary context
      if (this.deps.ragResults.length > 0) {
        const ragCtx = this.deps.promptEngine.buildRagContext(this.deps.ragResults);
        const userIdx = requestMessages.findLastIndex((m) => m.role === 'user');
        if (userIdx >= 0) {
          requestMessages.splice(userIdx, 0, { role: 'system', content: ragCtx });
        }
      }

      // Inject reasoning directive
      if (currentIntent) {
        const reasoningDirective = this.deps.promptEngine.buildReasoningDirective(currentIntent.reasoningMode);
        requestMessages.splice(1, 0, { role: 'system', content: reasoningDirective });
      }

      // ─── UNIFIED: Compaction via CompactionManager ───
      const currentTokens = this.deps.tokenTracker.tokensUsed;
      if (this.deps.compactionManager.needsCompaction(currentTokens)) {
        this.deps.emit({ type: 'compaction_start', currentTokens, threshold: Math.floor(this.deps.getContextWindow() * 0.85) });
        try {
          const compactResult = await this.deps.compactionManager.compact(
            this.deps.messages.map((m, i) => ({
              id: `cm-${i}`,
              sessionId: this.deps.sessionId,
              role: m.role as Message['role'],
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              toolCalls: (m.toolCalls ?? []).map((tc) => ({
                id: tc.id, name: tc.function.name, arguments: tc.function.arguments, result: '',
              })),
              tokenCount: estimateOutputTokens(typeof m.content === 'string' ? m.content : ''),
              createdAt: new Date().toISOString(),
            })),
            this.deps.sessionId,
          );
          this.deps.emit({ type: 'compaction_complete', saved: compactResult.tokensSaved });
          this.deps.compactionManager.getGuard().recordCompaction(this.deps.sessionId);
        } catch (e) {
          getLogger().warn('COMPACTION', String(e));
        }
      }
      // Also run the classic PromptEngine compaction as fallback
      const budget = this.deps.promptEngine.calculateBudget(this.deps.messages.length, this.deps.ragResults.length > 0);
      const compacted = this.deps.promptEngine.compactConversation(requestMessages, budget.conversation);
      if (compacted.summary) {
        requestMessages = compacted.messages;
      }

      const request: CompletionRequest = {
        model: this.deps.config.provider.activeModel,
        messages: requestMessages,
        stream: true,
        tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
        signal: this.deps.getAbortController()?.signal,
      };

      this.deps.emit({ type: 'loading_start', stage: round === 0 ? 'thinking' : 'tool_execution' });

      // Stream response with retry support
      let fullContent = '';  // Content for THIS round only
      const toolCalls: CompletionToolCall[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let currentToolCall: any = null;
      let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

      const stream = await this.deps.retryWithBackoff(async () => {
        // Force the provider to start streaming — catches network/auth errors early
        const iter = this.deps.unifiedStream(request);
        const it = iter[Symbol.asyncIterator]();
        const first = await it.next();
        return { it, first } as { it: AsyncIterator<CompletionChunk>; first: IteratorResult<CompletionChunk> };
      }, `LLM completion (round ${round})`);

      // Process first chunk
      if (!stream.first.done && stream.first.value) {
        const chunk: CompletionChunk = stream.first.value;
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          accumulatedContent += chunk.content;
          this.deps.emit({ type: 'stream_chunk', content: chunk.content, fullContent: accumulatedContent });
        } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
          this.deps.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
        } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          const tc = chunk.toolCall;
          if (tc.id) {
            // Push previous tool call if exists
            const prev = currentToolCall;
            if (prev && prev.id) {
              toolCalls.push(prev as CompletionToolCall);
            }
            currentToolCall = {
              id: tc.id,
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
              thought_signature: (tc as Record<string, unknown>)['thought_signature'] as string | undefined,
            };
          } else {
            const cur = currentToolCall;
            if (cur && cur.function) {
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
            }
          }
        } else if (chunk.type === 'done' && chunk.usage) {
          lastUsage = chunk.usage;
        }
      }

      // Process remaining chunks
      let next = await stream.it.next();
      while (!next.done) {
        const chunk = next.value;
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          accumulatedContent += chunk.content;
          this.deps.emit({
            type: 'stream_chunk',
            content: chunk.content,
            fullContent: accumulatedContent,
          });
        } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
          this.deps.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
        } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          // Accumulate tool call
          if (chunk.toolCall.id) {
            // New tool call starting
            if (currentToolCall?.id) {
              toolCalls.push(currentToolCall as CompletionToolCall);
            }
            currentToolCall = {
              id: chunk.toolCall.id,
              type: 'function',
              function: {
                name: chunk.toolCall.function?.name ?? '',
                arguments: chunk.toolCall.function?.arguments ?? '',
              },
            };
          } else if (currentToolCall) {
            // Continuation of existing tool call
            if (chunk.toolCall.function?.name) {
              currentToolCall.function.name = (currentToolCall.function.name ?? '') + chunk.toolCall.function.name;
            }
            if (chunk.toolCall.function?.arguments) {
              currentToolCall.function.arguments = (currentToolCall.function.arguments ?? '') + chunk.toolCall.function.arguments;
            }
          }
        } else if (chunk.type === 'done' && chunk.usage) {
          lastUsage = chunk.usage;
        }
        next = await stream.it.next();
      }

      // Push last accumulated tool call
      if (currentToolCall?.id) {
        toolCalls.push(currentToolCall as CompletionToolCall);
      }

      // If there are tool calls, execute them and loop (do NOT emit loading_end yet)
      if (toolCalls.length > 0) {
        // Add assistant message with tool calls to history
        this.deps.messages.push({
          role: 'assistant',
          content: fullContent || '',
          toolCalls,
        });

        // Execute each tool call
        const specialTools = ['ask_clarification', 'delegate_to_subagent'];
        const regularToolCalls = toolCalls.filter((tc) => !specialTools.includes(tc.function.name));
        const specialToolCallList = toolCalls.filter((tc) => specialTools.includes(tc.function.name));

        // Handle special tools individually first
        for (const tc of specialToolCallList) {
          // ─── CLARIFICATION TOOL ───
          if (tc.function.name === 'ask_clarification') {
            let sargs: Record<string, unknown> = {};
            try { sargs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            const userResponse = await this.deps.waitForClarification(
              String(sargs['question'] ?? 'I need more information to proceed.'),
              (Array.isArray(sargs['options']) ? sargs['options'] : []) as string[],
              Boolean(sargs['allowFreeform'] ?? true),
            );
            this.deps.messages.push({ role: 'tool', content: userResponse, toolCallId: tc.id });
            continue;
          }

          // ─── SMART SUBAGENT DELEGATION ───
          if (tc.function.name === 'delegate_to_subagent') {
            let dargs: Record<string, unknown> = {};
            try { dargs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            const subStart = Date.now();
            this.deps.emit({ type: 'tool_executing', tool: 'delegate_to_subagent', description: `Spawning sub-agent: ${dargs['mission']}`, startTime: subStart });
            const subResult = await this.deps.runSubAgent(
              String(dargs['mission'] ?? ''),
              Array.isArray(dargs['tools']) ? dargs['tools'].map(String) : undefined,
              typeof dargs['timeout'] === 'number' ? dargs['timeout'] : 120_000,
            );
            const subOutput = subResult.success
              ? `[Sub-agent completed in ${subResult.elapsed}ms]\n${subResult.output}`
              : `[Sub-agent failed: ${subResult.output}]`;
            this.deps.emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: subResult.success, output: subOutput }, elapsed: Date.now() - subStart });
            this.deps.messages.push({ role: 'tool', content: subOutput, toolCallId: tc.id });
            continue;
          }
        }

        // ─── UNIFIED: Batch execute regular tools with parallel classifier ───
        if (regularToolCalls.length > 0) {
          const parsedCalls = regularToolCalls.map((tc) => {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments); } catch { /* bad JSON */ }
            // Doom-loop check per tool
            const doomResult = this.deps.doomLoopDetector.check(this.deps.sessionId, tc.function.name, args);
            if (doomResult.shouldBreak) {
              return { tc, args, skip: true, doomCount: doomResult.consecutiveCount };
            }
            return { tc, args, skip: false, doomCount: 0 };
          });

          const batchCalls = parsedCalls
            .filter((p) => !p.skip)
            .map((p) => ({ id: p.tc.id, name: p.tc.function.name, arguments: p.args }));

          // Execute doom-looped tools — push error messages
          for (const p of parsedCalls) {
            if (p.skip) {
              this.deps.emit({ type: 'error', code: 'DOOM_LOOP', message: `${p.tc.function.name} called ${p.doomCount}x consecutively — breaking loop.`, recoverable: true } as unknown as EngineEvent);
              this.deps.messages.push({ role: 'tool', content: `[DOOM LOOP DETECTED] ${p.tc.function.name} repeated ${p.doomCount} times`, toolCallId: p.tc.id });
            }
          }

          if (batchCalls.length > 0) {
            // Emit tool_executing events
            for (const bc of batchCalls) {
              this.deps.emit({ type: 'tool_executing', tool: bc.name, description: `Executing ${bc.name}`, startTime: Date.now() });
            }

            const batchResults = await this.executeToolBatch(batchCalls, this.deps.sessionId);

            for (const r of batchResults) {
              // Use r.name (resolved tool function name) so it matches the tool_executing event
              this.deps.emit({ type: 'tool_complete', tool: r.name, result: { success: r.success, output: r.output }, elapsed: r.elapsed });
              this.deps.telemetry.recordToolCall(`turn-${this.deps.turnStartTokens}`, r.success);
              this.deps.toolCallLogForReflection.push({ name: r.name, success: r.success, output: r.output, elapsed: r.elapsed });

              // Auto-commit after file edit operations
              if (this.deps.gitAutoCommit && this.deps.gitManager && this.deps.isEditTool(r.name) && r.success) {
                const tc = regularToolCalls.find((t) => t.id === r.id);
                if (tc) {
                  try {
                    const a = JSON.parse(tc.function.arguments);
                    const fp = (a['path'] ?? a['file']) as string;
                    if (fp) this.deps.gitManager.commitAfterEdit(fp, this.deps.sessionId);
                  } catch { /* ignore */ }
                }
              }

              // Truncate large tool results before injecting into context to avoid context overflow
              const raw = typeof r.output === 'string' ? r.output : (r.output != null ? JSON.stringify(r.output) : '');
              const MAX_TOOL_OUTPUT = 10000;
              const truncated = raw.length > MAX_TOOL_OUTPUT
                ? raw.slice(0, MAX_TOOL_OUTPUT) + `\n\n[Result truncated — ${raw.length - MAX_TOOL_OUTPUT} chars omitted]`
                : raw;
              this.deps.messages.push({ role: 'tool', content: truncated, toolCallId: r.id });
            }
          }
        }

        // Track token usage for tool-call rounds too
        if (lastUsage) {
          this.deps.tokenTracker.addTokenUsage(lastUsage.inputTokens, lastUsage.outputTokens);
        }

        // Continue the loop — model will see tool results and generate next response
        continue;
      }

      // No tool calls — this is the final assistant response
      // ─── UNIFIED: Record telemetry on final response ───
      this.deps.telemetry.endTurn(
        `turn-${startTime}`,
        lastUsage
          ? { promptTokens: lastUsage.inputTokens, completionTokens: lastUsage.outputTokens, totalTokens: lastUsage.inputTokens + lastUsage.outputTokens }
          : { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        this.deps.sessionId,
        this.deps.config.provider.activeProvider,
      );

      // Guard against empty response from model — retry once or return error
      if (!fullContent.trim() && round < MAX_TOOL_ROUNDS - 1) {
        getLogger().warn('COMPLETION', `Empty response from model on round ${round}, retrying...`);
        continue;
      }
      if (!fullContent.trim()) {
        fullContent = 'I apologize, I was unable to generate a response. Please try rephrasing your question.';
        accumulatedContent += fullContent;
        this.deps.emit({ type: 'stream_chunk', content: fullContent, fullContent: accumulatedContent });
      }

      // Emit loading_end now that we have the final response
      this.deps.emit({ type: 'loading_end' });

      this.deps.messages.push({ role: 'assistant', content: accumulatedContent });

      const tokenCount = lastUsage
        ? lastUsage.inputTokens + lastUsage.outputTokens
        : Math.ceil(accumulatedContent.length / 4);
      if (lastUsage) {
        this.deps.tokenTracker.addTokenUsage(lastUsage.inputTokens, lastUsage.outputTokens);
      } else {
        const estOutput = estimateOutputTokens(accumulatedContent);
        this.deps.tokenTracker.addTokenUsage(Math.ceil(estOutput * 0.8), estOutput);
      }

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.deps.sessionId,
        role: 'assistant',
        content: accumulatedContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      };

      const elapsed = Date.now() - startTime;
      const turnTokens = this.deps.tokenTracker.tokensUsed - (this.deps.turnStartTokens ?? 0);
      const costUsd = this.deps.tokenTracker.totalCost - (this.deps.turnStartCost ?? 0);
      this.deps.emit({ type: 'token_usage', totalTokens: this.deps.tokenTracker.tokensUsed, contextWindow: this.deps.getContextWindow(), turnTokens, costUsd, inputTokens: this.deps.tokenTracker.inputTokenCount, outputTokens: this.deps.tokenTracker.outputTokenCount, inputPrice: this.deps.tokenTracker.inputPrice, outputPrice: this.deps.tokenTracker.outputPrice } as unknown as EngineEvent);
      this.deps.onTokenLog?.({ inputTokens: this.deps.tokenTracker.inputTokenCount, outputTokens: this.deps.tokenTracker.outputTokenCount, costUsd });
      this.deps.emit({
        type: 'message_received',
        message: assistantMessage,
        elapsed,
      });

      return assistantMessage;
    }

    // ─── UNIFIED: Grace Call (budget-exhausted recovery) ───
    // One extra API call to let the model finish its thought without tool access.
    // Prevents mid-sentence truncation when budget is exhausted.
    if (accumulatedContent.length > 0) {
      const graceInstruction =
        '\n[SYSTEM] You have exhausted your tool budget. Do NOT make any more tool calls. ' +
        'If you were in the middle of a response, please finish your thought concisely. ' +
        'If you were about to start a new tool chain, summarize what remains to be done.';
      this.deps.messages.push({ role: 'user', content: graceInstruction });

      try {
        const graceStream = this.deps.unifiedStream({
          model: this.deps.config.provider.activeModel,
          messages: [...this.deps.messages],
          stream: true,
          tools: [],
          signal: this.deps.getAbortController()?.signal,
        });

        let graceText = '';
        for await (const chunk of graceStream) {
          if (chunk.type === 'text_delta' && chunk.content) {
            graceText += chunk.content;
            accumulatedContent += chunk.content;
            this.deps.emit({ type: 'stream_chunk', content: chunk.content, fullContent: accumulatedContent });
          }
        }

        if (graceText.trim()) {
          this.deps.emit({ type: 'loading_end' });
          this.deps.messages.push({ role: 'assistant', content: accumulatedContent });

          const graceMessage: Message = {
            id: generateMessageId(),
            sessionId: this.deps.sessionId,
            role: 'assistant',
            content: accumulatedContent,
            toolCalls: null,
            createdAt: new Date().toISOString(),
             tokenCount: estimateOutputTokens(accumulatedContent),
          };

          this.deps.emit({ type: 'message_received', message: graceMessage, elapsed: Date.now() - startTime });
          return graceMessage;
        }
      } catch {
        // Grace call failed — fall through to fallback
      }
    }

    // Exhausted rounds — return what we have
    this.deps.emit({ type: 'loading_end' });
    const fallback: Message = {
      id: generateMessageId(),
      sessionId: this.deps.sessionId,
      role: 'assistant',
      content: 'I apologize, I ran into a processing limit. Please try a simpler request.',
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };
    this.deps.emit({ type: 'message_received', message: fallback, elapsed: Date.now() - startTime });
    return fallback;
  }

  /**
   * Execute a batch of tool calls in parallel (where safe) or sequentially.
   *
   * Returns `name` (the resolved tool function name) alongside `id` (the LLM
   * toolCallId) so callers can emit `tool_complete` with the correct name that
   * matches the earlier `tool_executing` event.
   */
  private async executeToolBatch(
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
    sessionId: string,
  ): Promise<Array<{ id: string; name: string; success: boolean; output: string; error?: string; elapsed: number }>> {
    // Classify for parallel execution
    const classified = this.parallelClassifier.classify(
      toolCalls.map((tc) => ({
        toolCallId: tc.id,
        tool: {
          id: tc.name,
          name: tc.name,
          description: '',
          modelDescription: '',
          category: 'ai_meta' as const,
          riskLevel: 'medium' as const,
          schema: { type: 'object' as const, properties: {} },
          composable: false,
          source: 'builtin' as const,
        },
        args: tc.arguments,
      })),
    );

    const results: Array<{ id: string; name: string; success: boolean; output: string; error?: string; elapsed: number }> = [];
    const executed = new Set<string>();

    const execOne = async (tc: typeof toolCalls[number]) => {
      const start = Date.now();
      // ─── UNIFIED: Repair tool name via ToolCallRepairer ───
      const knownNames = this.deps.toolRegistry?.list().map((t) => t.name) ?? [];
      const repairedName = this.toolCallRepairer.repairToolName(tc.name, knownNames);
      const effectiveName = repairedName !== tc.name ? repairedName : tc.name;

      try {
        const result = this.deps.toolExecutor
          ? await this.deps.toolExecutor.execute(effectiveName, tc.arguments, sessionId)
          : { success: false, output: 'No executor', error: 'NO_EXECUTOR' };
        results.push({ id: tc.id, name: effectiveName, success: result.success, output: result.output, error: result.error, elapsed: Date.now() - start });
      } catch (err) {
        results.push({ id: tc.id, name: effectiveName, success: false, output: err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err)), error: 'EXEC_ERROR', elapsed: Date.now() - start });
      }
    };

    // Execute parallel batch first
    if (classified.parallel.length > 0) {
      const parallelCalls = classified.parallel
        .map((ct) => toolCalls.find((tc) => tc.id === ct.toolCallId))
        .filter((tc): tc is typeof toolCalls[number] => !!tc);
      await Promise.all(parallelCalls.map((tc) => { executed.add(tc.id); return execOne(tc); }));
    }

    // Then sequential
    for (const ct of classified.sequential) {
      const tc = toolCalls.find((t) => t.id === ct.toolCallId);
      if (tc && !executed.has(tc.id)) {
        executed.add(tc.id);
        await execOne(tc);
      }
    }

    // Any remaining (shouldn't happen, but safety)
    for (const tc of toolCalls) {
      if (!executed.has(tc.id)) {
        executed.add(tc.id);
        await execOne(tc);
      }
    }

    return results;
  }
}
