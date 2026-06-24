import type {
  SessionContextKind,
  SessionContextPolicy,
  SessionCrewRosterEntry,
  SessionNarrativeDocument,
} from '@agentx/shared';
import { userDeferredToAgent, isContinuationMessage } from '../agent/crew-auto-compose.js';

const TASK_HINT = /\b(plan|help|create|build|fix|trip|vacation|travel|itinerary|implement|design|write|analyze|prepare|surprise)\b/i;

function cleanText(text: string): string {
  return text
    .replace(/\n\[TURN[^\]]*\][^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSubstantive(text: string): boolean {
  const t = cleanText(text);
  return t.length > 25 || TASK_HINT.test(t);
}

function firstSentence(text: string, max = 320): string {
  const t = cleanText(text);
  const end = Math.min(
    ...[t.indexOf('.'), t.indexOf('!'), t.indexOf('?')].filter((i) => i > 20),
  );
  const sentence = Number.isFinite(end) && end > 0 ? t.slice(0, end + 1) : t.slice(0, max);
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function openIntentParagraph(text: string): string {
  const core = firstSentence(text, 400);
  return `The user opened this session to ${core.charAt(0).toLowerCase()}${core.slice(1)}`;
}

function userFollowUpParagraph(text: string, intent?: string): string {
  const t = cleanText(text);
  if (userDeferredToAgent(t)) {
    const goal = intent ? ` regarding ${firstSentence(intent, 120)}` : '';
    return `The user asked the assistant to decide and produce a complete plan${goal}, using reasonable assumptions instead of asking more clarifying questions.`;
  }
  if (isContinuationMessage(t) || t.split(/\s+/).length <= 10) {
    return `The user continued the same thread${intent ? ` (${firstSentence(intent, 100)})` : ''} with: "${firstSentence(t, 160)}"`;
  }
  return `The user shifted focus to: ${firstSentence(t, 280)}`;
}

function assistantParagraph(name: string, text: string): string {
  const summary = firstSentence(text, 260);
  return `${name} responded with guidance on ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
}

function crewIntroParagraph(entry: SessionCrewRosterEntry, kind: SessionContextKind): string {
  if (kind === 'crew_private' || entry.relationship === 'private_host') {
    return `This is a private conversation between the user and ${entry.name} (@${entry.callsign}). Agent-X is not part of this session.`;
  }
  if (entry.relationship === 'deployed') {
    return `Agent-X deployed ${entry.name} (@${entry.callsign}) to work on this request alongside the main session.`;
  }
  return `The user invoked ${entry.name} (@${entry.callsign}) for specialist input.`;
}

export function createEmptyNarrative(
  sessionId: string,
  kind: SessionContextKind,
  hostCrewId?: string,
): SessionNarrativeDocument {
  return {
    sessionId,
    kind,
    paragraphs: [],
    crewRoster: [],
    facts: [],
    turnCount: 0,
    updatedAt: new Date().toISOString(),
    hostCrewId,
  };
}

export function defaultPolicy(kind: SessionContextKind): SessionContextPolicy {
  return {
    kind,
    retention: 'session_only',
    limits: {
      maxNarrativeChars: kind === 'crew_private' ? 28_000 : 6_000,
      maxParagraphs: kind === 'crew_private' ? 100 : 24,
      maxFacts: kind === 'crew_private' ? 64 : 16,
    },
  };
}

export function appendUserTurn(doc: SessionNarrativeDocument, text: string): SessionNarrativeDocument {
  const clean = cleanText(text);
  if (!clean) return doc;

  if (!doc.intent && isSubstantive(clean)) {
    doc.intent = firstSentence(clean, 500);
    doc.paragraphs.push(openIntentParagraph(clean));
  } else {
    doc.paragraphs.push(userFollowUpParagraph(clean, doc.intent));
  }

  doc.currentFocus = userDeferredToAgent(clean) && doc.intent
    ? `Deliver on the session goal with stated assumptions: ${firstSentence(doc.intent, 200)}`
    : clean;

  doc.turnCount += 1;
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export function appendAssistantTurn(
  doc: SessionNarrativeDocument,
  text: string,
  speaker = 'Agent-X',
): SessionNarrativeDocument {
  const clean = cleanText(text);
  if (!clean || clean.length < 12) return doc;
  doc.paragraphs.push(assistantParagraph(speaker, clean));
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export function appendCrewTurn(
  doc: SessionNarrativeDocument,
  crewName: string,
  text: string,
): SessionNarrativeDocument {
  return appendAssistantTurn(doc, text, crewName);
}

export function registerCrewMember(
  doc: SessionNarrativeDocument,
  entry: SessionCrewRosterEntry,
): SessionNarrativeDocument {
  if (doc.crewRoster.some((c) => c.crewId === entry.crewId)) return doc;
  doc.crewRoster.push(entry);
  doc.paragraphs.push(crewIntroParagraph(entry, doc.kind));
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export function trimNarrative(doc: SessionNarrativeDocument, policy: SessionContextPolicy): SessionNarrativeDocument {
  const { maxParagraphs = 24, maxFacts = 16, maxNarrativeChars = 6000 } = policy.limits;

  if (doc.paragraphs.length > maxParagraphs) {
    const keepTail = maxParagraphs - 2;
    const overflow = doc.paragraphs.slice(2, doc.paragraphs.length - keepTail);
    if (doc.kind === 'crew_private' && overflow.length > 0) {
      const summary = `Earlier in this private thread (${overflow.length} turns condensed): ${overflow
        .map((p) => firstSentence(p, 72))
        .slice(0, 8)
        .join('; ')}`;
      if (!doc.facts.some((f) => f.startsWith('Earlier in this private thread'))) {
        doc.facts.unshift(summary);
      }
    }
    const head = doc.paragraphs.slice(0, 2);
    const tail = doc.paragraphs.slice(-keepTail);
    doc.paragraphs = [...head, ...tail];
  }

  if (doc.facts.length > maxFacts) {
    doc.facts = doc.facts.slice(-maxFacts);
  }

  let rendered = renderNarrativeText(doc);
  if (rendered.length > maxNarrativeChars) {
    while (doc.paragraphs.length > 3 && rendered.length > maxNarrativeChars) {
      doc.paragraphs.splice(2, 1);
      rendered = renderNarrativeText(doc);
    }
  }

  return doc;
}

export function renderNarrativeText(doc: SessionNarrativeDocument): string {
  const parts: string[] = [];

  parts.push(
    doc.kind === 'crew_private'
      ? 'This session is a private crew chat — memory applies only within this session and this specialist.'
      : 'This session is isolated — memory applies only here; do not reference other sessions or chats.',
  );

  if (doc.paragraphs.length > 0) {
    parts.push('', doc.paragraphs.join('\n\n'));
  }

  if (doc.crewRoster.length > 0) {
    const roster = doc.crewRoster
      .map((c) => `${c.name} (@${c.callsign})`)
      .join(', ');
    parts.push('', `Specialists in this session: ${roster}.`);
  }

  if (doc.facts.length > 0) {
    parts.push('', 'Key facts:', doc.facts.map((f) => `- ${f}`).join('\n'));
  }

  if (doc.currentFocus) {
    parts.push('', `Current focus: ${doc.currentFocus}`);
  }

  return parts.join('\n');
}

export function renderNarrativeBlock(doc: SessionNarrativeDocument, scopePath?: string | null): string {
  let body = renderNarrativeText(doc);
  if (scopePath && doc.kind === 'agent_x') {
    body += `\n\nWorkspace: ${scopePath}`;
  }
  return `[SESSION NARRATIVE]\n${body}\n[/SESSION NARRATIVE]`;
}
