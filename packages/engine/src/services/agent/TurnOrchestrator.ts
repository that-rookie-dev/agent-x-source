import type { Message, EngineEvent, CompletionMessage, QuestionnairePayload } from '@agentx/shared';
import {
  generateMessageId,
  getLogger,
  formatClientSituationBlock,
  resolveEffectiveMaxOutputTokens,
  estimatePromptTokens,
  ContextBudgetExceededError,
} from '@agentx/shared';
import { streamText, stepCountIs } from 'ai';
import { ConcurrencyLimiter } from '../../concurrency/ConcurrencyLimiter.js';
import { createAiSdkModel, createAiSdkTools } from '../../agent/AiSdkBridge.js';
import { createAiSdkStreamHandler } from '../../agent/AiSdkStreamHandler.js';
import { buildCompletionMessages } from '../../agent/context-profile.js';
import { reconcileIntegrationHintWithActiveTools } from '../../integrations/integration-tool-availability.js';
import type { ThirdPartyTurnPolicy } from '../../integrations/third-party-access.js';
import { buildGoogleAiSdkProviderOptions } from '../../providers/google/gemini-metadata.js';
import { getPerfTracker } from '../../benchmark/perf.js';
import type { ITurnOrchestrator, TurnOrchestratorHost, TurnRunOptions } from './ITurnOrchestrator.js';

/** Tools whose results should be ingested into the neural brain for future RAG retrieval. */
const WEB_SEARCH_TOOLS = new Set([
  'web_search', 'deep_web_search', 'web_fetch', 'web_scrape',
]);

/** Shared concurrency limiter for all in-flight LLM provider calls. */
const LLM_CONCURRENCY_LIMITER = new ConcurrencyLimiter();
const LLM_GLOBAL_CONCURRENCY = Number(process.env['AGENTX_LLM_CONCURRENCY'] ?? '4');
const LLM_PROVIDER_CONCURRENCY = Number(process.env['AGENTX_PROVIDER_CONCURRENCY'] ?? '2');

/** Extract the latest user text from history, stripping per-turn boundary markers. */
export function deriveLastUserText(messages: CompletionMessage[]): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  return typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
    : '';
}

/**
 * Runs the model completion loop using the Vercel AI SDK (streamText).
 * Extracted from the Agent god class (Phase 4) — the agent participates via
 * the narrow {@link TurnOrchestratorHost} seam.
 *
 * The AI SDK handles:
 * - LLM call with streaming
 * - Tool execution (calls our wrapped tools asynchronously)
 * - Multi-step loop (auto-feeds tool results back to LLM)
 * - Structured events for UI visualization
 */
export class TurnOrchestrator implements ITurnOrchestrator {
  constructor(private readonly host: TurnOrchestratorHost) {}

  /**
   * Detect whether an assistant response that follows a web-research tool call
   * is just a short preamble or heading rather than a useful natural-language
   * summary. When true, a text-only retry is triggered so the model synthesizes
   * the tool results into an actual answer.
   */
  private isIncompleteResearchSummary(content: string): boolean {
    const hasResearchTool = this.host.toolCallLogForReflection.some(
      (t) => t.success && WEB_SEARCH_TOOLS.has(t.name),
    );
    if (!hasResearchTool) return false;

    const text = content.trim();
    if (text.length === 0) return true;
    if (text.length < 80) return true;

    const preamblePattern = /^(here'?s?\b|here is|i found|based on|summary of|results?|search results?|the (search|research|results?) show)/i;
    if (preamblePattern.test(text) && text.split(/[.!?]\s+/).filter(Boolean).length <= 2) {
      return true;
    }
    return false;
  }

  async runTurn(sessionId: string, userText: string, opts: TurnRunOptions): Promise<Message> {
    const startTime = opts.startTime;
    const abortSignal = this.resolveAbortSignal(opts.signal);
    let assistantMessage: Message | undefined;
    let releaseGlobal: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    getPerfTracker().turnStart(sessionId, startTime);
    await this.host.reconcileSystemPrompt();
    await this.host.compactContext();

    const emit = (e: EngineEvent) => this.host.emit(e);
    const registry = this.host.toolRegistry;
    const executor = this.host.toolService;
    if (!registry) throw new Error('Tool registry not initialized');
    if (!executor) throw new Error('Tool executor not initialized');

    const lastUserText = userText || deriveLastUserText(this.host.messages);
    let integrationHint: string | undefined;
    let integrationAccessPolicy: ThirdPartyTurnPolicy | undefined;
    if (this.host.options.prepareIntegrationTools && lastUserText) {
      try {
        const prep = await this.host.options.prepareIntegrationTools(lastUserText);
        if (typeof prep === 'string') {
          integrationHint = prep;
        } else if (prep) {
          integrationHint = prep.hint;
          integrationAccessPolicy = prep.policy;
          this.host.setThirdPartyTurnPolicy(prep.policy ?? null);
        }
      } catch (error) {
        getLogger().warn('AGENT', `Integration pre-turn sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const compact = this.host.usesCompactContext();
    const tools = createAiSdkTools(
      registry,
      executor,
      sessionId,
      emit,
      async (questionnaire: QuestionnairePayload) => {
        if (this.host.isDelegatedWorker) {
          return 'Proceed with your best judgment using available read-only tools and context.';
        }
        return this.host.waitForQuestionnaireResponse(questionnaire);
      },
      async (instruction, toolsList, timeout, background) =>
        this.host.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
      this.host.planMode,
      this.host.options.promptProfile === 'crew_private' || this.host.options.channelSession
        ? undefined
        : (toolId, reason) => this.host.waitForModeEscalation(toolId, reason),
      (toolId, success, output, elapsed, args) => {
        const path = typeof args?.path === 'string' ? args.path : undefined;
        this.host.toolLedger.record({ name: toolId, success, output, elapsed, path });
        this.host.toolCallLogForReflection.push({ name: toolId, success, output, elapsed });
        this.host.turnState.touch();
        // Ingest web search / fetch results into the neural brain for future RAG retrieval.
        // This ensures knowledge discovered via web tools is persisted and searchable
        // in subsequent turns — not lost after the current conversation.
        if (success && WEB_SEARCH_TOOLS.has(toolId) && output && output.length > 50) {
          this.host.ingestWebSearchResult(toolId, args, output).catch(() => {});
        }
      },
      this.host.options.promptProfile ?? 'default',
      compact,
    );

    if (this.host.options.promptProfile === 'crew_private') {
      const denyCrewOrchestration = new Set(['spawn_crew_workers', 'delegate_to_crew', 'crew_response']);
      for (const key of Object.keys(tools)) {
        if (denyCrewOrchestration.has(key)) delete tools[key];
      }
    }

    if (integrationHint !== undefined || integrationAccessPolicy !== undefined) {
      const reconciled = reconcileIntegrationHintWithActiveTools(
        integrationHint,
        integrationAccessPolicy,
        Object.keys(tools),
      );
      integrationHint = reconciled.hint;
      integrationAccessPolicy = reconciled.policy;
      this.host.setThirdPartyTurnPolicy(reconciled.policy ?? null);
    }

    const model = createAiSdkModel(this.host.config, this.host.getApiKey());

    let aiMessages = this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const toolCount = Object.keys(tools).length;
    const rebuildAiMessages = () => this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const budget = await this.ensureOutputBudget(aiMessages, tools, rebuildAiMessages);
    aiMessages = budget.messages;
    const turnMaxOutputTokens = budget.maxOutputTokens;

    const streamHandler = createAiSdkStreamHandler(
      emit,
      sessionId,
      (inputTokens, outputTokens) => {
        this.host.tokenTracker.addTokenUsage(inputTokens, outputTokens);
        this.host.onTokenLog?.({ inputTokens, outputTokens, costUsd: 0 });
      },
      this.host.onPart,
      this.host.config.provider.activeModel,
      this.host.gitManager ?? undefined,
      this.host.onSessionEvent ?? undefined,
      this.host.getContextWindow(),
      aiMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      this.host.tokenTracker.inputTokenCount,
      this.host.tokenTracker.outputTokenCount,
      this.host.pendingVoiceMerge ?? undefined,
    );
    this.host.activeStreamHandler = streamHandler;

    try {
      this.host.turnState.setStage('thinking');
      this.host.emit({ type: 'loading_start', stage: 'thinking' });

      // Limit global and per-provider LLM concurrency.
      releaseGlobal = await LLM_CONCURRENCY_LIMITER.acquireGlobal(LLM_GLOBAL_CONCURRENCY, abortSignal);
      releaseProvider = await LLM_CONCURRENCY_LIMITER.acquire(
        this.host.config.provider.activeProvider,
        LLM_PROVIDER_CONCURRENCY,
        abortSignal,
      );

      // Log tool setup for debugging
      getLogger().info('AGENT', `Starting streamText with ${toolCount} tools, model: ${this.host.config.provider.activeModel}, mode: ${this.host.planMode ? 'plan' : 'agent'}, maxOutputTokens: ${turnMaxOutputTokens}`);

      let stepCapContinuations = 0;
      const stepBudget = this.host.completionStepBudget();
      const stepLimit = () => stepBudget;
      const googleProviderOptions = this.host.config.provider.activeProvider === 'google'
        ? buildGoogleAiSdkProviderOptions(
          this.host.config.provider.activeModel,
          this.host.config.provider.activeReasoningEffort,
        )
        : undefined;
      const result = streamText({
        model,
        messages: aiMessages,
        tools,
        abortSignal,
        maxRetries: 2,
        maxOutputTokens: turnMaxOutputTokens,
        stopWhen: ({ steps }) => steps.length >= stepLimit(),
        toolChoice: 'auto',
        ...(googleProviderOptions ? { providerOptions: googleProviderOptions } : {}),
        prepareStep: async ({ stepNumber, messages }) => {
          this.host.turnState.setStage('execution', stepNumber);
          const stepMessages = messages.map((m) => ({
            content: this.modelMessageContentToText(m.content),
          }));
          const stepEstimate = this.estimateTurnInputTokens(stepMessages, tools);
          try {
            resolveEffectiveMaxOutputTokens({
              configured: this.host.config.maxOutputTokens,
              contextWindow: this.host.getContextWindow(),
              estimatedInputTokens: stepEstimate,
              modelCaps: this.host.getActiveModelCaps(),
            });
          } catch (error) {
            getLogger().warn(
              'AGENT',
              `Context budget exceeded at step ${stepNumber} (~${stepEstimate} tokens) — stopping tool loop`,
            );
            if (stepNumber > 0) throw new Error('STEP_CAP_STOP');
            throw error;
          }
          const stepBudgetBase = this.host.options.promptProfile === 'crew_private'
            ? this.host.crewPrivateCompletionSteps
            : this.host.maxCompletionSteps;
          if (stepNumber > 0 && stepNumber % stepBudgetBase === 0 && stepNumber >= stepBudgetBase) {
            const cont = await this.host.waitForStepCap(stepNumber);
            if (!cont) throw new Error('STEP_CAP_STOP');
            stepCapContinuations++;
          }
          if (
            stepNumber === 0
            && this.host.turnWebSearchPolicy === 'forced'
            && this.host.forcedWebSearchToolName
            && tools[this.host.forcedWebSearchToolName]
          ) {
            return { toolChoice: { type: 'tool' as const, toolName: this.host.forcedWebSearchToolName } };
          }
          const provider = this.host.missionContextProvider;
          if (!provider || stepNumber === 0) return {};
          const { revision, block } = provider();
          if (!block.trim() || revision <= this.host.lastMissionContextRevision) return {};
          this.host.lastMissionContextRevision = revision;
          return {
            messages: [
              ...messages,
              {
                role: 'user' as const,
                content: `[TEAM UPDATE — new crew activity]\n${block}\n[/TEAM UPDATE]`,
              },
            ],
          };
        },
      });

      let finishEmitted = false;
      let streamError: Error | null = null;
      try {
        for await (const chunk of result.fullStream) {
          streamHandler.handleEvent(chunk);
          if (chunk.type === 'text-delta') {
            this.host.partialTurnContent = streamHandler.getState().accumulatedContent;
          }
          if (chunk.type === 'finish') finishEmitted = true;
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        getLogger().warn('AGENT', `streamText failed: ${streamError.message}`);
        if (streamError.name === 'AbortError') {
          throw streamError;
        }
      }

      // Fallback: if stream ended without finish event, emit one now to ensure message is recorded
      if (!finishEmitted) {
        const state = streamHandler.getState();
        if (state.accumulatedContent || state.toolCallCount > 0) {
          streamHandler.handleEvent({ type: 'finish', usage: await result.usage });
        }
      }

      const text = streamHandler.getState().accumulatedContent || '';
      let content = text.trim();
      if (this.host.pendingVoiceMerge) {
        const phase2Body = content.replace(/⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi, '').trim();
        const prefix = this.host.pendingVoiceMerge.prefixContent.trim();
        content = phase2Body ? `${prefix}\n\n${phase2Body}` : prefix;
      }

      // ─── CRITICAL FIX: Populate tool execution log from stream handler ───
      const streamToolExecs = streamHandler.getState().toolExecutions;
      if (streamToolExecs && streamToolExecs.length > 0) {
        getLogger().info('AGENT', `Recovered ${streamToolExecs.length} tool executions from stream handler`);
        this.host.toolCallLogForReflection.push(...streamToolExecs.map(t => ({ name: t.tool, success: t.success, output: t.output, elapsed: t.elapsed })));
      }
      const toolExecs = this.host.toolCallLogForReflection.filter(t => t.success).length;
      getLogger().info('AGENT', `Total tool executions in turn: ${this.host.toolCallLogForReflection.length}, successful: ${toolExecs}`);

      // Generic self-healing: if response is essentially empty (whitespace or <3 chars),
      // or the tool loop crashed (e.g. malformed tool-call arguments), retry once.
      // Also retry after web-research tools when the response looks like a short preamble
      // instead of a natural-language summary.
      // When tools already ran, retry WITHOUT tools to force a plain-text summary.
      if (content.length < 3 || streamError || this.isIncompleteResearchSummary(content)) {
        const toolSummary = this.host.toolCallLogForReflection
          .map(t => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'} — ${t.output.slice(0, 300)}`)
          .join('\n');
        const worked = toolExecs > 0;
        const textOnlyRetry = worked || !!streamError;
        getLogger().warn(
          'AGENT',
          `Response too short or incomplete research summary (${content.length} chars, ${toolExecs} tools${streamError ? ', stream error' : ''}) — retrying${textOnlyRetry ? ' text-only' : ' with tools'}`,
        );
        try {
          const retryMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
            ...aiMessages,
            ...(worked ? [{ role: 'assistant' as const, content: text || '(executed tools)' }] : []),
            {
              role: 'user' as const,
              content: worked || streamError
                ? `[SYSTEM] You just ran these tools:\n${toolSummary || '(see prior tool activity)'}\n\nNow respond to the user based on these results. Do not call more tools. Be thorough and actionable.`
                : `[SYSTEM] The user said: "${aiMessages[aiMessages.length - 1]?.content?.slice(0, 500)}"\n\nUse the appropriate tools to answer. Prefer connected MCP integration tools when the request targets an external service — do not scan the local filesystem as a substitute. Do not return empty.`,
            },
          ];
          const retryResult = streamText({
            model: createAiSdkModel(this.host.config, this.host.getApiKey()),
            messages: retryMessages,
            ...(textOnlyRetry
              ? {}
              : {
                tools: createAiSdkTools(
                  this.host.toolRegistry!,
                  this.host.toolService!,
                  sessionId,
                  (e) => this.host.emit(e),
                  async () => 'continue',
                  (instruction, toolsList, timeout, background) =>
                    this.host.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                  this.host.planMode,
                  undefined,
                  undefined,
                  'default',
                  compact,
                ),
                stopWhen: stepCountIs(50),
                toolChoice: 'auto' as const,
              }),
            maxRetries: 1,
            maxOutputTokens: turnMaxOutputTokens,
            abortSignal,
          });
          let retryText = '';
          for await (const chunk of retryResult.fullStream) { streamHandler.handleEvent(chunk); }
          retryText = (streamHandler.getState().accumulatedContent || '').trim();
          if (retryText) content = text.trim() ? text.trim() + '\n\n' + retryText : retryText;
        } catch (retryErr) {
          getLogger().warn(
            'AGENT',
            `Empty-response retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
      }

      if (!content) {
        content = 'I was unable to generate a response. This model may not support function calling — try switching to GPT-4o, Claude, or Gemini.';
      }

      const usage = await result.usage;
      const tokenCount = usage
        ? (usage.inputTokens || 0) + (usage.outputTokens || 0)
        : Math.ceil(content.length / 4);

      this.host.sessionLogger?.log({
        type: 'llm_response',
        data: {
          round: 0,
          content: content.slice(0, 1000),
          usage: usage ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } : null,
        },
      });

      // Stream handler already emitted message_received in its finish case.
      // Only push assistant content — tool ledger is persisted via persistToolLedger (not in agent history).
      this.host.messages.push({ role: 'assistant', content });
      await this.host.compactContext();
      await this.host.reinforceMemoryContext();

      assistantMessage = this.host.tagCrewPrivateAssistant({
        id: this.host.pendingVoiceMerge?.messageId ?? generateMessageId(),
        sessionId,
        role: 'assistant' as const,
        content,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      });
      return assistantMessage;
    } catch (error) {
      if (error instanceof Error && error.message === 'MODE_ESCALATION_DECLINED') {
        const declinedMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content: '⏹ Stopped — staying in Plan mode. Switch to Agent mode when you\'re ready to execute write operations.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: declinedMessage, elapsed: Date.now() - startTime });
        assistantMessage = declinedMessage;
        return assistantMessage;
      }
      if (error instanceof Error && error.message === 'STEP_CAP_STOP') {
        const capMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content: this.host.partialTurnContent.trim() || '⏹ Step limit reached. Send another message to continue.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: capMessage, elapsed: Date.now() - startTime });
        assistantMessage = capMessage;
        return assistantMessage;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        const cancelledMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content: '⏹ Cancelled.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: cancelledMessage, elapsed: Date.now() - startTime });
        assistantMessage = cancelledMessage;
        return assistantMessage;
      }
      if (error instanceof Error && error.message === 'CLARIFICATION_ABORTED') {
        assistantMessage = {
          id: '__clarify__',
          sessionId,
          role: 'assistant',
          content: '',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        return assistantMessage;
      }
      if (error instanceof Error && (error.name === 'NoOutputGeneratedError' || error.message.includes('No output generated'))) {
        const toolSummary = this.host.toolCallLogForReflection
          .map((t) => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'}`)
          .join('\n');
        const partial = this.host.partialTurnContent.trim();
        const content = partial
          || (toolSummary
            ? `I ran tools but could not finish a reply:\n${toolSummary}\n\nSend *continue* to resume.`
            : 'I could not generate a reply for that request. Send *continue* or try again.');
        const recoveryMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: recoveryMessage, elapsed: Date.now() - startTime });
        assistantMessage = recoveryMessage;
        return assistantMessage;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      getLogger().error('COMPLETION', `AI SDK streamText failed: ${errorMsg}`);
      this.host.emit({ type: 'error', code: 'AI_SDK_ERROR', message: errorMsg, recoverable: false });
      throw error;
    } finally {
      releaseProvider?.();
      releaseGlobal?.();
      this.host.activeStreamHandler = null;
      this.host.setThirdPartyTurnPolicy(null);
      if (assistantMessage) {
        getPerfTracker().turnEnd(sessionId, assistantMessage, Date.now());
      }
    }
  }

  private resolveAbortSignal(turnSignal?: AbortSignal): AbortSignal | undefined {
    const signals = [this.host.abortSignal, turnSignal].filter((s): s is AbortSignal => s !== undefined);
    if (signals.length === 0) return undefined;
    if (signals.length === 1) return signals[0];
    return AbortSignal.any(signals);
  }

  private buildAiMessagesForTurn(opts: {
    lastUserText: string;
    compact: boolean;
    integrationHint?: string;
  }): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const aiMessages = buildCompletionMessages(
      this.host.messages.map((m) => ({
        role: m.role,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
      })),
      opts.compact,
      3,
      this.host.config.provider.activeProvider,
    ).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    if (this.host.pendingInstruction) {
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${userMsg.content}\n\n[INSTRUCTION]\n${this.host.pendingInstruction}\n[/INSTRUCTION]` };
      }
      this.host.pendingInstruction = null;
    }

    const turnCtx = this.host.prepareTurnContext(opts.lastUserText);
    if (turnCtx.block) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[TURN CONTEXT]')) {
        aiMessages[userIdx] = { role: 'user', content: `${turnCtx.block}\n\n${userMsg.content}` };
      }
    }

    if (this.host.clientSituation) {
      const situationBlock = formatClientSituationBlock(this.host.clientSituation);
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[CLIENT_SITUATION]')) {
        aiMessages[userIdx] = { role: 'user', content: `${situationBlock}\n\n${userMsg.content}` };
      }
    }

    if (opts.integrationHint) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[INTEGRATION')) {
        aiMessages[userIdx] = { role: 'user', content: `${opts.integrationHint}\n\n${userMsg.content}` };
      }
    }

    if (!opts.compact && this.host.lastRagResults.length > 0) {
      const ragCtx = this.host.buildRagContext(this.host.lastRagResults);
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${ragCtx}\n\n${userMsg.content}` };
      }
    }

    return aiMessages;
  }

  /** Compact history when needed and ensure the prompt leaves room for model output. */
  private async ensureOutputBudget(
    aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    tools: Record<string, unknown>,
    rebuild: () => Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  ): Promise<{ messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; maxOutputTokens: number }> {
    const contextWindow = this.host.getContextWindow();
    const modelCaps = this.host.getActiveModelCaps();
    let messages = aiMessages;
    for (let attempt = 0; attempt < 3; attempt++) {
      const estimatedInput = this.estimateTurnInputTokens(messages, tools);
      try {
        const maxOutputTokens = resolveEffectiveMaxOutputTokens({
          configured: this.host.config.maxOutputTokens,
          contextWindow,
          estimatedInputTokens: estimatedInput,
          modelCaps,
        });
        getLogger().info(
          'AGENT',
          `Prompt budget: ~${estimatedInput} input / ${contextWindow} window → maxOutput=${maxOutputTokens}`,
        );
        return { messages, maxOutputTokens };
      } catch (error) {
        if (!(error instanceof ContextBudgetExceededError) || attempt >= 2) throw error;
        getLogger().warn('AGENT', `Prompt too large (~${estimatedInput} tokens) — compacting before LLM call`);
        const compacted = await this.host.compactContext(estimatedInput);
        if (!compacted) throw error;
        messages = rebuild();
      }
    }
    throw new ContextBudgetExceededError(this.estimateTurnInputTokens(messages, tools), contextWindow);
  }

  private modelMessageContentToText(content: unknown): string {
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

  private estimateToolSchemaChars(tools: Record<string, unknown>): number {
    let chars = 0;
    for (const name of Object.keys(tools)) {
      const t = tools[name] as { description?: string; inputSchema?: unknown } | undefined;
      chars += JSON.stringify({ description: t?.description, inputSchema: t?.inputSchema }).length;
    }
    return chars;
  }

  private estimateTurnInputTokens(
    messages: Array<{ content: string }>,
    tools: Record<string, unknown>,
  ): number {
    return estimatePromptTokens(
      messages,
      Object.keys(tools).length,
      this.estimateToolSchemaChars(tools),
    );
  }
}
