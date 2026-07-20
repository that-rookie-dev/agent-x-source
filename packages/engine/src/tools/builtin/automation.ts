import type { ToolResult, ToolExecutionContext, AutomationNotifyChannel } from '@agentx/shared';
import { isChannelSessionId, resolveFleetToolSessionScope, parseChannelBindingFromSessionId } from '@agentx/shared';
import { getAutomationBridge } from '../../automation/automation-bridge.js';
import { inferAutomationSourceChannel, getNotificationChannelStatus } from '../../automation/automation-notify.js';
import { getAgentXOverviewBridge } from '../../agent/agent-x-overview-bridge.js';
import { inferAutomationTools, toolsNeedingConsent, NOTIFY_TOOL_IDS } from '../../automation/infer-automation-tools.js';

const AUTOMATION_NOTIFY_CHANNELS: AutomationNotifyChannel[] = ['in_app', 'desktop', 'telegram', 'slack', 'email', 'discord'];

function resolveNotifyChannelsFromConfig(config?: import('@agentx/shared').AgentXConfig | null): AutomationNotifyChannel[] {
  const status = getNotificationChannelStatus(config ?? undefined, {});
  const out: AutomationNotifyChannel[] = ['in_app'];
  if (status.telegram.configured && status.telegram.enabled) out.push('telegram');
  if (status.slack.configured && status.slack.enabled) out.push('slack');
  if (status.email.configured && status.email.enabled) out.push('email');
  if (status.discord.configured && status.discord.enabled) out.push('discord');
  return out;
}

export async function automationRegister(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const bridge = getAutomationBridge();
  if (!bridge) {
    return { success: false, output: 'Automation service not available', error: 'NO_AUTOMATION' };
  }

  const title = (args['title'] as string)?.trim();
  const instruction = (args['instruction'] as string)?.trim();
  const scheduleType = args['schedule_type'] as 'once' | 'recurring' | undefined;
  const runAt = args['run_at'] as string | undefined;
  const delaySeconds = args['delay_seconds'] as number | undefined;
  const cron = args['cron'] as string | undefined;
  const timezone = (args['timezone'] as string) ?? 'UTC';
  const taskKey = (args['task_key'] as string) ?? undefined;
  const sourceChannel = inferAutomationSourceChannel(
    (args['source_channel'] as string)
      ?? parseChannelBindingFromSessionId(context.sessionId)
      ?? context.sourceChannel,
    context.sessionId,
  );
  const requiredToolsRaw = args['required_tools'];
  const explicitTools = Array.isArray(requiredToolsRaw)
    ? requiredToolsRaw.filter((t): t is string => typeof t === 'string')
    : undefined;

  if (!title || !instruction) {
    return { success: false, output: 'title and instruction are required', error: 'INVALID_ARGS' };
  }
  if (scheduleType !== 'once' && scheduleType !== 'recurring') {
    return { success: false, output: 'schedule_type must be "once" or "recurring"', error: 'INVALID_ARGS' };
  }
  if (scheduleType === 'once' && !runAt && !(delaySeconds != null && delaySeconds > 0)) {
    return { success: false, output: 'run_at (ISO 8601) or delay_seconds is required for one-time tasks', error: 'INVALID_ARGS' };
  }
  if (scheduleType === 'recurring' && !cron) {
    return { success: false, output: 'cron expression is required for recurring tasks', error: 'INVALID_ARGS' };
  }

  const explicitNotifyRaw = args['notify_channels'];
  const explicitNotify = Array.isArray(explicitNotifyRaw)
    ? explicitNotifyRaw.filter((c): c is AutomationNotifyChannel =>
        typeof c === 'string' && AUTOMATION_NOTIFY_CHANNELS.includes(c as AutomationNotifyChannel)
      )
    : undefined;

  let notifyChannels: AutomationNotifyChannel[];
  if (explicitNotify && explicitNotify.length > 0) {
    notifyChannels = explicitNotify;
  } else if (context.voiceTurn) {
    // Voice sessions should not show a questionnaire. Use configured channels automatically.
    notifyChannels = resolveNotifyChannelsFromConfig(context.config);
  } else {
    notifyChannels = await bridge.promptNotifyChannels(context.sessionId);
  }
  await bridge.grantNotifyChannelTools(context.sessionId, notifyChannels);

  const inferred = inferAutomationTools(instruction, notifyChannels, explicitTools);
  const consentTools = toolsNeedingConsent(inferred).filter((t) => !NOTIFY_TOOL_IDS.has(t));
  if (consentTools.length > 0) {
    const approval = await bridge.ensureToolsApproved(context.sessionId, consentTools);
    if (!approval.ok) {
      const denied = approval.denied?.length ? ` Denied: ${approval.denied.join(', ')}.` : '';
      return {
        success: false,
        output: `${approval.error ?? 'Tool approval required before scheduling.'}${denied}`,
        error: 'TOOLS_NOT_APPROVED',
      };
    }
  }

  const result = await bridge.registerTask({
    title,
    instruction,
    scheduleType,
    runAt,
    delaySeconds: delaySeconds != null && delaySeconds > 0 ? delaySeconds : undefined,
    cron,
    timezone,
    taskKey,
    notifyChannels,
    sourceChannel,
    sourceSessionId: isChannelSessionId(context.sessionId)
      ? context.sessionId
      : (resolveFleetToolSessionScope(context.sessionId)
        ? context.sessionId
        : (getAgentXOverviewBridge()?.getActiveSessionId() ?? context.sessionId)),
  });

  if (!result.ok || !result.taskId) {
    return { success: false, output: result.error ?? 'Registration failed', error: 'REGISTER_FAILED' };
  }

  const channelNote = notifyChannels.length === 0
    ? ' No notifications configured.'
    : ` Notifications: ${notifyChannels.join(', ')}.`;
  const toolsNote = consentTools.length > 0
    ? ` Tools approved: ${consentTools.join(', ')}.`
    : '';
  return {
    success: true,
    output: `Automation registered (${result.displayId ?? result.taskId}). The task will run on schedule.${channelNote}${toolsNote}`,
  };
}

export async function automationList(
  _args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const bridge = getAutomationBridge();
  if (!bridge) {
    return { success: false, output: 'Automation service not available', error: 'NO_AUTOMATION' };
  }
  const scope = resolveFleetToolSessionScope(context.sessionId);
  const tasks = await bridge.listTasks(scope);
  if (tasks.length === 0) {
    return {
      success: true,
      output: scope
        ? 'No automation tasks registered for this session.'
        : 'No automation tasks registered.',
    };
  }
  const lines = tasks.map((t) => {
    const when = t.scheduleType === 'once'
      ? (t.runAt ? new Date(t.runAt).toLocaleString() : '—')
      : (t.cronExpression ?? '—');
    return `[${t.status}] ${t.title} | ${t.scheduleType} | ${when} | ${t.displayId || t.id}${t.taskKey ? ` | key: ${t.taskKey}` : ''}`;
  });
  return { success: true, output: `Automation tasks:\n${lines.join('\n')}` };
}

export async function automationCancel(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const bridge = getAutomationBridge();
  if (!bridge) {
    return { success: false, output: 'Automation service not available', error: 'NO_AUTOMATION' };
  }
  const id = (args['id'] as string) ?? (args['task_key'] as string) ?? (args['taskKey'] as string);
  if (!id) {
    return { success: false, output: 'Provide id or task_key to cancel', error: 'INVALID_ARGS' };
  }
  const scope = resolveFleetToolSessionScope(context.sessionId);
  const result = await bridge.cancelTask(id, scope);
  if (!result.ok) {
    return { success: false, output: result.error ?? 'Cancel failed', error: 'CANCEL_FAILED' };
  }
  return { success: true, output: `Automation cancelled (${id}).` };
}
