import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import {
  getMissionByWorker,
  getMissionBySession,
  resolveCrewIdFromWorker,
} from '../../agent/crew-mission-registry.js';

function resolveMissionForWorker(sessionId: string) {
  return getMissionByWorker(sessionId) ?? getMissionBySession(sessionId);
}

function resolveTarget(
  to: string,
  members: Array<{ crew: { id: string; name: string; callsign: string } }>,
): { id: string; name: string; callsign: string } | 'agent-x' | null {
  const normalized = to.toLowerCase().replace(/^@/, '');
  if (normalized === 'agentx' || normalized === 'agent-x' || normalized === 'agent_x') {
    return 'agent-x';
  }
  const found = members.find(
    (m) =>
      m.crew.callsign.toLowerCase() === normalized
      || m.crew.id.toLowerCase() === normalized
      || m.crew.name.toLowerCase() === normalized
      || m.crew.name.toLowerCase().replace(/\s+/g, '_') === normalized,
  );
  return found?.crew ?? null;
}

export async function crewMessage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const to = String(args['to'] ?? '');
  const message = String(args['message'] ?? args['content'] ?? '');

  if (!to || !message) {
    return { success: false, output: 'to and message are required', error: 'MISSING_PARAMS' };
  }

  const mission = resolveMissionForWorker(context.sessionId);
  if (!mission) {
    return { success: false, output: 'No active crew mission for this worker', error: 'NO_MISSION' };
  }

  const fromCrewId = resolveCrewIdFromWorker(context.sessionId);
  const fromMember = mission.members.find((m) => m.crew.id === fromCrewId);
  const fromName = fromMember?.crew.name ?? 'Crew worker';
  const target = resolveTarget(to, mission.members);

  mission.context.addInterMessage(fromName, to, message);
  mission.eventBus.emit({
    type: 'crew_inter_message',
    from: fromName,
    to,
    content: message.slice(0, 300),
  } as never);

  if (target === 'agent-x') {
    mission.context.setMemory(`agentx_question:${fromCrewId ?? 'unknown'}`, message);
    return {
      success: true,
      output: 'Message sent to Agent-X. They will address it during mission review or clarification.',
    };
  }

  if (target && typeof target !== 'string' && mission.interCrewDelegate && fromCrewId) {
    try {
      const response = await mission.interCrewDelegate(fromCrewId, target.id, message);
      mission.context.addInterMessage(target.name, fromName, response);
      mission.eventBus.emit({
        type: 'crew_inter_message',
        from: target.name,
        to: fromName,
        content: response.slice(0, 300),
      } as never);
      return { success: true, output: response };
    } catch (err) {
      return {
        success: false,
        output: `Inter-crew message failed: ${err instanceof Error ? err.message : String(err)}`,
        error: 'INTER_CREW_ERROR',
      };
    }
  }

  if (target && typeof target !== 'string') {
    return {
      success: true,
      output: `Message recorded for @${target.callsign}. They will see it in shared mission context.`,
    };
  }

  return { success: false, output: `Crew member "${to}" not found in this mission`, error: 'NOT_FOUND' };
}

export async function crewResponse(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const to = args['to'] as string | undefined;
  const message = String(args['message'] ?? args['content'] ?? '');
  const replyToMessageId = args['replyToMessageId'] as string | undefined;

  if (to && message) {
    return crewMessage({ to, message }, context);
  }

  if (replyToMessageId && message) {
    const mission = resolveMissionForWorker(context.sessionId);
    const prior = mission?.context.interMessages.find((m) => m.id === replyToMessageId);
    if (prior) {
      return crewMessage({ to: prior.from, message }, context);
    }
    return { success: false, output: `Message ${replyToMessageId} not found`, error: 'NOT_FOUND' };
  }

  return { success: false, output: 'Provide to+message or replyToMessageId+content', error: 'MISSING_PARAMS' };
}
