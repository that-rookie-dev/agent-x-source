import { EngineLifecycle } from './EngineLifecycle';
import type { AgentEventBus } from '@agentx/engine';
import type {
  EngineEvent,
  Message,
  ToolResult,
} from '@agentx/shared';
import type {
  ChatMessage,
  ToolExecution,
  SubAgentState,
  ReasoningState,
  IndexingState,
  ResearchState,
  StreamState,
  Disposable,
  LifecycleEvent,
  MessageCallback,
  StreamCallback,
  ToolEventCallback,
  PermissionCallback,
  ErrorCallback,
  PlanEventCallback,
  SubAgentEventCallback,
  ReasoningCallback,
  MetaCallback,
  VisualCallback,
  TokenUpdateCallback,
  TodoCallback,
  IndexingCallback,
  ResearchCallback,
  LoadingCallback,
  ProcessingCallback,
  DiffPreviewCallback,
  ClarificationCallback,
  CompactionCallback,
  WatchEventCallback,
  BackgroundTaskCallback,
  ReminderCallback,
} from './types';

const STREAM_THROTTLE_MS = 16;

export class EventBridge {
  private unsubscribe: (() => void) | null = null;
  private lifecycleDisposable: Disposable | null = null;
  private eventBus: AgentEventBus | null;

  private messageHandlers = new Set<MessageCallback>();
  private streamHandlers = new Set<StreamCallback>();
  private toolHandlers = new Set<ToolEventCallback>();
  private permissionHandlers = new Set<PermissionCallback>();
  private errorHandlers = new Set<ErrorCallback>();
  private planHandlers = new Set<PlanEventCallback>();
  private subAgentHandlers = new Set<SubAgentEventCallback>();
  private reasoningHandlers = new Set<ReasoningCallback>();
  private metaHandlers = new Set<MetaCallback>();
  private visualHandlers = new Set<VisualCallback>();
  private tokenHandlers = new Set<TokenUpdateCallback>();
  private todoHandlers = new Set<TodoCallback>();
  private indexingHandlers = new Set<IndexingCallback>();
  private researchHandlers = new Set<ResearchCallback>();
  private loadingHandlers = new Set<LoadingCallback>();
  private processingHandlers = new Set<ProcessingCallback>();
  private diffPreviewHandlers = new Set<DiffPreviewCallback>();
  private clarificationHandlers = new Set<ClarificationCallback>();
  private compactionHandlers = new Set<CompactionCallback>();
  private watchEventHandlers = new Set<WatchEventCallback>();
  private backgroundTaskHandlers = new Set<BackgroundTaskCallback>();
  private reminderHandlers = new Set<ReminderCallback>();

  private lastStreamEmit = 0;
  private pendingStreamChunk: { content: string; fullContent: string } | null = null;
  private streamThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private streamThrottleMs: number;

  private reasoningState: ReasoningState = { isActive: false, glimpses: [] };
  private indexingState: IndexingState = { isActive: false, indexed: 0, total: 0, currentFile: null, chunks: null };
  private researchState: ResearchState = { isActive: false, question: null, queries: [], synthesisResultCount: null, report: null };
  private streamState: StreamState = { isActive: false, content: '', fullContent: '' };

  private toolExecutions = new Map<string, ToolExecution>();
  private subAgentStates = new Map<string, SubAgentState>();

  constructor(engineLifecycle: EngineLifecycle, streamThrottleMs?: number) {
    this.streamThrottleMs = streamThrottleMs ?? STREAM_THROTTLE_MS;
    const agent = engineLifecycle.getEngine()?.getAgent();
    this.eventBus = (agent?.events as AgentEventBus) ?? null;
    if (this.eventBus) {
      this.subscribe();
    } else {
      this.lifecycleDisposable = engineLifecycle.onLifecycle((event: LifecycleEvent) => {
        if (event.type === 'ready' && !this.eventBus) {
          const a = engineLifecycle.getEngine()?.getAgent();
          this.eventBus = (a?.events as AgentEventBus) ?? null;
          if (this.eventBus) {
            this.subscribe();
            if (this.lifecycleDisposable) {
              this.lifecycleDisposable.dispose();
              this.lifecycleDisposable = null;
            }
          }
        }
      });
    }
  }

  private subscribe(): void {
    this.unsubscribe = this.eventBus!.on((event: EngineEvent) => {
      this.dispatch(event);
    });
  }

  private dispatch(event: EngineEvent): void {
    this.emitMeta(event);

    switch (event.type) {
      case 'message_sent':
        this.handleMessageSent(event.message);
        this.emitAll(this.sessionChangeHandlers, undefined);
        break;

      case 'message_received':
        this.handleMessageReceived(event.message, event.elapsed);
        this.emitAll(this.sessionChangeHandlers, undefined);
        break;

      case 'stream_chunk':
        this.handleStreamChunk(event.content, event.fullContent);
        break;

      case 'loading_start':
        this.emitAll(this.loadingHandlers, event.stage);
        break;

      case 'loading_end':
        this.emitAll(this.loadingHandlers, null);
        break;

      case 'processing_start':
        this.emitAll(this.processingHandlers, {
          taskDescription: event.taskDescription,
          stage: event.taskDescription,
          progress: 0,
        });
        this.emitAll(this.statusChangeHandlers, 'processing');
        break;

      case 'processing_progress':
        this.emitAll(this.processingHandlers, {
          taskDescription: event.stage,
          stage: event.stage,
          progress: event.progress,
        });
        break;

      case 'processing_complete':
        this.emitAll(this.processingHandlers, null);
        this.emitAll(this.statusChangeHandlers, 'idle');
        break;

      case 'permission_required':
        this.handlePermissionRequired(event.tool, event.path, event.riskLevel);
        for (const handler of this.permissionRequestHandlers) {
          try { handler(); } catch { /* swallow */ }
        }
        break;

      case 'token_update':
        this.handleTokenUpdate(event.used, event.available);
        break;

      case 'token_usage':
        this.handleTokenUsage(event.totalTokens, event.contextWindow);
        this.emitAll(this.tokenUsageHandlers, {
          used: event.totalTokens,
          total: event.contextWindow,
          percentage: event.contextWindow > 0 ? event.totalTokens / event.contextWindow : 0,
        });
        break;

      case 'error':
        this.emitAll(this.errorHandlers, {
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
          actions: event.actions,
        });
        this.emitAll(this.statusChangeHandlers, 'error');
        break;

      case 'tool_executing':
        this.handleToolExecuting(event.tool, event.description, event.startTime);
        break;

      case 'tool_complete':
        this.handleToolComplete(event.tool, event.result, event.elapsed);
        break;

      case 'agent_spawned':
        this.handleAgentSpawned(event.agentId, event.task, event.startTime);
        break;

      case 'agent_progress':
        this.handleAgentProgress(event.agentId, event.status);
        break;

      case 'agent_complete':
        this.handleAgentComplete(event.agentId, event.summary, event.elapsed);
        break;

      case 'reasoning_start':
        this.reasoningState = { isActive: true, glimpses: [] };
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'reasoning_glimpse':
        this.reasoningState.glimpses.push(event.text);
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'reasoning_complete':
        this.reasoningState.isActive = false;
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'plan_generated':
      case 'plan_step_approved':
      case 'plan_step_rejected':
      case 'plan_step_pending':
      case 'plan_step_skipped':
      case 'plan_step_executing':
      case 'plan_step_complete':
      case 'plan_step_failed':
      case 'plan_approved':
      case 'plan_rejected':
      case 'plan_cancelled':
      case 'plan_mode_entered':
        this.emitAll(this.planHandlers, event);
        this.emitAll(this.planModeChangeHandlers, true);
        break;

      case 'plan_mode_exited':
        this.emitAll(this.planHandlers, event);
        this.emitAll(this.planModeChangeHandlers, false);
        break;

      case 'todo_update':
        this.emitAll(this.todoHandlers, event.items);
        break;

      case 'indexing_start':
        this.indexingState = {
          isActive: true,
          indexed: 0,
          total: event.totalFiles,
          currentFile: null,
          chunks: null,
        };
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'indexing_progress':
        this.indexingState.indexed = event.indexed;
        this.indexingState.total = event.total;
        this.indexingState.currentFile = event.currentFile ?? null;
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'indexing_complete':
        this.indexingState.isActive = false;
        this.indexingState.indexed = event.indexed;
        this.indexingState.total = event.total;
        this.indexingState.chunks = event.chunks;
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'diff_preview':
        this.emitAll(this.diffPreviewHandlers, {
          tool: event.tool,
          filePath: event.filePath,
          diff: event.diff,
          oldContent: event.oldContent,
          newContent: event.newContent,
        });
        break;

      case 'clarification_required':
        this.emitAll(this.clarificationHandlers, {
          question: event.question,
          options: event.options,
          allowFreeform: event.allowFreeform,
        });
        break;

      case 'compaction_start':
        this.emitAll(this.compactionHandlers, {
          type: 'start',
          currentTokens: event.currentTokens,
          threshold: event.threshold,
        });
        break;

      case 'compaction_complete':
        this.emitAll(this.compactionHandlers, {
          type: 'complete',
          saved: event.saved,
        });
        break;

      case 'context_compacted':
        this.emitAll(this.compactionHandlers, {
          type: 'complete',
          saved: event.saved,
        });
        break;

      case 'watch_event':
        this.emitAll(this.watchEventHandlers, {
          event: event.event,
          filePath: event.filePath,
          command: event.command,
          timestamp: event.timestamp,
        });
        break;

      case 'background_task_complete':
        this.emitAll(this.backgroundTaskHandlers, {
          taskId: event.taskId,
          summary: event.summary,
        });
        break;

      case 'task_backgrounded':
        this.emitAll(this.backgroundTaskHandlers, {
          taskId: event.taskId,
        });
        break;

      case 'reminder_fired':
        this.emitAll(this.reminderHandlers, {
          taskId: event.taskId,
          name: event.name,
          message: event.message,
        });
        break;

      case 'research_start':
        this.researchState = {
          isActive: true,
          question: event.question,
          queries: [],
          synthesisResultCount: null,
          report: null,
        };
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_query':
        this.researchState.queries.push({
          queryId: event.queryId,
          question: event.question,
          sources: event.sources,
          completed: false,
        });
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_subagent_complete':
        {
          const q = this.researchState.queries.find((q) => q.queryId === event.queryId);
          if (q) {
            q.completed = true;
            q.result = {
              answer: event.result.answer,
              sources: event.result.sources,
              elapsed: event.result.elapsed,
            };
          }
          this.emitAll(this.researchHandlers, { ...this.researchState });
        }
        break;

      case 'research_synthesis':
        this.researchState.synthesisResultCount = event.resultCount;
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_complete':
        this.researchState.isActive = false;
        this.researchState.report = event.report;
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'subagent_event':
        this.emitAll(this.subAgentHandlers, {
          agentId: event.subagentId,
          task: '',
          status: 'running',
          startTime: Date.now(),
        });
        break;

      case 'command_action':
        this.emitAll(this.metaHandlers, event);
        break;

      case 'intent_detected':
      case 'rag_queried':
      case 'decision_made':
      case 'reflection_complete':
      case 'skill_generated':
      case 'decomposition_start':
      case 'decomposition_ready':
      case 'decomposition_complete':
      case 'decomposition_fallback':
      case 'agent_message':
      case 'tot_start':
      case 'tot_thought_generated':
      case 'tot_evaluation':
      case 'tot_complete':
      case 'task_consolidated_time':
      case 'steer_message':
      case 'task_abort_requested':
      case 'task_aborted':
      case 'discord_connected':
      case 'discord_message':
      case 'discord_error':
        this.emitAll(this.metaHandlers, event);
        break;
    }

    if (event.type.startsWith('visual_')) {
      this.emitAll(this.visualHandlers, event as any);
    }
  }

  private handleMessageSent(message: Message): void {
    const chatMsg = this.toChatMessage(message);
    this.emitAll(this.messageHandlers, chatMsg);
  }

  private handleMessageReceived(message: Message, _elapsed: number): void {
    this.flushPendingStream();
    this.streamState = { isActive: false, content: '', fullContent: '' };
    const chatMsg = this.toChatMessage(message);
    this.emitAll(this.messageHandlers, chatMsg);
  }

  private handleStreamChunk(content: string, fullContent: string): void {
    this.streamState = { isActive: true, content, fullContent };

    const now = Date.now();
    if (now - this.lastStreamEmit >= this.streamThrottleMs) {
      this.lastStreamEmit = now;
      this.pendingStreamChunk = null;
      this.emitAll(this.streamHandlers, { content, fullContent });
    } else {
      this.pendingStreamChunk = { content, fullContent };
      if (!this.streamThrottleTimer) {
        this.streamThrottleTimer = setTimeout(() => {
          this.streamThrottleTimer = null;
          if (this.pendingStreamChunk) {
            this.lastStreamEmit = Date.now();
            this.emitAll(this.streamHandlers, this.pendingStreamChunk);
            this.pendingStreamChunk = null;
          }
        }, this.streamThrottleMs - (now - this.lastStreamEmit));
      }
    }
  }

  private flushPendingStream(): void {
    if (this.streamThrottleTimer) {
      clearTimeout(this.streamThrottleTimer);
      this.streamThrottleTimer = null;
    }
    if (this.pendingStreamChunk) {
      this.emitAll(this.streamHandlers, this.pendingStreamChunk);
      this.pendingStreamChunk = null;
    }
  }

  private handlePermissionRequired(tool: string, path: string, riskLevel: string): void {
    this.emitAll(this.permissionHandlers, {
      tool,
      path,
      riskLevel,
      timestamp: Date.now(),
    });
  }

  private handleTokenUpdate(used: number, available: number): void {
    const total = used + available;
    this.emitAll(this.tokenHandlers, {
      used,
      total,
      remaining: available,
      percentage: total > 0 ? used / total : 0,
      isNearLimit: total > 0 && used / total >= 0.7,
      isAtLimit: total > 0 && used / total >= 0.95,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
    });
  }

  private handleTokenUsage(totalTokens: number, contextWindow: number): void {
    this.emitAll(this.tokenHandlers, {
      used: totalTokens,
      total: contextWindow,
      remaining: Math.max(0, contextWindow - totalTokens),
      percentage: contextWindow > 0 ? totalTokens / contextWindow : 0,
      isNearLimit: contextWindow > 0 && totalTokens / contextWindow >= 0.7,
      isAtLimit: contextWindow > 0 && totalTokens / contextWindow >= 0.95,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
    });
  }

  private handleToolExecuting(tool: string, description: string, startTime: number): void {
    const execution: ToolExecution = {
      toolCallId: `${tool}-${startTime}`,
      toolName: tool,
      description,
      status: 'executing',
      startTime,
    };
    this.toolExecutions.set(execution.toolCallId, execution);
    this.emitAll(this.toolHandlers, execution);
  }

  private handleToolComplete(tool: string, result: ToolResult, elapsed: number): void {
    let found: ToolExecution | undefined;
      for (const [, exec] of this.toolExecutions) {
      if (exec.toolName === tool && exec.status === 'executing') {
        found = exec;
        break;
      }
    }

    if (found) {
      found.status = result.success ? 'completed' : 'error';
      found.endTime = Date.now();
      found.elapsed = elapsed;
      found.result = result;
      this.emitAll(this.toolHandlers, found);
      this.toolExecutions.delete(found.toolCallId);
    } else {
      const execution: ToolExecution = {
        toolCallId: `${tool}-complete-${Date.now()}`,
        toolName: tool,
        description: tool,
        status: result.success ? 'completed' : 'error',
        startTime: Date.now() - elapsed,
        endTime: Date.now(),
        elapsed,
        result,
      };
      this.emitAll(this.toolHandlers, execution);
    }
  }

  private handleAgentSpawned(agentId: string, task: string, startTime: number): void {
    const state: SubAgentState = {
      agentId,
      task,
      status: 'spawning',
      startTime,
    };
    this.subAgentStates.set(agentId, state);
    this.emitAll(this.subAgentHandlers, state);
  }

  private handleAgentProgress(agentId: string, status: string): void {
    const state = this.subAgentStates.get(agentId);
    if (state) {
      state.status = status === 'running' ? 'running' : (status as SubAgentState['status']);
      this.emitAll(this.subAgentHandlers, { ...state });
    }
  }

  private handleAgentComplete(agentId: string, summary: string, elapsed: number): void {
    const state = this.subAgentStates.get(agentId);
    if (state) {
      state.status = 'completed';
      state.endTime = Date.now();
      state.elapsed = elapsed;
      state.summary = summary;
      this.emitAll(this.subAgentHandlers, { ...state });
      this.subAgentStates.delete(agentId);
    }
  }

  private emitMeta(event: EngineEvent): void {
    if (this.metaHandlers.size > 0) {
      for (const handler of this.metaHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors
        }
      }
    }
  }

  private toChatMessage(message: Message): ChatMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role as ChatMessage['role'],
      content: message.content,
      toolCalls: message.toolCalls
        ? message.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
          }))
        : null,
      tokenCount: message.tokenCount,
      tokenCost: message.tokenCost,
      createdAt: message.createdAt,
      elapsed: message.elapsed,
      turnId: message.turnId,
      reasoning: message.reasoning,
    };
  }

  private emitAll<T>(handlers: Set<(value: T) => void>, value: T): void {
    for (const handler of handlers) {
      try {
        handler(value);
      } catch {
        // Swallow handler errors
      }
    }
  }

  onMessage(handler: MessageCallback): Disposable {
    this.messageHandlers.add(handler);
    return { dispose: () => { this.messageHandlers.delete(handler); } };
  }

  onStream(handler: StreamCallback): Disposable {
    this.streamHandlers.add(handler);
    return { dispose: () => { this.streamHandlers.delete(handler); } };
  }

  onToolEvent(handler: ToolEventCallback): Disposable {
    this.toolHandlers.add(handler);
    return { dispose: () => { this.toolHandlers.delete(handler); } };
  }

  onPermission(handler: PermissionCallback): Disposable {
    this.permissionHandlers.add(handler);
    return { dispose: () => { this.permissionHandlers.delete(handler); } };
  }

  onError(handler: ErrorCallback): Disposable {
    this.errorHandlers.add(handler);
    return { dispose: () => { this.errorHandlers.delete(handler); } };
  }

  onPlanEvent(handler: PlanEventCallback): Disposable {
    this.planHandlers.add(handler);
    return { dispose: () => { this.planHandlers.delete(handler); } };
  }

  onSubAgentEvent(handler: SubAgentEventCallback): Disposable {
    this.subAgentHandlers.add(handler);
    return { dispose: () => { this.subAgentHandlers.delete(handler); } };
  }

  onReasoning(handler: ReasoningCallback): Disposable {
    this.reasoningHandlers.add(handler);
    return { dispose: () => { this.reasoningHandlers.delete(handler); } };
  }

  onMeta(handler: MetaCallback): Disposable {
    this.metaHandlers.add(handler);
    return { dispose: () => { this.metaHandlers.delete(handler); } };
  }

  onVisual(handler: VisualCallback): Disposable {
    this.visualHandlers.add(handler);
    return { dispose: () => { this.visualHandlers.delete(handler); } };
  }

  onTokenUpdate(handler: TokenUpdateCallback): Disposable {
    this.tokenHandlers.add(handler);
    return { dispose: () => { this.tokenHandlers.delete(handler); } };
  }

  onTodo(handler: TodoCallback): Disposable {
    this.todoHandlers.add(handler);
    return { dispose: () => { this.todoHandlers.delete(handler); } };
  }

  onIndexing(handler: IndexingCallback): Disposable {
    this.indexingHandlers.add(handler);
    return { dispose: () => { this.indexingHandlers.delete(handler); } };
  }

  onResearch(handler: ResearchCallback): Disposable {
    this.researchHandlers.add(handler);
    return { dispose: () => { this.researchHandlers.delete(handler); } };
  }

  onLoading(handler: LoadingCallback): Disposable {
    this.loadingHandlers.add(handler);
    return { dispose: () => { this.loadingHandlers.delete(handler); } };
  }

  onProcessing(handler: ProcessingCallback): Disposable {
    this.processingHandlers.add(handler);
    return { dispose: () => { this.processingHandlers.delete(handler); } };
  }

  onDiffPreview(handler: DiffPreviewCallback): Disposable {
    this.diffPreviewHandlers.add(handler);
    return { dispose: () => { this.diffPreviewHandlers.delete(handler); } };
  }

  onClarification(handler: ClarificationCallback): Disposable {
    this.clarificationHandlers.add(handler);
    return { dispose: () => { this.clarificationHandlers.delete(handler); } };
  }

  onCompaction(handler: CompactionCallback): Disposable {
    this.compactionHandlers.add(handler);
    return { dispose: () => { this.compactionHandlers.delete(handler); } };
  }

  onWatchEvent(handler: WatchEventCallback): Disposable {
    this.watchEventHandlers.add(handler);
    return { dispose: () => { this.watchEventHandlers.delete(handler); } };
  }

  onBackgroundTask(handler: BackgroundTaskCallback): Disposable {
    this.backgroundTaskHandlers.add(handler);
    return { dispose: () => { this.backgroundTaskHandlers.delete(handler); } };
  }

  onReminder(handler: ReminderCallback): Disposable {
    this.reminderHandlers.add(handler);
    return { dispose: () => { this.reminderHandlers.delete(handler); } };
  }

  getStreamState(): StreamState {
    return { ...this.streamState };
  }

  getReasoningState(): ReasoningState {
    return { ...this.reasoningState };
  }

  getIndexingState(): IndexingState {
    return { ...this.indexingState };
  }

  getResearchState(): ResearchState {
    return { ...this.researchState };
  }

  getActiveToolExecutions(): ToolExecution[] {
    return Array.from(this.toolExecutions.values());
  }

  getActiveSubAgents(): SubAgentState[] {
    return Array.from(this.subAgentStates.values());
  }

  private statusChangeHandlers = new Set<(status: string) => void>();
  private sessionChangeHandlers = new Set<() => void>();
  private tokenUsageHandlers = new Set<(usage: any) => void>();
  private providerChangeHandlers = new Set<(provider: string) => void>();
  private modelChangeHandlers = new Set<(model: string) => void>();
  private planModeChangeHandlers = new Set<(active: boolean) => void>();
  private permissionRequestHandlers = new Set<() => void>();
  private permissionResolvedHandlers = new Set<() => void>();

  onStatusChange(handler: (status: string) => void): void {
    this.statusChangeHandlers.add(handler);
  }

  onSessionChange(handler: () => void): void {
    this.sessionChangeHandlers.add(handler);
  }

  onTokenUsage(handler: (usage: any) => void): void {
    this.tokenUsageHandlers.add(handler);
  }

  onProviderChange(handler: (provider: string) => void): void {
    this.providerChangeHandlers.add(handler);
  }

  onModelChange(handler: (model: string) => void): void {
    this.modelChangeHandlers.add(handler);
  }

  onPlanModeChange(handler: (active: boolean) => void): void {
    this.planModeChangeHandlers.add(handler);
  }

  onPermissionRequest(handler: () => void): void {
    this.permissionRequestHandlers.add(handler);
  }

  onPermissionResolved(handler: () => void): void {
    this.permissionResolvedHandlers.add(handler);
  }

  notifySessionCleared(): void {
    for (const handler of this.sessionChangeHandlers) {
      try { handler(); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.flushPendingStream();

    if (this.lifecycleDisposable) {
      this.lifecycleDisposable.dispose();
      this.lifecycleDisposable = null;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.messageHandlers.clear();
    this.streamHandlers.clear();
    this.toolHandlers.clear();
    this.permissionHandlers.clear();
    this.errorHandlers.clear();
    this.planHandlers.clear();
    this.subAgentHandlers.clear();
    this.reasoningHandlers.clear();
    this.metaHandlers.clear();
    this.visualHandlers.clear();
    this.tokenHandlers.clear();
    this.todoHandlers.clear();
    this.indexingHandlers.clear();
    this.researchHandlers.clear();
    this.loadingHandlers.clear();
    this.processingHandlers.clear();
    this.diffPreviewHandlers.clear();
    this.clarificationHandlers.clear();
    this.compactionHandlers.clear();
    this.watchEventHandlers.clear();
    this.backgroundTaskHandlers.clear();
    this.reminderHandlers.clear();

    this.toolExecutions.clear();
    this.subAgentStates.clear();
  }
}
