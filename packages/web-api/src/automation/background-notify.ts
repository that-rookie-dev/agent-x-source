/**
 * Global telemetry listener that converts `background_task_complete` events into
 * NotificationRecords with fan-out to ALL connected surfaces (in-app, desktop,
 * and every configured external channel).
 *
 * This is the "single brain, multiple peripherals" model: when a background
 * sub-agent finishes, the user sees the result somewhere — notification tray,
 * OS notification, Telegram, Slack, Discord, or Email — regardless of which
 * surface they spawned it from.
 */
import type { AutomationNotifyChannel, TelemetryEvent } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getNotificationChannelStatus } from '@agentx/engine';
import { getEngine } from '../engine.js';
import { getTelegramRuntimeHints } from '../channels-sync.js';
import { deliverExternalNotifications } from './service.js';
import { getAutomationService } from './index.js';

let unsubscribe: (() => void) | null = null;

/**
 * Determine which channels should receive the notification.
 *
 * Strategy:
 * - Always include in_app + desktop (so the user sees it in the UI / OS notification).
 * - Include ALL configured external channels (telegram, slack, discord, email).
 * - The originating channel gets a thread-aware direct reply with the FULL result
 *   from SubAgentManager.notifyChannelOnCompletion(). We still include it in the
 *   notification fan-out because the notification is a short "✅ done" summary,
 *   while the direct reply is the full result — they serve different purposes.
 * - If the user wants to avoid the duplicate, they can dismiss the notification.
 */
function resolveBackgroundNotifyChannels(
  channelStatus: ReturnType<typeof getNotificationChannelStatus>,
): AutomationNotifyChannel[] {
  const channels: AutomationNotifyChannel[] = ['in_app', 'desktop'];
  if (channelStatus.telegram.configured) channels.push('telegram');
  if (channelStatus.slack.configured) channels.push('slack');
  if (channelStatus.discord.configured) channels.push('discord');
  if (channelStatus.email.configured) channels.push('email');
  return channels;
}

/**
 * Start listening for background_task_complete events on the engine telemetry bus.
 * Should be called once after the automation service and storage are initialized.
 */
export function startBackgroundTaskNotifier(): void {
  if (unsubscribe) return; // already started

  const eng = getEngine();

  unsubscribe = eng.telemetry.onEvent((rawEvent: TelemetryEvent) => {
    const ev = rawEvent as unknown as Record<string, unknown>;
    if (ev['type'] !== 'background_task_complete') return;

    void handleBackgroundTaskComplete(ev).catch((err) => {
      getLogger('BackgroundNotify').warn(
        'background-notify',
        `Failed to create notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

  getLogger('BackgroundNotify').info('background-notify', 'Background task notifier started');
}

export function stopBackgroundTaskNotifier(): void {
  unsubscribe?.();
  unsubscribe = null;
}

async function handleBackgroundTaskComplete(ev: Record<string, unknown>): Promise<void> {
  const service = getAutomationService();
  if (!service) return;

  const success = ev['success'] !== false;
  const instruction = (ev['instruction'] as string | undefined) ?? '';
  const summary = (ev['summary'] as string | undefined) ?? '';
  const taskId = (ev['taskId'] as string | undefined) ?? '';
  const elapsedMs = (ev['elapsedMs'] as number | undefined) ?? 0;
  const inboundChannel = ev['inboundChannel'] as string | undefined;
  const tokensUsed = (ev['tokensUsed'] as number | undefined) ?? 0;

  const eng = getEngine();
  const cfg = eng.configManager.load();
  const channelStatus = getNotificationChannelStatus(cfg, getTelegramRuntimeHints());
  const channels = resolveBackgroundNotifyChannels(channelStatus);

  // Build a user-friendly notification body
  const elapsedStr = elapsedMs > 0 ? `${Math.round(elapsedMs / 1000)}s` : '';
  const tokenStr = tokensUsed > 0 ? ` · ${tokensUsed.toLocaleString()} tokens` : '';
  const meta = [elapsedStr, tokenStr].filter(Boolean).join(' · ');

  const title = success
    ? '✅ Background task complete'
    : '❌ Background task failed';

  const bodyLines: string[] = [];
  if (instruction) {
    const shortInstruction = instruction.length > 200
      ? `${instruction.slice(0, 197)}…`
      : instruction;
    bodyLines.push(`**Task:** ${shortInstruction}`);
  }
  bodyLines.push('');
  bodyLines.push(summary || (success ? 'Completed successfully.' : 'Task failed.'));
  if (meta) bodyLines.push(`\n_${meta}_`);

  const body = bodyLines.join('\n');

  try {
    const notification = await service.publishNotification({
      taskId: null,
      kind: success ? 'background_task_complete' : 'background_task_failed',
      title,
      body,
      channels,
      payload: {
        taskId,
        instruction,
        inboundChannel,
        elapsedMs,
        tokensUsed,
        success,
      },
    });

    // Fan out to external channels (telegram, slack, discord, email)
    // in_app + desktop are handled by the notification_created WebSocket event
    await deliverExternalNotifications(notification, null, eng);

    getLogger('BackgroundNotify').debug(
      'background-notify',
      `Notification ${notification.id} created for task ${taskId} → channels: ${channels.join(', ')}`,
    );
  } catch (err) {
    getLogger('BackgroundNotify').warn(
      'background-notify',
      `Failed to publish notification for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
