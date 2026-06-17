import { streamText, stepCountIs } from 'ai';
import type { EngineEvent, AgentXConfig, SessionEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { SessionStore } from './SessionStore.js';
import { createAiSdkModel, createAiSdkTools } from '../agent/AiSdkBridge.js';
import { createAiSdkStreamHandler, type GitDiffProvider } from '../agent/AiSdkStreamHandler.js';
import { SessionRunCoordinator, type RunState } from './SessionRunCoordinator.js';

export interface SessionRunnerOptions {
  sessionId: string;
  config: AgentXConfig;
  eventBus: AgentEventBus;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  sessionStore?: SessionStore;
  apiKey?: string;
  waitForClarification?: (question: string, options: string[], allowFreeform: boolean) => Promise<string>;
  runSubAgent?: (instruction: string, tools: string[] | undefined, timeout: number) => Promise<{ success: boolean; output: string; elapsed: number }>;
  onTokenUsage?: (input: number, output: number) => void;
  onBackgroundTask?: (taskId: string, result: string) => void;
  gitManager?: GitDiffProvider;
  onSessionEvent?: (event: SessionEvent) => void;
  modelName?: string;
  maxSteps?: number;
}

export class SessionRunner {
  private coordinator: SessionRunCoordinator = new SessionRunCoordinator();
  private options: SessionRunnerOptions;
  private stepCount = 0;
  private maxSteps = 25;

  constructor(options: SessionRunnerOptions) {
    this.options = options;
    this.maxSteps = options.maxSteps ?? 25;
  }

  get runState(): RunState {
    return this.coordinator.currentState;
  }

  async run(messages: Array<{ role: string; content: string }>, onEvent: (event: EngineEvent) => void): Promise<string> {
    return this.coordinator.run(this.options.sessionId, async () => {
      return this.drain(messages, onEvent);
    });
  }

  private async drain(messages: Array<{ role: string; content: string }>, onEvent: (event: EngineEvent) => void): Promise<string> {
    const { sessionId, config, toolRegistry, toolExecutor, sessionStore, apiKey } = this.options;
    const emit = onEvent;
    const aiMessages = [...messages];
    this.stepCount = 0;

    const waitForClarification = this.options.waitForClarification ?? (async () => '');
    const runSubAgent = this.options.runSubAgent ?? (async () => ({ success: false as const, output: 'not available', elapsed: 0 }));
    const onTokenUsage = this.options.onTokenUsage ?? (() => {});

    while (this.stepCount < this.maxSteps) {
      this.stepCount++;

      if (sessionStore) {
        sessionStore.insertSessionEvent({
          id: crypto.randomUUID(),
          sessionId: sessionId,
          sequence: this.stepCount,
          type: 'step_started',
          payload: JSON.stringify({ step: this.stepCount }),
          created_at: new Date().toISOString(),
        } as any);
      }

      const tools = createAiSdkTools(
        toolRegistry,
        toolExecutor,
        sessionId,
        emit,
        waitForClarification,
        runSubAgent,
      );

      const model = createAiSdkModel(config, apiKey);
      const contextWindow = (config as unknown as Record<string, number>)['contextWindow'] ?? 128000;

      const streamHandler = createAiSdkStreamHandler(
        emit,
        sessionId,
        onTokenUsage,
        undefined,
        this.options.modelName,
        this.options.gitManager,
        this.options.onSessionEvent,
        contextWindow,
      );

      const result = streamText({
        model,
        messages: aiMessages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
        tools,
        temperature: 0,
        stopWhen: stepCountIs(1),
      });

      let toolCallCount = 0;
      for await (const chunk of result.fullStream) {
        streamHandler.handleEvent(chunk);
        if (chunk.type === 'tool-call') {
          toolCallCount++;
        }
      }

      const state = streamHandler.getState();
      const content = state.accumulatedContent || '';

      if (sessionStore) {
        let usageResult: { inputTokens?: number; outputTokens?: number } | null = null;
        try {
          usageResult = await result.usage;
        } catch {
          // usage unavailable
        }
        sessionStore.insertSessionEvent({
          id: crypto.randomUUID(),
          sessionId: sessionId,
          sequence: this.stepCount + 1000,
          type: 'step_ended',
          payload: JSON.stringify({
            step: this.stepCount,
            usage: usageResult ? { inputTokens: usageResult.inputTokens || 0, outputTokens: usageResult.outputTokens || 0 } : undefined,
          }),
          created_at: new Date().toISOString(),
        } as any);
      }

      if (toolCallCount === 0) {
        return content;
      }

      aiMessages.push({ role: 'assistant', content });

      if (sessionStore) {
        sessionStore.insertSessionEvent({
          id: crypto.randomUUID(),
          sessionId: sessionId,
          sequence: this.stepCount + 2000,
          type: 'finish',
          payload: JSON.stringify({ content: content.slice(0, 100) }),
          created_at: new Date().toISOString(),
        } as any);
      }
    }

    return 'Max steps reached';
  }

  interrupt(): void {
    this.coordinator.interrupt();
  }
}
