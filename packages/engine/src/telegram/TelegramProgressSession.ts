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

export function formatProgressStatusText(activity: string | null, elapsedSec: number): string {
  const header = '⏳ Agent-X · Working…';
  if (activity) {
    return `${header}\n\n• ${activity} (${elapsedSec}s)`;
  }
  return `${header}\n\n• Thinking… (${elapsedSec}s)`;
}

const TYPING_INTERVAL_MS = 4_000;
const MIN_EDIT_INTERVAL_MS = 10_000;
const INITIAL_ACK = '⏳ Got it — working on your request…';

/**
 * Keeps Telegram users engaged during long agent turns:
 * immediate ack, refreshed typing indicator, and one editable status message.
 */
export class TelegramProgressSession {
  private chatId: number;
  private bridge: TelegramBridge;
  private agent: Agent;
  private startedAt = 0;
  private statusMessageId: number | null = null;
  private currentActivity: string | null = null;
  private lastEditAt = 0;
  private lastRenderedText = '';
  private editInFlight = false;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
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

    try {
      this.statusMessageId = await this.bridge.sendPlainMessage(this.chatId, INITIAL_ACK);
      this.lastRenderedText = INITIAL_ACK;
    } catch (err) {
      getLogger().warn(
        'TELEGRAM',
        `Progress ack failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    void this.bridge.sendChatAction(this.chatId, 'typing').catch(() => {});
    this.typingTimer = setInterval(() => {
      void this.bridge.sendChatAction(this.chatId, 'typing').catch(() => {});
    }, TYPING_INTERVAL_MS);

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
          void this.flushUpdate(true);
        }
        break;
      case 'turn_heartbeat':
        void this.flushUpdate(false);
        break;
      case 'loading_start':
        this.currentActivity = event.stage || 'Loading…';
        void this.flushUpdate(true);
        break;
      case 'processing_start':
        this.currentActivity = event.taskDescription?.slice(0, 80) || 'Processing…';
        void this.flushUpdate(true);
        break;
      case 'compaction_start':
        this.currentActivity = 'Compacting context…';
        void this.flushUpdate(true);
        break;
      case 'permission_required':
        this.currentActivity = 'Waiting for your approval…';
        void this.flushUpdate(true);
        break;
      case 'agent_spawned':
        this.currentActivity = 'Running sub-agent…';
        void this.flushUpdate(true);
        break;
      case 'crew_worker_spawned':
        this.currentActivity = `${event.callsign} working…`;
        void this.flushUpdate(true);
        break;
      case 'crew_mission_start':
        this.currentActivity = 'Crew mission started…';
        void this.flushUpdate(true);
        break;
      case 'decomposition_start':
        this.currentActivity = 'Breaking down task…';
        void this.flushUpdate(true);
        break;
      default:
        break;
    }
  }

  private async flushUpdate(force: boolean): Promise<void> {
    if (this.stopped || this.statusMessageId === null || this.editInFlight) return;

    const now = Date.now();
    if (!force && now - this.lastEditAt < MIN_EDIT_INTERVAL_MS) return;

    const elapsedSec = Math.max(1, Math.round((now - this.startedAt) / 1000));
    const text = formatProgressStatusText(this.currentActivity, elapsedSec);
    if (text === this.lastRenderedText && !force) return;

    this.editInFlight = true;
    try {
      const ok = await this.bridge.editMessageText(this.chatId, this.statusMessageId, text);
      if (ok) {
        this.lastEditAt = now;
        this.lastRenderedText = text;
      }
    } finally {
      this.editInFlight = false;
    }
  }
}
