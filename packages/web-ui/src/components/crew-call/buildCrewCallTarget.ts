import type { Crew, CrewVoiceSessionInfo, SessionInfo } from '../../api';
import { getCrewAccent } from '../../styles/crew-theme';
import type { PrebuiltCrew } from '../crew/hub-types';
import type { CrewCallRecruitPayload, CrewCallTarget } from './types';

function recruitFromPrebuilt(crew: PrebuiltCrew, rosterCrewId?: string): CrewCallRecruitPayload {
  return {
    id: rosterCrewId ?? `hub-${crew.callsign}`,
    name: crew.name,
    title: crew.title,
    callsign: crew.callsign,
    systemPrompt: crew.systemPrompt,
    description: crew.description,
    tone: crew.tone,
    expertise: crew.expertise,
    traits: crew.traits,
    tools: crew.tools,
    source: 'hub',
    catalogId: crew.catalogId ?? `hub-${crew.callsign}`,
    categoryId: crew.categoryId,
  };
}

export function crewCallTargetFromPrebuilt(
  crew: PrebuiltCrew,
  opts?: { rosterCrewId?: string; accent?: string },
): CrewCallTarget {
  return {
    crewId: opts?.rosterCrewId,
    recruit: recruitFromPrebuilt(crew, opts?.rosterCrewId),
    displayName: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    accent: getCrewAccent(opts?.accent, crew.callsign),
  };
}

export function crewCallTargetFromRoster(crew: Crew, accent?: string): CrewCallTarget {
  return {
    crewId: crew.id,
    recruit: {
      id: crew.id,
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      systemPrompt: crew.systemPrompt,
      description: crew.description,
      tone: crew.tone,
      expertise: crew.expertise,
      traits: crew.traits,
      tools: crew.tools,
      source: crew.catalogId ? 'hub' : 'custom',
      catalogId: crew.catalogId,
      categoryId: crew.categoryId,
      color: crew.color,
    },
    displayName: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    accent: getCrewAccent(accent ?? crew.color, crew.callsign),
  };
}

/** Resume voice on an existing crew-private chat session. */
export function crewCallTargetFromSession(session: SessionInfo): CrewCallTarget | null {
  if ((session.contextKind ?? 'agent_x') !== 'crew_private') return null;
  if (session.id.startsWith('voice:')) return null;
  const callsign = session.hostCrewCallsign ?? 'crew';
  const displayName = session.hostCrewName ?? session.title ?? callsign;
  return {
    sessionId: session.id,
    crewId: session.hostCrewId ?? session.crewId,
    displayName,
    callsign,
    title: session.hostCrewTitle,
    accent: getCrewAccent(session.hostCrewColor, callsign),
  };
}

export function crewCallTargetFromPrivateHost(opts: {
  sessionId: string;
  crewId?: string | null;
  host: { name: string; callsign: string; title?: string; color?: string };
  accent?: string;
}): CrewCallTarget {
  return {
    sessionId: opts.sessionId,
    crewId: opts.crewId ?? undefined,
    displayName: opts.host.name,
    callsign: opts.host.callsign,
    title: opts.host.title,
    accent: getCrewAccent(opts.accent ?? opts.host.color, opts.host.callsign),
  };
}

/** Call again from a voice history row — binds the text sibling, never `voice:…`. */
export function crewCallTargetFromVoiceSession(row: CrewVoiceSessionInfo): CrewCallTarget | null {
  const textSessionId = row.textSessionId
    ?? (row.id.startsWith('voice:') ? row.id.slice('voice:'.length) : null);
  if (!textSessionId && !row.hostCrewId) return null;
  const callsign = row.hostCrewCallsign ?? 'crew';
  const displayName = row.hostCrewName ?? row.title ?? callsign;
  return {
    sessionId: textSessionId ?? undefined,
    crewId: row.hostCrewId ?? undefined,
    displayName,
    callsign,
    title: row.hostCrewTitle ?? undefined,
    accent: getCrewAccent(row.hostCrewColor ?? undefined, callsign),
  };
}
