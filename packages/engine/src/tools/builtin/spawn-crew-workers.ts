import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { Agent } from '../../agent/Agent.js';
import type { CrewMember } from '../../agent/CrewOrchestrator.js';
import { assessCrewNeed, isGeneralKnowledgeQuery } from '../../agent/crew-auto-compose.js';
import { isMissionInProgress } from '../../agent/crew-mission-registry.js';

let agentInstance: Agent | null = null;

export function setCrewMissionDeps(agent: Agent): void {
  agentInstance = agent;
}

function resolveMembers(crewNames: string[]): CrewMember[] {
  if (!agentInstance) return [];
  const all = agentInstance.getActiveCrewMembers() as CrewMember[];
  if (crewNames.length === 0) return all;
  const lower = crewNames.map((n) => n.toLowerCase().replace(/^@/, ''));
  return all.filter((m) =>
    lower.some((n) =>
      m.crew.callsign.toLowerCase() === n
      || m.crew.name.toLowerCase() === n
      || m.crew.id.toLowerCase() === n,
    ),
  );
}

export async function spawnCrewWorkers(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const task = (args['task'] as string) || (args['instruction'] as string);
  const crewsRaw = args['crews'] as string | string[] | undefined;

  if (!task) {
    return { success: false, output: 'task is required', error: 'MISSING_PARAMS' };
  }
  if (!agentInstance) {
    return { success: false, output: 'Crew mission orchestrator not available', error: 'NOT_CONFIGURED' };
  }

  if (isMissionInProgress(context.sessionId)) {
    return { success: false, output: 'A crew mission is already running in this session.', error: 'MISSION_BUSY' };
  }

  const crewNames = Array.isArray(crewsRaw)
    ? crewsRaw
    : typeof crewsRaw === 'string'
      ? crewsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  let members = resolveMembers(crewNames);
  if (members.length === 0) {
    return {
      success: false,
      output: 'No matching crew members. Configure crews or pass valid callsigns.',
      error: 'NO_CREWS',
    };
  }

  if (isGeneralKnowledgeQuery(task)) {
    return {
      success: false,
      output: 'Crew delegation blocked: this is a general information question. Answer directly as Agent-X (use web search if needed).',
      error: 'DELEGATION_DENIED',
    };
  }

  const assessment = assessCrewNeed(task, members);
  if (!assessment.shouldRoute || assessment.members.length === 0) {
    const names = members.map((m) => `@${m.crew.callsign}`).join(', ');
    return {
      success: false,
      output: `Crew delegation blocked: none of the requested crew (${names}) match this task. Answer directly as Agent-X.`,
      error: 'DELEGATION_DENIED',
    };
  }
  members = assessment.members;

  const guard = await agentInstance.guardCrewDelegation(task, members);
  if (!guard.allowed) {
    return {
      success: false,
      output: `Crew delegation blocked: ${guard.reason} Continue as Agent-X and complete the task yourself.`,
      error: 'DELEGATION_DENIED',
    };
  }

  try {
    const result = await agentInstance.runCrewMissionAndPublish(members, task, { emitLoading: true });
    const names = result.responses.map((r) => `@${r.callsign}`).join(', ') || members.map((m) => `@${m.crew.callsign}`).join(', ');

    return {
      success: result.success,
      output: [
        `[Crew mission complete] ${names} posted their response(s) in the chat.`,
        'Do NOT repeat their analysis — acknowledge briefly or synthesize only if multiple crews disagreed.',
        result.success ? '' : `Issues: ${result.synthesized.slice(0, 400)}`,
      ].filter(Boolean).join('\n'),
      metadata: {
        missionId: result.missionId,
        workers: result.workers.map((w) => ({
          crew: w.crewName,
          callsign: w.callsign,
          success: w.success,
          elapsed: w.elapsed,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      output: `Crew mission failed: ${err instanceof Error ? err.message : String(err)}`,
      error: 'MISSION_ERROR',
    };
  }
}
