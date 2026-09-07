import type { EngineEvent, Message, SessionEvent } from '@agentx/shared';
import { generateMessageId, appendStreamText, extractStreamTextDelta, estimateTokens, getOutputReserve } from '@agentx/shared';

interface PartRecord {
  type: string;
  messageId?: string;
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
  stepTextStartLength: number;
  clarificationUsed: boolean;
  /** Finish had no user-visible text — Agent owns empty-retry / promote before message_received. */
  deferredEmptyFinalize: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  promptCharEstimate: number;
  stepSnapshots: Array<{ step: number; hash: string }>;
  modelName: string;
  toolCallCount: number;
  toolExecutions: Array<{ tool: string; success: boolean; output: string; elapsed: number }>;
}

interface StreamEventUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

interface StreamEvent {
  type: string;
  text?: string;
  args?: Record<string, unknown>;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  usage?: StreamEventUsage;
  error?: unknown;
  tool?: string;
  elapsed?: number;
  [key: string]: unknown;
}

export type PartPersistFn = (sessionId: string, part: PartRecord) => void;

export interface GitDiffProvider {
  snapshot(): string | null;
  diff(fromHash?: string): string | null;
}

// ─── Helper: Emit detailed operation events for UI visualization ───
function emitDetailedOperationEvent(emit: (event: EngineEvent) => void, toolName: string, output: string): void {
  try {
    // Try to parse output as JSON for structured operations
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(output) as Record<string, unknown>;
    } catch {
      // If not JSON, treat as string result
      result = { raw: output };
    }

    // Helpers to safely extract typed values from the parsed record
    const getStr = (...keys: string[]): string => {
      for (const k of keys) {
        const v = result[k];
        if (typeof v === 'string') return v;
      }
      return '';
    };
    const getArr = <T,>(...keys: string[]): T[] => {
      for (const k of keys) {
        const v = result[k];
        if (Array.isArray(v)) return v as T[];
      }
      return [];
    };

    // File Create/Write Operations
    if (toolName === 'file_write' || toolName === 'write_file' || toolName === 'WriteFile') {
      const filePath = getStr('path', 'filePath');
      const rawContent = result['content'];
      const content = typeof rawContent === 'string' ? rawContent : output;
      emit({
        type: 'operation_file_created',
        filePath,
        content: content.slice(0, 10000), // Limit size for streaming
        language: detectLanguage(filePath),
      });
    }

    // File Read Operations
    if (toolName === 'file_read' || toolName === 'read_file' || toolName === 'ReadFile' || toolName === 'read' || toolName === 'cat') {
      const filePath = getStr('path', 'filePath');
      const rawContent = result['content'];
      const content = typeof rawContent === 'string' ? rawContent : output;
      emit({
        type: 'operation_file_read',
        filePath,
        content: content.slice(0, 5000),
        language: detectLanguage(filePath),
      });
    }

    // File Edit Operations  
    if (toolName === 'file_patch' || toolName === 'code_replace' || toolName === 'code_insert' ||
        toolName === 'file_edit' || toolName === 'apply_patch' ||
        toolName === 'edit_file' || toolName === 'EditFile' || toolName === 'replace_file_section') {
      const filePath = getStr('path', 'filePath');
      const oldContent = getStr('oldContent');
      const newContent = getStr('newContent');
      const diff = getStr('diff');
      emit({
        type: 'operation_file_edited',
        filePath,
        oldContent: oldContent.slice(0, 3000),
        newContent: newContent.slice(0, 3000),
        diff: diff.slice(0, 5000),
        changes: result['changes'],
      });
    }

    // Glob/Search Operations
    if (toolName === 'glob' || toolName === 'Glob' || toolName === 'search_files' || toolName === 'code_search') {
      const pattern = getStr('pattern', 'glob');
      const directory = getStr('directory', 'dir', 'cwd');
      const matches = getArr<string>('matches', 'files');
      const finalMatches = matches.length > 0
        ? matches
        : output.split('\n').filter(line => line.trim());
      
      emit({
        type: 'operation_search_glob',
        pattern,
        directory,
        matchCount: finalMatches.length,
        matches: finalMatches.slice(0, 50), // First 50 matches
      });
    }

    // Grep/Search in Files
    if (toolName === 'grep' || toolName === 'Grep' || toolName === 'search_in_files' || toolName === 'code_references') {
      const pattern = getStr('pattern', 'keyword', 'query');
      const directory = getStr('directory', 'dir');
      const matches = getArr<unknown>('matches', 'results');
      
      emit({
        type: 'operation_search_grep',
        pattern,
        directory,
        matchCount: matches.length,
        matches: matches.slice(0, 30),
      });
    }

    // Directory/File Listing
    if (toolName === 'folder_list' || toolName === 'list_dir' || toolName === 'ls' || toolName === 'list_files' || toolName === 'ListFiles') {
      const directory = getStr('directory', 'path');
      const files = getArr<string>('files', 'entries');
      const finalFiles = files.length > 0
        ? files
        : output.split('\n').filter(line => line.trim());
      
      emit({
        type: 'operation_list_files',
        directory,
        fileCount: finalFiles.length,
        files: finalFiles.slice(0, 50),
      });
    }

    // Command Execution
    if (toolName === 'shell_exec' || toolName === 'shell_exec_streaming' || toolName === 'shell_background' ||
        toolName === 'execute' || toolName === 'run_command' || toolName === 'bash') {
      const command = getStr('command', 'cmd');
      const rawStdout = result['stdout'];
      const stdout = typeof rawStdout === 'string' ? rawStdout : (typeof result['output'] === 'string' ? result['output'] as string : output);
      const stderr = getStr('stderr');
      
      emit({
        type: 'operation_command_executed',
        command,
        success: result['success'] !== false && !stderr,
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 1000),
      });
    }
  } catch (e) {
    // Silently ignore parsing errors - don't block main flow
    console.debug('[OPERATION_EVENT] Parse error:', e);
  }
}

// ─── Helper: Detect language from file extension ───
function detectLanguage(filePath: string): string {
  const ext = filePath?.split('.')?.pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    cpp: 'cpp', c: 'c', cs: 'csharp', php: 'php', swift: 'swift',
    kt: 'kotlin', scala: 'scala', sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
    html: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
  };
  return languageMap[ext] || ext || 'text';
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
  promptCharEstimate = 0,
  sessionInputBaseline = 0,
  sessionOutputBaseline = 0,
  voiceMerge?: { messageId: string; prefixContent: string },
) {
  const state: StreamState = {
    accumulatedContent: '',
    accumulatedReasoning: '',
    stepCount: 0,
    stepTextStartLength: 0,
    clarificationUsed: false,
    deferredEmptyFinalize: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    promptCharEstimate,
    stepSnapshots: [],
    modelName: modelName || '',
    toolCallCount: 0,
    toolExecutions: [],
  };

  const messageId = generateMessageId();

  const ctxWindow = contextWindow && contextWindow > 0 ? contextWindow : 128_000;

  const applyTokenDelta = (deltaIn: number, deltaOut: number) => {
    if (deltaIn + deltaOut <= 0) return;
    state.totalInputTokens += deltaIn;
    state.totalOutputTokens += deltaOut;
    const inputTokens = sessionInputBaseline + state.totalInputTokens;
    const outputTokens = sessionOutputBaseline + state.totalOutputTokens;
    const reservedTokens = getOutputReserve(ctxWindow);
    const total = inputTokens + outputTokens + reservedTokens;
    emit({
      type: 'token_usage',
      totalTokens: total,
      contextWindow: ctxWindow,
      turnTokens: deltaIn + deltaOut,
      inputTokens,
      outputTokens,
      reservedTokens,
      streamingTokens: 0,
      estimated: false,
    });
    onTokenUsage(deltaIn, deltaOut);
    checkContextWarning(inputTokens + outputTokens);
  };

  let sequence = 0;
  const warnings70 = { emitted: false };
  const warnings85 = { emitted: false };
  const warnings95 = { emitted: false };
  let lastStreamTokenEmit = 0;
  const STREAM_TOKEN_EMIT_MS = 80;

  const emitStreamingTokenEstimate = () => {
    const now = Date.now();
    if (now - lastStreamTokenEmit < STREAM_TOKEN_EMIT_MS) return;
    lastStreamTokenEmit = now;
    const streamingOut = estimateTokens(state.accumulatedContent);
    const inputTokens = sessionInputBaseline + state.totalInputTokens;
    const outputTokens = sessionOutputBaseline + state.totalOutputTokens;
    const reservedTokens = getOutputReserve(ctxWindow);
    const displayTotal = inputTokens + outputTokens + streamingOut + reservedTokens;
    emit({
      type: 'token_usage',
      totalTokens: displayTotal,
      contextWindow: ctxWindow,
      turnTokens: streamingOut,
      inputTokens,
      outputTokens,
      reservedTokens,
      streamingTokens: streamingOut,
      estimated: true,
    });
    checkContextWarning(inputTokens + outputTokens + streamingOut);
  };

  const streamStartTime = Date.now();

  function checkContextWarning(totalTokens: number): void {
    if (!ctxWindow || ctxWindow <= 0) return;
    const percentage = (totalTokens / ctxWindow) * 100;
    if (percentage >= 95 && !warnings95.emitted) {
      warnings95.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 95, percentage: Math.round(percentage) });
    } else if (percentage >= 85 && !warnings85.emitted) {
      warnings85.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 85, percentage: Math.round(percentage) });
    } else if (percentage >= 70 && !warnings70.emitted) {
      warnings70.emitted = true;
      emit({ type: 'context_warning', currentTokens: totalTokens, threshold: 70, percentage: Math.round(percentage) });
    }
  }

  function persist(part: PartRecord) {
    onPart?.(sessionId, { ...part, messageId: part.messageId || messageId });
  }

   function handleEvent(event: StreamEvent) {
     try {
       if (!event) {
         console.warn('[AI_SDK_HANDLER] Received null/undefined event');
         return;
       }
       if (!event.type) {
         console.warn('[AI_SDK_HANDLER] Event missing type property:', event);
         return;
       }

       switch (event.type) {
      case 'start': {
        emit({ type: 'loading_start', stage: 'thinking', message: 'Thinking...' });
        break;
      }

        case 'step-start': {
          state.stepCount++;
          state.stepTextStartLength = state.accumulatedContent.length;
          if (state.stepCount > 1) {
            emit({ type: 'loading_start', stage: 'tool_execution', message: 'Executing...' });
          }
          const snapshot = gitManager?.snapshot();
          if (snapshot) {
            state.stepSnapshots.push({ step: state.stepCount, hash: snapshot });
          }
          persist({ type: 'step-start', timestamp: Date.now() });
          onSessionEvent?.({ type: 'step_started', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { step: state.stepCount } });
          
          // ─── Enhanced: Emit step indicator for UI ───
          emit({
            type: 'step_indicator',
            step: state.stepCount,
            totalSteps: 'unknown',
            stage: state.stepCount === 1 ? 'thinking' : 'execution',
          });
          break;
        }

      case 'text-start': {
        persist({ type: 'text-start', timestamp: Date.now() });
        const inputTokens = sessionInputBaseline + state.totalInputTokens;
        const outputTokens = sessionOutputBaseline + state.totalOutputTokens;
        const reservedTokens = getOutputReserve(ctxWindow);
        emit({
          type: 'token_usage',
          totalTokens: inputTokens + outputTokens + reservedTokens,
          contextWindow: ctxWindow,
          inputTokens,
          outputTokens,
          reservedTokens,
          streamingTokens: 0,
          estimated: true,
        });
        break;
      }

      case 'text-delta': {
        const delta = extractStreamTextDelta(event);
        state.accumulatedContent = appendStreamText(state.accumulatedContent, delta);
        persist({ type: 'text-delta', content: delta, timestamp: Date.now() });
        emit({ type: 'stream_chunk', content: delta, fullContent: state.accumulatedContent });
        onSessionEvent?.({ type: 'text_delta', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { content: delta } });
        emitStreamingTokenEstimate();
        break;
      }

      case 'text-end': {
        persist({ type: 'text-end', timestamp: Date.now() });
        break;
      }

      case 'reasoning-start': break;

      case 'reasoning-end': {
        emit({ type: 'reasoning_end' });
        break;
      }

      case 'reasoning-delta': {
        // AI SDK fullStream uses `text`; provider protocol uses `delta`.
        const delta = extractStreamTextDelta(event as Record<string, unknown>);
        if (!delta) break;
        state.accumulatedReasoning = appendStreamText(state.accumulatedReasoning, delta);
        persist({ type: 'reasoning-delta', content: delta, timestamp: Date.now() });
        emit({ type: 'reasoning_delta', content: delta });
        emit({
          type: 'agent_thinking',
          content: delta,
          fullThought: state.accumulatedReasoning,
          agent: 'primary',
        });
        break;
      }

      case 'tool-input-start':
      case 'tool-input-delta':
      case 'tool-input-end': break;

        case 'tool-call': {
          try {
            state.toolCallCount++;
            const args = event.args || {};
            const toolName = event.toolName || 'unknown-tool';
            const toolCallId = event.toolCallId || 'unknown-id';
            persist({
              type: 'tool-call',
              toolName,
              toolCallId,
              toolArgs: args,
              timestamp: Date.now(),
            });

            // Emit tool_executing so the UI shows the tool running during live stream.
            // Without this, tool activity only appears after a hard-refresh (from DB parts).
            emit({
              type: 'tool_executing',
              tool: toolName,
              description: `Executing ${toolName}`,
              startTime: Date.now(),
              args,
              callId: toolCallId,
            });

            onSessionEvent?.({ type: 'tool_called', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: toolName, callId: toolCallId, args } });
          } catch (e) {
            console.error('[AI_SDK_HANDLER] Error processing tool-call event:', e, 'event:', event);
            emit({ type: 'error', code: 'TOOL_CALL_HANDLER_ERROR', message: `Failed to process tool call: ${String(e)}`, recoverable: true });
          }
          break;
        }

        case 'tool-result': {
          try {
            const toolName = event.toolName || 'unknown-tool';
            const toolCallId = event.toolCallId || 'unknown-id';
            let output = '';

            if (event.result === null || event.result === undefined) {
              output = '(no output)';
            } else if (typeof event.result === 'string') {
              output = event.result;
            } else {
              output = JSON.stringify(event.result);
            }

            persist({
              type: 'tool-result',
              toolName,
              toolCallId,
              toolResult: output,
              toolSuccess: true,
              timestamp: Date.now(),
            });

            // Emit tool_complete so the UI shows the tool result during live stream.
            // Without this, tool results only appear after a hard-refresh (from DB parts).
            emit({
              type: 'tool_complete',
              tool: toolName,
              result: { success: true, output },
              elapsed: 0,
              args: {},
              callId: toolCallId,
            });

            onSessionEvent?.({ type: 'tool_result', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: toolName, callId: toolCallId, success: true, output, elapsed: 0 } });

            // ─── Enhanced: Emit detailed operation events for specific tools ───
            emitDetailedOperationEvent(emit, toolName, output);

            const total = state.totalInputTokens + state.totalOutputTokens;
            checkContextWarning(total);
          } catch (e) {
            console.error('[AI_SDK_HANDLER] Error processing tool-result event:', e, 'event:', event);
            emit({ type: 'error', code: 'TOOL_RESULT_HANDLER_ERROR', message: `Failed to process tool result: ${String(e)}`, recoverable: true });
          }
          break;
        }

       case 'step-finish': {
         const usage = event.usage;
         if (usage) {
           applyTokenDelta(usage.inputTokens || 0, usage.outputTokens || 0);
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
               });
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
        if (state.totalInputTokens + state.totalOutputTokens === 0) {
          if (usage) {
            const inTok = usage.totalInputTokens ?? usage.inputTokens ?? 0;
            const outTok = usage.totalOutputTokens ?? usage.outputTokens ?? 0;
            applyTokenDelta(inTok, outTok);
          } else {
            const outEst = Math.ceil((state.accumulatedContent || '').length / 4);
            const inEst = Math.ceil(state.promptCharEstimate / 4);
            applyTokenDelta(inEst, outEst);
          }
        }
        const totalTokens = state.totalInputTokens + state.totalOutputTokens;
        const elapsed = Date.now() - streamStartTime;

        persist({
          type: 'finish',
          usage: usage ? { inputTokens: state.totalInputTokens, outputTokens: state.totalOutputTokens } : undefined,
          timestamp: Date.now(),
        });

        const trimmedContent = (state.accumulatedContent || '').trim();
        // Questionnaire-only turns: skip empty recap bubbles after ask_clarification steps
        if (state.clarificationUsed && !trimmedContent) {
          emit({ type: 'completion_finished', message: 'Thought.' });
          break;
        }

        // Reasoning-only / empty text: do NOT publish the apology yet. Agent empty-retry
        // (and reasoning promotion) must run first; otherwise message_received locks the
        // UI on the fallback and _turnMessageEmitted blocks a real reply.
        if (!trimmedContent) {
          state.deferredEmptyFinalize = true;
          emit({ type: 'completion_finished', message: 'Thought.' });
          onSessionEvent?.({
            type: 'finish',
            sessionId,
            sequence: ++sequence,
            timestamp: Date.now(),
            payload: {
              content: '',
              usage: usage
                ? { inputTokens: state.totalInputTokens, outputTokens: state.totalOutputTokens }
                : undefined,
            },
          });
          break;
        }

        state.deferredEmptyFinalize = false;
        let finalContent = trimmedContent;
        let outMessageId = messageId;
        let isUpdate = false;
        if (voiceMerge) {
          outMessageId = voiceMerge.messageId;
          const phase2Body = finalContent.replace(/⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi, '').trim();
          const prefix = voiceMerge.prefixContent.trim();
          finalContent = phase2Body ? `${prefix}\n\n${phase2Body}` : prefix;
          isUpdate = true;
        }

        const assistantMessage: Message = {
          id: outMessageId,
          sessionId,
          role: 'assistant',
          content: finalContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: totalTokens,
        };

        // Emit a terminal stream_chunk so the UI can flush coalesced text before
        // message_received freezes parts[]. Empty delta — fullContent is authoritative.
        emit({ type: 'stream_chunk', content: '', fullContent: finalContent });

        // Emit completion signal before message_received
        emit({ type: 'completion_finished', message: 'Thought.' });
        
        emit({
          type: 'message_received',
          message: assistantMessage,
          elapsed,
          ...(isUpdate ? { isUpdate: true } : {}),
        });

        onSessionEvent?.({ type: 'finish', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { content: state.accumulatedContent, usage: usage ? { inputTokens: state.totalInputTokens, outputTokens: state.totalOutputTokens } : undefined } });
        break;
      }

       case 'error': {
         const errorMessage = String(event.error || 'Unknown error');
         persist({ type: 'error', content: errorMessage, timestamp: Date.now() });
         emit({ type: 'error', code: 'AI_SDK_ERROR', message: errorMessage, recoverable: true });
         onSessionEvent?.({ type: 'error', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { code: 'AI_SDK_ERROR', message: errorMessage } });
         // Don't silently ignore errors — let them propagate
         throw new Error(`AI SDK Error: ${errorMessage}`);
       }

       case 'tool_executing': {
         persist({ type: 'tool_executing', content: event.tool, timestamp: Date.now() });
         // Also emit to SSE so the UI shows the tool running during live stream.
         emit({
           type: 'tool_executing',
           tool: event.tool || 'unknown',
           description: `Executing ${event.tool || 'tool'}`,
           startTime: Date.now(),
           args: (event.args as Record<string, unknown>) ?? {},
           callId: (event.callId as string) ?? undefined,
         });
         break;
       }

       case 'tool_complete': {
         const tool = event.tool || 'unknown';
         const result = event.result as { success: boolean; output: string } | undefined;
         const elapsed = event.elapsed || 0;

         if (result) {
           state.toolExecutions.push({ tool, success: result.success, output: result.output, elapsed });
           persist({
             type: 'tool-complete',
             toolName: tool,
             toolResult: result.output,
             toolSuccess: result.success,
             timestamp: Date.now(),
           });
           // Also emit to SSE so the UI shows the tool result during live stream.
           emit({
             type: 'tool_complete',
             tool,
             result: { success: result.success, output: result.output },
             elapsed,
             args: (event.args as Record<string, unknown>) ?? {},
             callId: (event.callId as string) ?? undefined,
           });
         }
         break;
       }

       case 'abort': {
          persist({ type: 'abort', timestamp: Date.now() });
          onSessionEvent?.({ type: 'abort', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { reason: 'Stream aborted' } });
          break;
        }

        default: {
          console.warn('[AI_SDK_HANDLER] Unhandled event type:', event.type, 'event:', event);
          break;
        }
       }
     } catch (e) {
       console.error('[AI_SDK_HANDLER] Unhandled error in event processing:', e, 'event:', event);
       emit({ type: 'error', code: 'EVENT_HANDLER_ERROR', message: `Event processing error: ${String(e)}`, recoverable: true });
     }
   }

  return {
    handleEvent,
    getState: () => ({ ...state, messageId: voiceMerge?.messageId ?? messageId }),
    discardCurrentStepText: () => {
      state.clarificationUsed = true;
      state.accumulatedContent = state.accumulatedContent.slice(0, state.stepTextStartLength);
      emit({ type: 'stream_clear' });
    },
    reset: () => {
      state.accumulatedContent = '';
      state.accumulatedReasoning = '';
      state.stepCount = 0;
      state.stepTextStartLength = 0;
      state.clarificationUsed = false;
      state.deferredEmptyFinalize = false;
      state.toolCallCount = 0;
      // Also clear the live streaming view — callers that reset() and then feed a fresh
      // continuation stream into the same handler (see Agent.ts's transition/action/text
      // continuation blocks) expect this to fully replace the prior turn's text, not append
      // to it. Without this, `emit({ type: 'stream_chunk', fullContent: ... })` on the next
      // text-delta would resume from the pre-reset `accumulatedContent` for the *UI*, and —
      // more importantly — the final persisted message content would silently concatenate
      // two unrelated model responses with no separator (see docs/engineering-crew/DESIGN.md
      // Section 2.6).
      emit({ type: 'stream_clear' });
    },
  };
}

/** Default idle window before a `fullStream` iterator is treated as wedged. */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;

export interface StreamWatchdogOutcome {
  /** True if the stream produced no chunk for longer than the idle timeout. */
  stalled: boolean;
}

/**
 * Consumes an AI SDK `fullStream` async iterable with an idle-timeout watchdog.
 *
 * Individual tool executions already enforce their own hard timeout inside
 * ToolExecutor (see ToolExecutor.execute's Promise.race), so under normal
 * conditions the stream should never go silent for more than a few tens of
 * seconds even while a tool runs. If the provider connection drops mid-turn
 * (or a tool call gets orphaned below the ToolExecutor layer), the stream
 * simply stops emitting new chunks — the `for await` loop would otherwise
 * hang indefinitely with the model (and the user) never told anything is
 * wrong, while some outer layer may silently restart the entire turn from
 * scratch. This watchdog turns that silent hang into a fast, explicit,
 * single failure instead.
 */
export async function consumeStreamWithWatchdog<T>(
  stream: AsyncIterable<T>,
  onChunk: (chunk: T) => void,
  idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): Promise<StreamWatchdogOutcome> {
  const iterator = stream[Symbol.asyncIterator]();
  for (;;) {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let next: Promise<IteratorResult<T>> | undefined;
    try {
      const idle = new Promise<'idle'>((resolve) => {
        idleTimer = setTimeout(() => resolve('idle'), idleTimeoutMs);
      });
      next = iterator.next();
      const raced = await Promise.race([next, idle]);

      if (raced === 'idle') {
        // Best-effort, fire-and-forget cleanup: a generator suspended on an
        // unresolvable await (e.g. a dead network stream) will never actually
        // settle a `.return()` call either, so we must NOT await it here — that
        // would just trade one infinite hang for another. Let it resolve (or
        // never resolve) in the background; we've already given up on this stream.
        void iterator.return?.(undefined)?.catch(() => { /* ignore */ });
        return { stalled: true };
      }
      if (raced.done) {
        return { stalled: false };
      }
      onChunk(raced.value);
    } finally {
      clearTimeout(idleTimer);
      // Avoid unhandled rejections when the idle timer wins the race and the
      // pending .next() later rejects.
      next?.catch(() => { /* ignored */ });
    }
  }
}

export type { PartRecord, StreamState };
