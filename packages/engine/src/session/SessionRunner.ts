import { streamText, stepCountIs, type ModelMessage } from 'ai';
import type { EngineEvent, AgentXConfig, SessionEvent } from '@agentx/shared';
import { getLogger, resolveMaxOutputTokens } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import { createAiSdkModel, createAiSdkTools } from '../agent/AiSdkBridge.js';
import { normalizeAiSdkMessagesForProvider } from '../agent/context-profile.js';
import { createAiSdkStreamHandler, type GitDiffProvider } from '../agent/AiSdkStreamHandler.js';
import { SessionRunCoordinator, type RunState } from './SessionRunCoordinator.js';

export interface SessionRunnerOptions {
  sessionId: string;
  config: AgentXConfig;
  eventBus: AgentEventBus;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  apiKey?: string;
  waitForClarification?: (questionnaire: import('@agentx/shared').QuestionnairePayload) => Promise<string>;
  runSubAgent?: (instruction: string, tools: string[] | undefined, timeout: number, background?: boolean) => Promise<{ success: boolean; output: string; elapsed: number; agentId?: string }>;
  onTokenUsage?: (input: number, output: number) => void;
  onBackgroundTask?: (taskId: string, result: string) => void;
  gitManager?: GitDiffProvider;
  onSessionEvent?: (event: SessionEvent) => void;
  modelName?: string;
  maxSteps?: number;
  /** If provided, collect tool call/result entries for the agent's reflection loop */
  toolCallLog?: Array<{ name: string; success: boolean; output: string; elapsed: number }>;
}

interface ToolResultMessage {
  role: 'tool';
  content: string;
  toolCallId: string;
}

export class SessionRunner {
  private coordinator: SessionRunCoordinator = new SessionRunCoordinator();
  private options: SessionRunnerOptions;
  private maxSteps = 50;

  constructor(options: SessionRunnerOptions) {
    this.options = options;
    this.maxSteps = options.maxSteps ?? 50;
  }

  get runState(): RunState {
    return this.coordinator.currentState;
  }

  async run(messages: Array<{ role: string; content: string }>, onEvent: (event: EngineEvent) => void, abortSignal?: AbortSignal): Promise<string> {
    return this.coordinator.run(this.options.sessionId, async () => {
      return this.drain(messages, onEvent, abortSignal);
    });
  }

  private async drain(messages: Array<{ role: string; content: string }>, onEvent: (event: EngineEvent) => void, abortSignal?: AbortSignal): Promise<string> {
    const { sessionId, config, toolRegistry, toolExecutor, apiKey } = this.options;
    const emit = onEvent;
    const aiMessages: Array<{ role: string; content: string; toolCallId?: string }> = [...messages];
    let stepCount = 0;

    const waitForClarification = this.options.waitForClarification ?? (async () => '');
    const runSubAgent = this.options.runSubAgent ?? (async () => ({ success: false as const, output: 'not available', elapsed: 0 }));
    const onTokenUsage = this.options.onTokenUsage ?? (() => {});
    const toolCallLog = this.options.toolCallLog;
    let consecutiveDoomLoops = 0;
    const MAX_DOOM_LOOPS = 3;

    while (stepCount < this.maxSteps) {
      stepCount++;

      emit({ type: 'step_started', step: stepCount } as unknown as EngineEvent);

      const tools = createAiSdkTools(toolRegistry, toolExecutor, sessionId, emit, waitForClarification, runSubAgent);
      const model = createAiSdkModel(config, apiKey);
      const contextWindow = (config as unknown as Record<string, number>)['contextWindow'] ?? 128000;

      const streamHandler = createAiSdkStreamHandler(
        emit, sessionId, onTokenUsage, undefined,
        this.options.modelName, this.options.gitManager,
        this.options.onSessionEvent, contextWindow,
      );

      try {
        const result = streamText({
          model,
          messages: normalizeAiSdkMessagesForProvider(aiMessages, config.provider.activeProvider).map(m => ({
            role: m.role as 'system' | 'user' | 'assistant' | 'tool',
            content: m.content,
            ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
          })) as ModelMessage[],
          tools,
          temperature: 0,
          maxRetries: config.maxRetries ?? 2,
          maxOutputTokens: resolveMaxOutputTokens(config.maxOutputTokens),
          stopWhen: stepCountIs(100),
          toolChoice: 'auto',
          abortSignal,
        });

        const toolResults: ToolResultMessage[] = [];
        let toolCallCount = 0;

        for await (const chunk of result.fullStream) {
          streamHandler.handleEvent(chunk);
          if (chunk.type === 'tool-call') {
            toolCallCount++;
            toolCallLog?.push({ name: chunk.toolName, success: false, output: '', elapsed: 0 });
          }
          if (chunk.type === 'tool-result') {
            const output = typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output);
            toolResults.push({ role: 'tool', content: output, toolCallId: chunk.toolCallId });
            const entry = toolCallLog?.findLast(l => !l.success);
            if (entry) {
              entry.success = true;
              entry.output = output.slice(0, 2000);
            }
          }
        }

        // Check for doom loop: 3+ consecutive tool results with DOOM_LOOP
        const hasDoomLoop = toolResults.some(t => /doom.?loop/i.test(t.content));
        if (hasDoomLoop) {
          consecutiveDoomLoops++;
        } else {
          consecutiveDoomLoops = 0;
        }
        if (consecutiveDoomLoops >= MAX_DOOM_LOOPS) {
          getLogger().warn('SESSION_RUNNER', `Doom loop detected (${consecutiveDoomLoops}x). Breaking out.`);
          return 'The tool execution entered a repetitive loop. Please rephrase your request or try a different approach.';
        }

        const state = streamHandler.getState();
        const content = state.accumulatedContent || '';

        emit({ type: 'step_ended', step: stepCount } as unknown as EngineEvent);

        if (toolCallCount === 0) {
          return content;
        }

        aiMessages.push({ role: 'assistant', content });
        aiMessages.push(...toolResults);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        if (error instanceof Error && error.name === 'NoOutputGeneratedError') {
          getLogger().warn('SESSION_RUNNER', `Step ${stepCount}: NoOutputGeneratedError. Continuing loop.`);
          const state = streamHandler.getState();
          const content = state.accumulatedContent || '';
          if (content) {
            aiMessages.push({ role: 'assistant', content });
          }
          continue;
        }
        getLogger().error('SESSION_RUNNER', `Step ${stepCount} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    getLogger().warn('SESSION_RUNNER', `Max steps (${this.maxSteps}) reached. Returning accumulated content.`);
    return 'Max steps reached — the task may not be fully complete.';
  }

  interrupt(): void {
    this.coordinator.interrupt();
  }
}
