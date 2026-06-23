import type { CrewMember } from './CrewOrchestrator.js';

export interface CrewDelegationIntent {
  detected: boolean;
  /** User asked for the whole crew when no specific members were named. */
  involveAll: boolean;
  namedMembers: CrewMember[];
  /** Task text with delegation boilerplate stripped when possible. */
  task: string;
  reason: string;
}

const DELEGATION_PHRASES: RegExp[] = [
  /\binvolv(e|ing)\s+(the\s+)?crew\b/i,
  /\b(get|bring|call)\s+(in\s+)?(the\s+)?crew\b/i,
  /\bask\s+(the\s+)?crew\b/i,
  /\blet\s+(the\s+)?crew\b/i,
  /\bhave\s+(the\s+)?crew\b/i,
  /\buse\s+(the\s+)?crew\b/i,
  /\b(the\s+)?crew\s+(should|handle|work|take)\b/i,
  /\bdelegate\s+(this|it|that)?\s*(to\s+)?(the\s+)?crew\b/i,
  /\bhand\s+(this|it)\s+(off|over)\s+to\s+(the\s+)?crew\b/i,
  /\b(team|specialists?)\s+(should|handle|work on|take)\b/i,
  /\bbring\s+in\s+(a\s+)?specialist\b/i,
  /\bget\s+(the\s+)?team\b/i,
  /\bcrew\s+members?\s+(should|need to|can)\b/i,
];

const INVOLVE_ALL_PHRASES: RegExp[] = [
  /\b(all|whole|entire)\s+(the\s+)?crew\b/i,
  /\binvolv(e|ing)\s+(the\s+)?crew\b/i,
  /\b(get|bring|call)\s+(in\s+)?(the\s+)?crew\b/i,
  /\bask\s+(the\s+)?crew\b/i,
  /\blet\s+(the\s+)?crew\b/i,
  /\bhave\s+(the\s+)?crew\b/i,
  /\buse\s+(the\s+)?crew\b/i,
  /\bdelegate\s+(this|it|that)?\s*(to\s+)?(the\s+)?crew\b/i,
];

const NEGATIVE_PHRASES: RegExp[] = [
  /\bwhat\s+is\s+(the\s+)?crew\b/i,
  /\bhow\s+(many|do)\b[^.]{0,40}\bcrew\b/i,
  /\b(crew\s+hub|configure\s+crew|add\s+(a\s+)?crew|delete\s+crew|disable\s+crew|enable\s+crew)\b/i,
  /\bcrew\s+(hub|settings|config|profile|dossier)\b/i,
];

const NAMED_DELEGATION_VERBS = /\b(have|ask|delegate|get|let|need)\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match crew by name or callsign without an @ prefix. */
export function resolveNamedCrewMentions(message: string, members: CrewMember[]): CrewMember[] {
  const lower = message.toLowerCase();
  const found: CrewMember[] = [];
  const seen = new Set<string>();

  for (const member of members) {
    const { callsign, name, id } = member.crew;
    const candidates = new Set<string>([
      callsign.toLowerCase(),
      name.toLowerCase(),
      name.toLowerCase().replace(/\s+/g, '_'),
      id.toLowerCase(),
    ]);

    for (const cand of candidates) {
      if (cand.length < 3) continue;
      const re = new RegExp(`\\b${escapeRegex(cand)}\\b`, 'i');
      if (re.test(lower)) {
        if (!seen.has(member.crew.id)) {
          seen.add(member.crew.id);
          found.push(member);
        }
        break;
      }
    }
  }

  return found;
}

function stripDelegationBoilerplate(message: string, members: CrewMember[]): string {
  let task = message
    .replace(/^(please\s+)?(can you\s+)?/i, '')
    .replace(/\b(involv(e|ing)|get|bring in|ask|let|have|use)\s+(the\s+)?crew\s+(to\s+|on\s+)?/gi, '')
    .replace(/\bdelegate\s+(this|it|that)?\s*(to\s+)?(the\s+)?crew\s*(to\s+)?/gi, '')
    .replace(/\b(the\s+)?crew\s+should\s+/gi, '')
    .replace(/\bhand\s+(this|it)\s+(off|over)\s+to\s+(the\s+)?crew\s*/gi, '')
    .trim();

  for (const member of members) {
    const name = escapeRegex(member.crew.name);
    const callsign = escapeRegex(member.crew.callsign);
    task = task
      .replace(new RegExp(`\\b(have|ask|let|get|delegate\\s+to)\\s+${name}\\s+(to\\s+)?`, 'gi'), '')
      .replace(new RegExp(`\\b(have|ask|let|get|delegate\\s+to)\\s+${callsign}\\s+(to\\s+)?`, 'gi'), '');
  }

  return task.length >= 8 ? task : message;
}

/** Detect natural-language crew delegation without @mentions. */
export function detectCrewDelegationIntent(
  message: string,
  members: CrewMember[],
): CrewDelegationIntent {
  const empty: CrewDelegationIntent = {
    detected: false,
    involveAll: false,
    namedMembers: [],
    task: message,
    reason: '',
  };

  if (members.length === 0) return empty;

  const trimmed = message.trim();
  if (NEGATIVE_PHRASES.some((p) => p.test(trimmed))) return empty;

  const namedMembers = resolveNamedCrewMentions(trimmed, members);
  const hasPhrase = DELEGATION_PHRASES.some((p) => p.test(trimmed));
  const hasNamedDelegation = namedMembers.length > 0 && NAMED_DELEGATION_VERBS.test(trimmed);

  if (!hasPhrase && !hasNamedDelegation) return empty;

  const involveAll = hasPhrase
    && namedMembers.length === 0
    && INVOLVE_ALL_PHRASES.some((p) => p.test(trimmed));

  const reason = namedMembers.length > 0
    ? 'named crew mention'
    : 'crew delegation phrase';

  return {
    detected: true,
    involveAll,
    namedMembers,
    task: stripDelegationBoilerplate(trimmed, members),
    reason,
  };
}
