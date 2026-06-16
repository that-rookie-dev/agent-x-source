import type { EngineEvent, Message, SessionEvent } from '@agentx/shared';
import { generateMessageId } from '@agentx/shared';

interface PartRecord {
  type: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolSuccess?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  timestamp: number;
}

interface StreamState {
  accumulatedContent: string;
  accumulatedReasoning: string;
  stepCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  stepSnapshots: Array<{ step: number; hash: string }>;
  modelName: string;
  toolCallCount: number;
}

export type PartPersistFn = (sessionId: string, part: PartRecord) => void;

export interface GitDiffProvider {
  snapshot(): string | null;
  diff(fromHash?: string): string | null;
}

export function createAiSdkStreamHandler(
  emit: (event: EngineEvent) => void,
  sessionId: string,
  onTokenUsage: (input: number, output: number) => void,
  onPart?: PartPersistFn,
  modelName?: string,
  gitManager?: GitDiffProvider,
  onSessionEvent?: (event: SessionEvent) => void,
  contextWindow?: number,
) {
  const state: StreamState = {
    accumulatedContent: '',
    accumulatedReasoning: '',
    stepCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    stepSnapshots: [],
    modelName: modelName || '',
    toolCallCount: 0,
  };

  let sequence = 0;
  const warnings70 = { emitted: false };
  const warnings85 = { emitted: false };
  const warnings95 = { emitted: false };

  const streamStartTime = Date.now();

  function checkContextWarning(totalTokens: number): void {
    if (!contextWindow || contextWindow <= 0) return;
    const percentage = (totalTokens / contextWindow) * 100;
    if (percentage >= 95 && !warnings95.emitted) {
      warnings95.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 95, percentage: Math.round(percentage) } as unknown as EngineEvent);
    } else if (percentage >= 85 && !warnings85.emitted) {
      warnings85.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 85, percentage: Math.round(percentage) } as unknown as EngineEvent);
    } else if (percentage >= 70 && !warnings70.emitted) {
      warnings70.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 70, percentage: Math.round(percentage) } as unknown as EngineEvent);
    }
  }

  function persist(part: PartRecord) {
    onPart?.(sessionId, part);
  }

  function handleEvent(event: any) {
    switch (event.type) {
      case 'start': {
        emit({ type: 'loading_start', stage: 'thinking' });
        break;
      }

      case 'step-start': {
        state.stepCount++;
        if (state.stepCount > 1) {
          emit({ type: 'loading_start', stage: 'tool_execution' });
        }
        const snapshot = gitManager?.snapshot();
        if (snapshot) {
          state.stepSnapshots.push({ step: state.stepCount, hash: snapshot });
        }
        persist({ type: 'step-start', timestamp: Date.now() });
        onSessionEvent?.({ type: 'step_started', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { step: state.stepCount } });
        break;
      }

      case 'text-start': {
        persist({ type: 'text-start', timestamp: Date.now() });
        break;
      }

      case 'text-delta': {
        const delta = (event.textDelta as string) || (event.text as string) || '';
        state.accumulatedContent += delta;
        persist({ type: 'text-delta', content: delta, timestamp: Date.now() });
        emit({ type: 'stream_chunk', content: delta, fullContent: state.accumulatedContent });
        onSessionEvent?.({ type: 'text_delta', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { content: delta, fullContent: state.accumulatedContent } });
        const total = state.totalInputTokens + state.totalOutputTokens;
        checkContextWarning(total);
        break;
      }

      case 'text-end': {
        persist({ type: 'text-end', timestamp: Date.now() });
        break;
      }

      case 'reasoning-start': break;
      case 'reasoning-end': break;

      case 'reasoning-delta': {
        const delta = event.text as string || '';
        state.accumulatedReasoning += delta;
        persist({ type: 'reasoning-delta', content: delta, timestamp: Date.now() });
        emit({ type: 'reasoning_delta', content: delta } as unknown as EngineEvent);
        break;
      }

      case 'tool-input-start':
      case 'tool-input-delta':
      case 'tool-input-end': break;

      case 'tool-call': {
        state.toolCallCount++;
        persist({
          type: 'tool-call',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolArgs: event.args,
          timestamp: Date.now(),
        });
        onSessionEvent?.({ type: 'tool_called', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: event.toolName, callId: event.toolCallId, args: event.args } });
        emit({ type: 'tool_executing', tool: event.toolName, description: `Calling ${event.toolName}`, startTime: Date.now(), callId: event.toolCallId });
        break;
      }

      case 'tool-result': {
        persist({
          type: 'tool-result',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolResult: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          toolSuccess: true,
          timestamp: Date.now(),
        });
        const output = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        onSessionEvent?.({ type: 'tool_result', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: event.toolName, callId: event.toolCallId, success: true, output, elapsed: 0 } });
        emit({ type: 'tool_complete', tool: event.toolName, result: { success: true, output }, elapsed: 0, callId: event.toolCallId });
        const total = state.totalInputTokens + state.totalOutputTokens;
        checkContextWarning(total);
        break;
      }

      case 'step-finish': {
        const usage = event.usage;
        if (usage) {
          state.totalInputTokens += usage.inputTokens || 0;
          state.totalOutputTokens += usage.outputTokens || 0;
          const total = state.totalInputTokens + state.totalOutputTokens;
          emit({ type: 'token_usage', totalTokens: total, contextWindow: 128000, turnTokens: total } as unknown as EngineEvent);
          onTokenUsage(state.totalInputTokens, state.totalOutputTokens);
          checkContextWarning(total);
        }
        const lastSnapshot = state.stepSnapshots.length > 0 ? state.stepSnapshots[state.stepSnapshots.length - 1] : undefined;
        if (lastSnapshot && gitManager) {
          const diffText = gitManager.diff(lastSnapshot.hash);
          if (diffText) {
            const files = [...new Set((diffText.match(/^diff --git a\/(.+?) b\//gm) || []).map(l => l.replace('diff --git a/', '').replace(/ b\/.*/, '')))];
            if (files.length > 0) {
              emit({
                type: 'diff_preview',
                tool: 'step',
                filePath: files[0] || '',
                diff: diffText.slice(0, 5000),
              } as unknown as EngineEvent);
            }
          }
        }
        persist({ type: 'step-finish', usage: usage ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } : undefined, timestamp: Date.now() });
        emit({ type: 'loading_end' });
        onSessionEvent?.({ type: 'step_ended', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { step: state.stepCount, usage: usage ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } : undefined } });
        break;
      }

      case 'finish': {
        const usage = event.usage;
        if (usage) {
          state.totalInputTokens += usage.totalInputTokens || 0;
          state.totalOutputTokens += usage.totalOutputTokens || 0;
        }
        const totalTokens = state.totalInputTokens + state.totalOutputTokens;
        const elapsed = Date.now() - streamStartTime;

        persist({
          type: 'finish',
          usage: usage ? { inputTokens: state.totalInputTokens, outputTokens: state.totalOutputTokens } : undefined,
          timestamp: Date.now(),
        });

        const assistantMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content: state.accumulatedContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: totalTokens,
        };

        emit({
          type: 'message_received',
          message: assistantMessage,
          elapsed,
        });

        onSessionEvent?.({ type: 'finish', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { content: state.accumulatedContent, usage: usage ? { inputTokens: state.totalInputTokens, outputTokens: state.totalOutputTokens } : undefined } });
        break;
      }

      case 'error': {
        persist({ type: 'error', content: String(event.error || 'Unknown error'), timestamp: Date.now() });
        emit({ type: 'error', code: 'AI_SDK_ERROR', message: String(event.error || 'Unknown error'), recoverable: false });
        onSessionEvent?.({ type: 'error', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { code: 'AI_SDK_ERROR', message: String(event.error || 'Unknown error') } });
        break;
      }

      case 'abort': {
        persist({ type: 'abort', timestamp: Date.now() });
        onSessionEvent?.({ type: 'abort', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { reason: 'Stream aborted' } });
        break;
      }
    }
  }

  return {
    handleEvent,
    getState: () => state,
    reset: () => {
      state.accumulatedContent = '';
      state.accumulatedReasoning = '';
      state.stepCount = 0;
      state.toolCallCount = 0;
    },
  };
}

export type { PartRecord, StreamState };
