import type { EngineEvent, Message, SessionEvent } from '@agentx/shared';
import { generateMessageId, appendStreamText, extractStreamTextDelta, estimateTokens, getOutputReserve } from '@agentx/shared';

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
  stepTextStartLength: number;
  clarificationUsed: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  promptCharEstimate: number;
  stepSnapshots: Array<{ step: number; hash: string }>;
  modelName: string;
  toolCallCount: number;
  toolExecutions: Array<{ tool: string; success: boolean; output: string; elapsed: number }>;
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
    let result: Record<string, any> = {};
    try {
      result = JSON.parse(output);
    } catch {
      // If not JSON, treat as string result
      result = { raw: output };
    }

    // File Create/Write Operations
    if (toolName === 'file_write' || toolName === 'write_file' || toolName === 'WriteFile') {
      const filePath = result.path || result.filePath || '';
      const content = result.content || output;
      emit({
        type: 'operation_file_created',
        filePath,
        content: content.slice(0, 10000), // Limit size for streaming
        language: detectLanguage(filePath),
      } as unknown as EngineEvent);
    }

    // File Read Operations
    if (toolName === 'file_read' || toolName === 'read_file' || toolName === 'ReadFile' || toolName === 'read' || toolName === 'cat') {
      const filePath = result.path || result.filePath || '';
      const content = result.content || output;
      emit({
        type: 'operation_file_read',
        filePath,
        content: content.slice(0, 5000),
        language: detectLanguage(filePath),
      } as unknown as EngineEvent);
    }

    // File Edit Operations  
    if (toolName === 'file_patch' || toolName === 'code_replace' || toolName === 'code_insert' ||
        toolName === 'file_edit' || toolName === 'apply_patch' ||
        toolName === 'edit_file' || toolName === 'EditFile' || toolName === 'replace_file_section') {
      const filePath = result.path || result.filePath || '';
      const oldContent = result.oldContent || '';
      const newContent = result.newContent || '';
      const diff = result.diff || '';
      emit({
        type: 'operation_file_edited',
        filePath,
        oldContent: oldContent.slice(0, 3000),
        newContent: newContent.slice(0, 3000),
        diff: diff.slice(0, 5000),
        changes: result.changes,
      } as unknown as EngineEvent);
    }

    // Glob/Search Operations
    if (toolName === 'glob' || toolName === 'Glob' || toolName === 'search_files' || toolName === 'code_search') {
      const pattern = result.pattern || result.glob || '';
      const directory = result.directory || result.dir || result.cwd || '';
      const matches = Array.isArray(result.matches) ? result.matches : 
                     Array.isArray(result.files) ? result.files :
                     output.split('\n').filter(line => line.trim());
      
      emit({
        type: 'operation_search_glob',
        pattern,
        directory,
        matchCount: matches.length,
        matches: matches.slice(0, 50), // First 50 matches
      } as unknown as EngineEvent);
    }

    // Grep/Search in Files
    if (toolName === 'grep' || toolName === 'Grep' || toolName === 'search_in_files' || toolName === 'code_references') {
      const pattern = result.pattern || result.keyword || result.query || '';
      const directory = result.directory || result.dir || '';
      const matches = Array.isArray(result.matches) ? result.matches :
                     Array.isArray(result.results) ? result.results : [];
      
      emit({
        type: 'operation_search_grep',
        pattern,
        directory,
        matchCount: matches.length,
        matches: matches.slice(0, 30),
      } as unknown as EngineEvent);
    }

    // Directory/File Listing
    if (toolName === 'folder_list' || toolName === 'list_dir' || toolName === 'ls' || toolName === 'list_files' || toolName === 'ListFiles') {
      const directory = result.directory || result.path || '';
      const files = Array.isArray(result.files) ? result.files :
                   Array.isArray(result.entries) ? result.entries : 
                   output.split('\n').filter(line => line.trim());
      
      emit({
        type: 'operation_list_files',
        directory,
        fileCount: files.length,
        files: files.slice(0, 50),
      } as unknown as EngineEvent);
    }

    // Command Execution
    if (toolName === 'shell_exec' || toolName === 'shell_exec_streaming' || toolName === 'shell_background' ||
        toolName === 'execute' || toolName === 'run_command' || toolName === 'bash') {
      const command = result.command || result.cmd || '';
      const stdout = result.stdout || result.output || output;
      const stderr = result.stderr || '';
      
      emit({
        type: 'operation_command_executed',
        command,
        success: result.success !== false && !stderr,
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 1000),
      } as unknown as EngineEvent);
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
) {
  const state: StreamState = {
    accumulatedContent: '',
    accumulatedReasoning: '',
    stepCount: 0,
    stepTextStartLength: 0,
    clarificationUsed: false,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    promptCharEstimate,
    stepSnapshots: [],
    modelName: modelName || '',
    toolCallCount: 0,
    toolExecutions: [],
  };

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
    } as unknown as EngineEvent);
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
    } as unknown as EngineEvent);
    checkContextWarning(inputTokens + outputTokens + streamingOut);
  };

  const streamStartTime = Date.now();

  function checkContextWarning(totalTokens: number): void {
    if (!ctxWindow || ctxWindow <= 0) return;
    const percentage = (totalTokens / ctxWindow) * 100;
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
        emit({ type: 'loading_start', stage: 'thinking', message: 'Thinking...' } as unknown as EngineEvent);
        break;
      }

        case 'step-start': {
          state.stepCount++;
          state.stepTextStartLength = state.accumulatedContent.length;
          if (state.stepCount > 1) {
            emit({ type: 'loading_start', stage: 'tool_execution', message: 'Executing...' } as unknown as EngineEvent);
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
          } as unknown as EngineEvent);
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
        } as unknown as EngineEvent);
        break;
      }

      case 'text-delta': {
        const delta = extractStreamTextDelta(event as Record<string, unknown>);
        state.accumulatedContent = appendStreamText(state.accumulatedContent, delta);
        persist({ type: 'text-delta', content: delta, timestamp: Date.now() });
        emit({ type: 'stream_chunk', content: delta, fullContent: state.accumulatedContent });
        onSessionEvent?.({ type: 'text_delta', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { content: delta, fullContent: state.accumulatedContent } });
        emitStreamingTokenEstimate();
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
         
         // ─── Enhanced: Also emit as thinking event for UI ───
         emit({
           type: 'agent_thinking',
           content: delta,
           fullThought: state.accumulatedReasoning,
           agent: 'primary',
         } as unknown as EngineEvent);
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

            onSessionEvent?.({ type: 'tool_called', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: toolName, callId: toolCallId, args } });
          } catch (e) {
            console.error('[AI_SDK_HANDLER] Error processing tool-call event:', e, 'event:', event);
            emit({ type: 'error', code: 'TOOL_CALL_HANDLER_ERROR', message: `Failed to process tool call: ${String(e)}`, recoverable: true } as unknown as EngineEvent);
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

            onSessionEvent?.({ type: 'tool_result', sessionId, sequence: ++sequence, timestamp: Date.now(), payload: { tool: toolName, callId: toolCallId, success: true, output, elapsed: 0 } });
            
            // ─── Enhanced: Emit detailed operation events for specific tools ───
            emitDetailedOperationEvent(emit, toolName, output);
            
            const total = state.totalInputTokens + state.totalOutputTokens;
            checkContextWarning(total);
          } catch (e) {
            console.error('[AI_SDK_HANDLER] Error processing tool-result event:', e, 'event:', event);
            emit({ type: 'error', code: 'TOOL_RESULT_HANDLER_ERROR', message: `Failed to process tool result: ${String(e)}`, recoverable: true } as unknown as EngineEvent);
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
          emit({ type: 'completion_finished', message: 'Thought.' } as unknown as EngineEvent);
          break;
        }

        const finalContent = trimmedContent || 'I apologize, I was unable to generate a response.';

        const assistantMessage: Message = {
          id: generateMessageId(),
          sessionId,
          role: 'assistant',
          content: finalContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: totalTokens,
        };

        // Emit completion signal before message_received
        emit({ type: 'completion_finished', message: 'Thought.' } as unknown as EngineEvent);
        
        emit({
          type: 'message_received',
          message: assistantMessage,
          elapsed,
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
         break;
       }

       case 'tool_complete': {
         const tool = event.tool as string;
         const result = event.result as { success: boolean; output: string } | undefined;
         const elapsed = event.elapsed as number || 0;
         
         if (result) {
           state.toolExecutions.push({ tool, success: result.success, output: result.output, elapsed });
           persist({
             type: 'tool-complete',
             toolName: tool,
             toolResult: result.output,
             toolSuccess: result.success,
             timestamp: Date.now(),
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
       emit({ type: 'error', code: 'EVENT_HANDLER_ERROR', message: `Event processing error: ${String(e)}`, recoverable: true } as unknown as EngineEvent);
     }
   }

  return {
    handleEvent,
    getState: () => state,
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
      state.toolCallCount = 0;
    },
  };
}

export type { PartRecord, StreamState };
