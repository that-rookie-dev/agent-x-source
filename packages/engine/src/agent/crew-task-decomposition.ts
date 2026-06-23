import type { CrewMember } from './CrewOrchestrator.js';

export type CrewMissionProtocol = 'parallel' | 'sequential' | 'debate' | 'handoff';

/**
 * Split a user message into per-crew task assignments based on @mention spans
 * and crew expertise hints.
 */
export function decomposeCrewTasks(
  userMessage: string,
  members: CrewMember[],
): Map<string, string> {
  const tasks = new Map<string, string>();
  const stripped = userMessage.replace(/(?<!\w)@\w+/g, '').replace(/\s+/g, ' ').trim();
  const mentionCount = (userMessage.match(/(?<!\w)@\w+/g) ?? []).length;

  for (const member of members) {
    const { callsign, name, expertise } = member.crew;
    const slug = name.replace(/\s+/g, '_');
    const patterns = [
      new RegExp(`@${callsign}\\b[^@]*`, 'i'),
      new RegExp(`@${slug}\\b[^@]*`, 'i'),
    ];

    let extracted = '';
    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match) {
        extracted = match[0]!
          .replace(new RegExp(`@${callsign}\\b`, 'i'), '')
          .replace(new RegExp(`@${slug}\\b`, 'i'), '')
          .replace(/^[:\s,-]+/, '')
          .trim();
        break;
      }
    }

    if (extracted.length > 10) {
      tasks.set(member.crew.id, extracted);
    } else if (mentionCount <= 1) {
      tasks.set(member.crew.id, stripped || userMessage);
    } else {
      const domain = expertise?.length ? expertise.join(', ') : name;
      tasks.set(
        member.crew.id,
        `${stripped || userMessage}\n\nYour focus (@${callsign}): apply your ${domain} expertise to your portion of this mission.`,
      );
    }
  }

  return tasks;
}

export function resolveMissionProtocol(members: CrewMember[]): CrewMissionProtocol {
  const protocols = members.map((m) => m.crew.protocol ?? 'standard');
  const unique = new Set(protocols);

  if (unique.has('debate')) return 'debate';
  if (unique.has('handoff')) return 'handoff';
  if (protocols.some((p) => p === 'sequential')) return 'sequential';
  if (unique.size === 1 && unique.has('parallel')) return 'parallel';
  return members.length > 1 ? 'parallel' : 'parallel';
}
