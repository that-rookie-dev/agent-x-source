import type { SessionContextKind } from '../types/session-context.js';
import { isSuperSessionId } from './channel-session.js';

/** How crew members may participate in a session. */
export type CrewParticipationMode = 'none' | 'explicit_only' | 'host_only';

export type CrewInvolvementVia =
  | 'mention'
  | 'delegate_picker'
  | 'active_continuation'
  | 'spawn_tool'
  | 'delegate_tool'
  | 'resume_intake';

/**
 * Resolve crew participation rules for a session.
 *
 * - agent_x_core + messaging channel super-sessions: Agent-X only (no crew).
 * - agent_x / child sessions: crew only via @mention or roster-picker approval.
 * - crew_private: host crew only (handled by promptProfile, not orchestration paths).
 */
export function crewParticipationMode(
  contextKind?: SessionContextKind,
  sessionId?: string | null,
): CrewParticipationMode {
  if (contextKind === 'crew_private') return 'host_only';
  if (contextKind === 'agent_x_core' || contextKind === 'automation') return 'none';
  if (isSuperSessionId(sessionId)) return 'none';
  return 'explicit_only';
}

export function allowsCrewInvolvement(
  via: CrewInvolvementVia,
  contextKind?: SessionContextKind,
  sessionId?: string | null,
): boolean {
  const mode = crewParticipationMode(contextKind, sessionId);
  if (mode === 'none' || mode === 'host_only') return false;
  return via === 'mention' || via === 'delegate_picker' || via === 'resume_intake';
}

/** Block spawn_crew_workers / delegate_to_crew unless user explicitly routed crew this turn. */
export function deniesAutonomousCrewTools(
  contextKind?: SessionContextKind,
  sessionId?: string | null,
): boolean {
  const mode = crewParticipationMode(contextKind, sessionId);
  return mode === 'none' || mode === 'explicit_only';
}
