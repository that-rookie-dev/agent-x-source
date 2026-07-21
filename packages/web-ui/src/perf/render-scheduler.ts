import type { TelemetryEvent } from '../api';
import {
  ensureRenderInstrumentation,
  recordRenderCommit,
  recordTelemetryCoalesced,
  recordTelemetryDelivered,
} from './render-instrumentation';

export type EventPriority = 'p0' | 'p1' | 'p2' | 'p3';

const P0_IMMEDIATE = new Set([
  'message_received',
  'loading_end',
  'task_aborted',
  'provider_error',
  'permission_required',
  'permission_batch_required',
  'step_cap_reached',
  'notification_created',
]);

const P1_LIVE = new Set([
  'stream_chunk',
  'stream_delta',
  'message_chunk',
  'tool_executing',
  'tool_output',
  'tool_complete',
  'reasoning_delta',
  'thinking_delta',
  'reasoning_end',
  'thinking_end',
  'message_sent',
  'loading_start',
  'subagent_event',
  'operation_file_edited',
  'operation_file_created',
  'operation_file_read',
  'operation_search_glob',
  'operation_search_grep',
  'operation_list_files',
  'operation_command_executed',
  'child_session_started',
  'agent_spawned',
  'background_task_complete',
  'decision_made',
]);

const P2_CHROME = new Set([
  'token_usage',
  'turn_heartbeat',
  'turn_state',
  'loading_step_update',
  'command_action',
  'compaction_complete',
]);

const P3_BACKGROUND = new Set([
  'crew_worker_progress',
  'crew_worker_spawned',
  'crew_worker_complete',
  'crew_inter_message',
  'crew_mission_start',
  'crew_mission_complete',
  'crew_mission_retry',
]);

export function classifyEventPriority(type: string): EventPriority {
  if (P0_IMMEDIATE.has(type)) return 'p0';
  if (P1_LIVE.has(type)) return 'p1';
  if (P2_CHROME.has(type)) return 'p2';
  if (P3_BACKGROUND.has(type)) return 'p3';
  return 'p1';
}

function isSubagentToolEvent(ev: TelemetryEvent): boolean {
  if (ev.type !== 'subagent_event') return false;
  const parentType = (ev as { parentEvent?: { type?: string } }).parentEvent?.type;
  return parentType === 'tool_executing' || parentType === 'tool_output' || parentType === 'tool_complete';
}

function mergeTokenUsage(target: TelemetryEvent, incoming: TelemetryEvent): void {
  const fields = [
    'contextWindow', 'inputTokens', 'outputTokens', 'reservedTokens',
    'streamingTokens', 'totalTokens', 'turnTokens',
  ] as const;
  for (const field of fields) {
    const value = (incoming as Record<string, unknown>)[field];
    if (value != null) (target as Record<string, unknown>)[field] = value;
  }
}

/**
 * Frame-budget telemetry scheduler. Coalesces high-frequency events before they
 * reach React handlers, targeting ≤1 delivery burst per animation frame for P1–P3.
 */
export class RenderScheduler {
  private readonly deliver: (ev: TelemetryEvent) => void;
  private readonly p0Queue: TelemetryEvent[] = [];
  private readonly p1Queue: TelemetryEvent[] = [];
  private readonly p2Queue: TelemetryEvent[] = [];
  private readonly p3ByWorker = new Map<string, TelemetryEvent>();
  private flushHandle: number | null = null;
  private lastHeartbeatDelivered = 0;
  private pendingTokenUsage: TelemetryEvent | null = null;
  private readonly heartbeatMinMs: number;
  private readonly tokenMinMs: number;
  private lastTokenDelivered = 0;
  // Throttle loading-step updates to avoid re-rendering the whole panel every frame.
  private readonly loadingStepMinMs: number;
  private lastLoadingStepDelivered = 0;
  private pendingLoadingStep: TelemetryEvent | null = null;
  // Throttle per-worker progress updates so the crew panel only refreshes periodically.
  private readonly crewWorkerProgressMinMs: number;
  private readonly lastCrewWorkerProgressDelivered = new Map<string, number>();

  constructor(
    deliver: (ev: TelemetryEvent) => void,
    options?: { heartbeatMinMs?: number; tokenMinMs?: number; loadingStepMinMs?: number; crewWorkerProgressMinMs?: number },
  ) {
    this.deliver = deliver;
    this.heartbeatMinMs = options?.heartbeatMinMs ?? 1500;
    this.tokenMinMs = options?.tokenMinMs ?? 500;
    this.loadingStepMinMs = options?.loadingStepMinMs ?? 120;
    this.crewWorkerProgressMinMs = options?.crewWorkerProgressMinMs ?? 120;
    ensureRenderInstrumentation();
  }

  enqueue(ev: TelemetryEvent): void {
    const priority = classifyEventPriority(ev.type);

    if (priority === 'p0') {
      this.p0Queue.push(ev);
      this.scheduleFlush(true);
      return;
    }

    if (ev.type === 'turn_heartbeat') {
      this.p2Queue.push(ev);
      this.scheduleFlush();
      return;
    }

    if (ev.type === 'token_usage') {
      if (!this.pendingTokenUsage) {
        this.pendingTokenUsage = { ...ev };
      } else {
        mergeTokenUsage(this.pendingTokenUsage, ev);
        recordTelemetryCoalesced();
      }
      this.scheduleFlush();
      return;
    }

    if (ev.type === 'crew_worker_progress') {
      const workerId = String((ev as { workerId?: string }).workerId ?? 'unknown');
      this.p3ByWorker.set(workerId, ev);
      recordTelemetryCoalesced();
      this.scheduleFlush();
      return;
    }

    if (ev.type === 'loading_step_update') {
      this.pendingLoadingStep = { ...ev };
      recordTelemetryCoalesced();
      this.scheduleFlush();
      return;
    }

    if (priority === 'p1' || isSubagentToolEvent(ev)) {
      this.p1Queue.push(ev);
      this.scheduleFlush();
      return;
    }

    if (priority === 'p2') {
      this.p2Queue.push(ev);
      this.scheduleFlush();
      return;
    }

    if (priority === 'p3') {
      this.p3ByWorker.set(ev.type, ev);
      this.scheduleFlush();
      return;
    }

    this.p1Queue.push(ev);
    this.scheduleFlush();
  }

  private scheduleFlush(immediate = false): void {
    if (this.flushHandle != null) return;
    const run = () => {
      this.flushHandle = null;
      this.flush();
    };
    if (immediate) {
      this.flushHandle = requestAnimationFrame(run);
    } else {
      this.flushHandle = requestAnimationFrame(run);
    }
  }

  private flush(): void {
    recordRenderCommit();

    const p0 = this.p0Queue.splice(0);
    for (const ev of p0) {
      this.deliver(ev);
      recordTelemetryDelivered();
    }

    const p1 = this.p1Queue.splice(0);
    for (const ev of p1) {
      this.deliver(ev);
      recordTelemetryDelivered();
    }

    const now = Date.now();

    if (this.pendingTokenUsage && now - this.lastTokenDelivered >= this.tokenMinMs) {
      this.deliver(this.pendingTokenUsage);
      this.pendingTokenUsage = null;
      this.lastTokenDelivered = now;
      recordTelemetryDelivered();
    }

    if (this.pendingLoadingStep && now - this.lastLoadingStepDelivered >= this.loadingStepMinMs) {
      this.deliver(this.pendingLoadingStep);
      this.pendingLoadingStep = null;
      this.lastLoadingStepDelivered = now;
      recordTelemetryDelivered();
    }

    const p2 = this.p2Queue.splice(0);
    for (const ev of p2) {
      if (ev.type === 'turn_heartbeat') {
        if (now - this.lastHeartbeatDelivered < this.heartbeatMinMs) {
          recordTelemetryCoalesced();
          continue;
        }
        this.lastHeartbeatDelivered = now;
      }
      this.deliver(ev);
      recordTelemetryDelivered();
    }

    if (this.p3ByWorker.size > 0) {
      for (const [key, ev] of this.p3ByWorker.entries()) {
        if (ev.type === 'crew_worker_progress') {
          const last = this.lastCrewWorkerProgressDelivered.get(key) ?? 0;
          if (now - last < this.crewWorkerProgressMinMs) {
            continue;
          }
          this.lastCrewWorkerProgressDelivered.set(key, now);
        }
        this.deliver(ev);
        recordTelemetryDelivered();
        this.p3ByWorker.delete(key);
      }
    }

    const hasPending = this.p0Queue.length > 0 || this.p1Queue.length > 0 || this.p2Queue.length > 0
      || this.p3ByWorker.size > 0 || this.pendingTokenUsage != null;
    if (hasPending) this.scheduleFlush();
  }

  /** Flush any coalesced token usage on turn end. */
  flushPending(): void {
    if (this.pendingTokenUsage) {
      this.deliver(this.pendingTokenUsage);
      this.pendingTokenUsage = null;
      this.lastTokenDelivered = Date.now();
      recordTelemetryDelivered();
    }
  }
}
