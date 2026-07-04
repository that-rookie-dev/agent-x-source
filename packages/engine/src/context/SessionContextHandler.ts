import type {
  SessionContextKind,
  SessionContextLimits,
  SessionContextPolicy,
  SessionCrewRosterEntry,
  SessionNarrativeDocument,
} from '@agentx/shared';
import {
  appendAssistantTurn,
  appendCrewTurn,
  appendUserTurn,
  createEmptyNarrative,
  defaultPolicy,
  registerCrewMember,
  renderNarrativeBlock,
  renderNarrativeText,
  trimNarrative,
} from './NarrativeBuilder.js';
import { globalNarrativeStore, SessionNarrativeStore } from './SessionNarrativeStore.js';
import { buildTurnContext, needsContextMerge, extractSessionIntent } from '../agent/TurnContextAssembler.js';

export interface SessionContextHandlerConfig {
  sessionId: string;
  kind?: SessionContextKind;
  hostCrewId?: string;
  hostCrewName?: string;
  hostCrewCallsign?: string;
  store?: SessionNarrativeStore;
  limits?: SessionContextLimits;
}

export interface TurnInjectionResult {
  block: string;
  mergedTask: string;
  sessionIntent: string;
  needsContextMerge: boolean;
}

/**
 * Session-scoped narrative context handler.
 * - agent_x: fresh narrative per session, story paragraphs, crew roster tracking
 * - crew_private: foundation for 1:1 user↔crew chats (no Agent-X), lifelong within session
 */
export class SessionContextHandler {
  readonly sessionId: string;
  readonly kind: SessionContextKind;
  private readonly policy: SessionContextPolicy;
  private readonly store: SessionNarrativeStore;
  private doc: SessionNarrativeDocument;
  private scopePath: string | null = null;

  constructor(config: SessionContextHandlerConfig) {
    if (!config.sessionId?.trim()) {
      throw new Error('SessionContextHandler requires a sessionId');
    }

    this.sessionId = config.sessionId;
    this.kind = config.kind ?? 'agent_x';
    this.store = config.store ?? globalNarrativeStore;
    this.policy = {
      ...defaultPolicy(this.kind),
      limits: { ...defaultPolicy(this.kind).limits, ...config.limits },
    };

    const loaded = this.store.load(this.sessionId);
    if (loaded && loaded.sessionId !== this.sessionId) {
      throw new Error('Session context isolation violation on load');
    }

    this.doc = loaded ?? createEmptyNarrative(this.sessionId, this.kind, config.hostCrewId);

    if (
      !loaded
      && this.kind === 'crew_private'
      && config.hostCrewId
      && config.hostCrewName
      && config.hostCrewCallsign
    ) {
      this.doc = registerCrewMember(this.doc, {
        crewId: config.hostCrewId,
        name: config.hostCrewName,
        callsign: config.hostCrewCallsign,
        relationship: 'private_host',
      });
      this.persist();
    }
  }

  setPersistDir(dir: string): void {
    this.store.setPersistDir(dir);
    const reloaded = this.store.load(this.sessionId);
    if (reloaded) this.doc = reloaded;
    else this.persist();
  }

  setScopePath(scopePath: string): void {
    this.scopePath = scopePath;
  }

  assertSameSession(otherSessionId: string): void {
    if (otherSessionId !== this.sessionId) {
      throw new Error(`Session context isolation: expected ${this.sessionId}, got ${otherSessionId}`);
    }
  }

  recordUser(text: string): void {
    this.doc = appendUserTurn(this.doc, text);
    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
  }

  recordAssistant(text: string, speaker = 'Agent-X'): void {
    if (this.kind === 'crew_private' && speaker === 'Agent-X') return;
    this.doc = appendAssistantTurn(this.doc, text, speaker);
    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
  }

  recordCrew(crewName: string, text: string): void {
    this.doc = appendCrewTurn(this.doc, crewName, text);
    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
  }

  registerCrew(entry: Omit<SessionCrewRosterEntry, 'relationship'> & { relationship?: SessionCrewRosterEntry['relationship'] }): void {
    this.doc = registerCrewMember(this.doc, {
      crewId: entry.crewId,
      name: entry.name,
      callsign: entry.callsign,
      relationship: entry.relationship ?? 'deployed',
    });
    this.persist();
  }

  addFact(fact: string): void {
    const trimmed = fact.trim();
    if (!trimmed) return;
    this.doc.facts.push(trimmed);
    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
  }

  getNarrativeDocument(): Readonly<SessionNarrativeDocument> {
    return this.doc;
  }

  getNarrativeText(): string {
    return renderNarrativeText(this.doc);
  }

  getNarrativeBlock(): string {
    return renderNarrativeBlock(this.doc, this.scopePath);
  }

  /** For prompt assembly — story narrative, not chat transcript. */
  getContextSummary(): string {
    return this.getNarrativeBlock();
  }

  /** Deprecated chat-style history — intentionally empty; narrative replaces it. */
  getRecentHistory(): string {
    if (!this.doc.currentFocus) return '';
    return `[CURRENT FOCUS]\n${this.doc.currentFocus}\n[/CURRENT FOCUS]`;
  }

  getStructuredContext(): string {
    return this.getNarrativeText();
  }

  getSessionIntent(): string {
    return this.doc.intent ?? '';
  }

  buildTurnInjection(
    messages: Array<{ role: string; content: string }>,
    currentUserMessage: string,
    maxBlockChars?: number,
    skipRecentExchange?: boolean,
  ): TurnInjectionResult {
    const priorUsers = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(0, -1);
    const sessionIntent = this.doc.intent || extractSessionIntent(messages);
    const merge = needsContextMerge(currentUserMessage, priorUsers);

    const turn = buildTurnContext({
      messages,
      currentUserMessage,
      scopePath: this.scopePath,
      structuredSummary: '',
      maxBlockChars: 800,
      skipRecentExchange,
    });

    const narrativeBlock = this.getNarrativeBlock();
    const current = currentUserMessage.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim();
    const turnLines = [`Current request: ${current.slice(0, 300)}`];
    if (merge && sessionIntent) {
      turnLines.push('This message continues the session narrative — execute against the established goal with reasonable assumptions.');
    }
    const turnBlock = `[CURRENT TURN]\n${turnLines.join('\n')}\n[/CURRENT TURN]`;
    let block = `${narrativeBlock}\n\n${turnBlock}`;
    if (maxBlockChars && block.length > maxBlockChars) {
      block = block.slice(0, maxBlockChars - 20) + '…';
    }

    return {
      block,
      mergedTask: turn.mergedTask,
      sessionIntent,
      needsContextMerge: merge,
    };
  }

  rebuildFromMessages(messages: Array<{ role: string; content: string }>): number {
    const hostCrewId = this.doc.hostCrewId;
    const priorRoster = [...this.doc.crewRoster];
    this.doc = createEmptyNarrative(this.sessionId, this.kind, hostCrewId);

    for (const c of priorRoster) {
      this.doc = registerCrewMember(this.doc, c);
    }

    let count = 0;
    for (const msg of messages) {
      if (!msg.content?.trim()) continue;
      if (msg.role === 'user') {
        this.doc = appendUserTurn(this.doc, msg.content);
        count++;
      } else if (msg.role === 'assistant') {
        const speaker = this.kind === 'crew_private'
          ? (this.doc.crewRoster.find((c) => c.relationship === 'private_host')?.name
            ?? this.doc.crewRoster[0]?.name
            ?? 'Crew')
          : 'Agent-X';
        this.doc = appendAssistantTurn(this.doc, msg.content, speaker);
        count++;
      }
    }

    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
    return count;
  }

  clear(): void {
    this.doc = createEmptyNarrative(this.sessionId, this.kind, this.doc.hostCrewId);
    this.store.delete(this.sessionId);
  }

  setLimits(limits: SessionContextLimits): void {
    Object.assign(this.policy.limits, limits);
    this.doc = trimNarrative(this.doc, this.policy);
    this.persist();
  }

  private persist(): void {
    if (this.doc.sessionId !== this.sessionId) {
      throw new Error('Session context isolation violation on persist');
    }
    this.store.save(this.doc);
  }
}

export function createSessionContextHandler(config: SessionContextHandlerConfig): SessionContextHandler {
  return new SessionContextHandler(config);
}

/** Factory for future crew private chat sessions. */
export function createCrewPrivateContextHandler(input: {
  sessionId: string;
  crewId: string;
  crewName: string;
  callsign: string;
  store?: SessionNarrativeStore;
}): SessionContextHandler {
  return new SessionContextHandler({
    sessionId: input.sessionId,
    kind: 'crew_private',
    hostCrewId: input.crewId,
    hostCrewName: input.crewName,
    hostCrewCallsign: input.callsign,
    store: input.store,
  });
}
