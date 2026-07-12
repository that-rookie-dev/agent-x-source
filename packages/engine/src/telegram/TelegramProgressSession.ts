import type { EngineEvent } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { Agent } from '../agent/Agent.js';
import type { TelegramBridge } from './TelegramBridge.js';

/** Tools that run frequently and add noise without meaningful user-facing progress. */
export const QUIET_PROGRESS_TOOLS = new Set([
  'file_read',
  'folder_list',
  'folder_tree',
  'file_find',
  'code_grep',
  'code_search',
  'code_definitions',
  'code_symbols',
  'git_status',
  'git_diff',
  'git_log',
  'git_blame',
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'http_get',
  'web_browse',
  'memory_recall',
  'rag_query',
  'telegram_send_message',
]);

export function isQuietProgressTool(toolId: string): boolean {
  if (QUIET_PROGRESS_TOOLS.has(toolId)) return true;
  if (toolId.startsWith('mcp_')) return false;
  return false;
}

export function formatProgressToolLabel(toolId: string): string {
  const labels: Record<string, string> = {
    shell: 'Shell command',
    file_write: 'Writing file',
    file_edit: 'Editing file',
    file_delete: 'Deleting file',
    delegate_to_subagent: 'Sub-agent',
    crew_member: 'Crew member',
    git_commit: 'Git commit',
    git_push: 'Git push',
    test_run: 'Running tests',
  };
  if (labels[toolId]) return labels[toolId]!;
  return toolId.replace(/_/g, ' ');
}

/**
 * Hourglass + growing dots for the in-message Telegram loader.
 * Always shows the hourglass with at least one dot, grows to four dots,
 * then cycles back to a single dot.
 */
export const PROGRESS_LOADER_FRAMES = [
  '⏳.',
  '⏳..',
  '⏳...',
  '⏳....',
] as const;

export function formatProgressLoaderFrame(frameIndex: number): string {
  const frames = PROGRESS_LOADER_FRAMES;
  return frames[((frameIndex % frames.length) + frames.length) % frames.length]!;
}

export function formatProgressStatusText(
  activity: string | null,
  elapsedSec: number,
  frameIndex = 0,
): string {
  const loader = formatProgressLoaderFrame(frameIndex);
  if (activity) {
    return `${loader} ${activity} (${elapsedSec}s)`;
  }
  return loader;
}

const TYPING_INTERVAL_MS = 4_000;
const LOADER_ANIMATION_MS = 550;

/**
 * Keeps Telegram users engaged during long agent turns:
 * animated loader message (edited in place), refreshed typing indicator,
 * and optional activity line when meaningful work is underway.
 */
export class TelegramProgressSession {
  private chatId: number;
  private bridge: TelegramBridge;
  private agent: Agent;
  private startedAt = 0;
  private statusMessageId: number | null = null;
  private currentActivity: string | null = null;
  private loaderFrameIndex = 0;
  private lastRenderedText = '';
  private editInFlight = false;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private loaderTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  constructor(bridge: TelegramBridge, chatId: number, agent: Agent) {
    this.bridge = bridge;
    this.chatId = chatId;
    this.agent = agent;
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();
    this.stopped = false;
    this.loaderFrameIndex = 0;

    const initialText = formatProgressStatusText(null, 0, this.loaderFrameIndex);
    try {
      this.statusMessageId = await this.bridge.sendPlainMessage(this.chatId, initialText);
      this.lastRenderedText = initialText;
    } catch (err) {
      getLogger().warn(
        'TELEGRAM',
        `Progress loader failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    void this.bridge.sendChatAction(this.chatId, 'typing').catch(() => {});
    this.typingTimer = setInterval(() => {
      void this.bridge.sendChatAction(this.chatId, 'typing').catch(() => {});
    }, TYPING_INTERVAL_MS);

    this.loaderTimer = setInterval(() => {
      this.loaderFrameIndex += 1;
      void this.flushDisplay(false);
    }, LOADER_ANIMATION_MS);

    this.unsubscribe = this.agent.events.on((event) => {
      this.handleEvent(event);
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.loaderTimer) {
      clearInterval(this.loaderTimer);
      this.loaderTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.statusMessageId !== null) {
      try {
        await this.bridge.deleteMessage(this.chatId, this.statusMessageId);
      } catch {
        // Best effort — final reply follows regardless.
      }
      this.statusMessageId = null;
    }
  }

  private handleEvent(event: EngineEvent): void {
    if (this.stopped) return;

    switch (event.type) {
      case 'tool_executing':
        if (!isQuietProgressTool(event.tool)) {
          this.currentActivity = event.description?.trim() || formatProgressToolLabel(event.tool);
          void this.flushDisplay(true);
        }
        break;
      case 'turn_heartbeat':
        void this.flushDisplay(false);
        break;
      case 'loading_start':
        this.currentActivity = event.stage || 'Loading…';
        void this.flushDisplay(true);
        break;
      case 'processing_start':
        this.currentActivity = event.taskDescription?.slice(0, 80) || 'Processing…';
        void this.flushDisplay(true);
        break;
      case 'compaction_start':
        this.currentActivity = 'Compacting context…';
        void this.flushDisplay(true);
        break;
      case 'permission_required':
        this.currentActivity = 'Waiting for your approval…';
        void this.flushDisplay(true);
        break;
      case 'agent_spawned':
        this.currentActivity = 'Running sub-agent…';
        void this.flushDisplay(true);
        break;
      case 'crew_worker_spawned':
        this.currentActivity = `${event.callsign} working…`;
        void this.flushDisplay(true);
        break;
      case 'crew_mission_start':
        this.currentActivity = 'Crew mission started…';
        void this.flushDisplay(true);
        break;
      case 'decomposition_start':
        this.currentActivity = 'Breaking down task…';
        void this.flushDisplay(true);
        break;
      default:
        break;
    }
  }

  private async flushDisplay(force: boolean): Promise<void> {
    if (this.stopped || this.statusMessageId === null || this.editInFlight) return;

    const now = Date.now();
    const elapsedSec = Math.max(1, Math.round((now - this.startedAt) / 1000));
    const text = formatProgressStatusText(this.currentActivity, elapsedSec, this.loaderFrameIndex);
    if (text === this.lastRenderedText && !force) return;

    this.editInFlight = true;
    try {
      if (this.stopped || this.statusMessageId === null) return;
      const ok = await this.bridge.editMessageText(this.chatId, this.statusMessageId, text);
      if (ok) {
        this.lastRenderedText = text;
      }
    } catch {
      // Loader message may have been deleted when the turn ended.
    } finally {
      this.editInFlight = false;
    }
  }
}
