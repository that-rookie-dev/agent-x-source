import type { BackgroundTaskRecord, BackgroundTaskSummary } from './background-task-types.js';
import type { AgentEventBus } from '../../events/EventBus.js';
import type { EngineEvent } from '@agentx/shared';

export interface BackgroundTaskEventPublisher {
  registerSession(sessionId: string, eventBus: AgentEventBus): void;
  unregisterSession(sessionId: string): void;
  publishStatus(sessionId: string, tasks: BackgroundTaskRecord[]): void;
  publishProgress(record: BackgroundTaskRecord, snippet?: string): void;
  publishComplete(record: BackgroundTaskRecord, success: boolean): void;
}

export class DefaultBackgroundTaskEventPublisher implements BackgroundTaskEventPublisher {
  private buses = new Map<string, AgentEventBus>();

  registerSession(sessionId: string, eventBus: AgentEventBus): void {
    this.buses.set(sessionId, eventBus);
  }

  unregisterSession(sessionId: string): void {
    this.buses.delete(sessionId);
  }

  publishStatus(sessionId: string, tasks: BackgroundTaskRecord[]): void {
    const bus = this.buses.get(sessionId);
    if (!bus) return;
    const now = Date.now();
    const summary: BackgroundTaskSummary[] = tasks
      .filter((t) => t.parentSessionId === sessionId)
      .map((t) => ({
        id: t.id,
        parentSessionId: t.parentSessionId,
        childSessionId: t.childSessionId,
        instruction: t.instruction,
        status: t.status,
        elapsedMs: t.endTime
          ? t.endTime - (t.startTime ?? t.createdAt)
          : now - (t.startTime ?? t.createdAt),
        startTime: t.startTime,
        endTime: t.endTime,
      }));
    if (summary.length === 0) return;
    bus.emit({
      type: 'background_task_status',
      sessionId,
      tasks: summary,
    } as unknown as EngineEvent);
  }

  publishProgress(record: BackgroundTaskRecord, snippet?: string): void {
    const bus = this.buses.get(record.parentSessionId);
    if (!bus) return;
    const now = Date.now();
    bus.emit({
      type: 'background_task_progress',
      taskId: record.id,
      sessionId: record.parentSessionId,
      status: record.status,
      elapsedMs: record.endTime
        ? record.endTime - (record.startTime ?? record.createdAt)
        : now - (record.startTime ?? record.createdAt),
      instruction: record.instruction,
      snippet,
    } as unknown as EngineEvent);
  }

  publishComplete(record: BackgroundTaskRecord, success: boolean): void {
    const bus = this.buses.get(record.parentSessionId);
    if (!bus) return;
    const elapsedMs = (record.endTime ?? Date.now()) - (record.startTime ?? record.createdAt);
    const tokensUsed = record.resourceUsage?.tokenUsage
      ? record.resourceUsage.tokenUsage.input + record.resourceUsage.tokenUsage.output
      : undefined;
    bus.emit({
      type: 'background_task_complete',
      taskId: record.id,
      sessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
      success,
      elapsedMs,
      tokensUsed,
      result: record.result,
      error: record.error,
      instruction: record.instruction,
      inboundChannel: record.channelContext?.channel,
      inboundThreadId: record.channelContext?.threadId,
      inboundMessageId: record.channelContext?.messageId,
    } as unknown as EngineEvent);
  }
}
