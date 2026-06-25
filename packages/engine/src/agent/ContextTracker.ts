import type { SessionContextKind, SessionContextLimits } from '@agentx/shared';
import {
  SessionContextHandler,
  createSessionContextHandler,
  createCrewPrivateContextHandler,
} from '../context/SessionContextHandler.js';

export interface ContextEntry {
  type: 'task' | 'decision' | 'question' | 'delegation' | 'fact';
  detail: string;
  ts: number;
}

export interface ContextTrackerOptions {
  kind?: SessionContextKind;
  hostCrewId?: string;
  hostCrewName?: string;
  hostCrewCallsign?: string;
}

/**
 * Thin facade over SessionContextHandler — narrative story memory per session.
 * Legacy name retained for Agent integration.
 */
export class ContextTracker {
  private handler: SessionContextHandler;

  constructor(_db: unknown, sessionId: string, opts?: ContextTrackerOptions) {
    if (opts?.kind === 'crew_private' && opts.hostCrewId && opts.hostCrewName && opts.hostCrewCallsign) {
      this.handler = createCrewPrivateContextHandler({
        sessionId,
        crewId: opts.hostCrewId,
        crewName: opts.hostCrewName,
        callsign: opts.hostCrewCallsign,
      });
    } else {
      this.handler = createSessionContextHandler({
        sessionId,
        kind: opts?.kind ?? 'agent_x',
      });
    }
  }

  getHandler(): SessionContextHandler {
    return this.handler;
  }

  setPersistDir(dir: string): void {
    this.handler.setPersistDir(dir);
  }

  setScopePath(scopePath: string): void {
    this.handler.setScopePath(scopePath);
  }

  record(role: 'user' | 'assistant' | 'crew', content: string, crewName?: string): void {
    if (role === 'user') this.handler.recordUser(content);
    else if (role === 'crew') this.handler.recordCrew(crewName ?? 'Crew', content);
    else this.handler.recordAssistant(content, crewName ?? 'Agent-X');
  }

  getContextSummary(): string {
    return this.handler.getContextSummary();
  }

  getRecentHistory(): string {
    return this.handler.getRecentHistory();
  }

  getStructuredContext(): string {
    return this.handler.getStructuredContext();
  }

  getSessionIntent(): string {
    return this.handler.getSessionIntent();
  }

  getTextForExpertiseCheck(): string {
    const doc = this.handler.getNarrativeDocument();
    return [doc.intent ?? '', ...doc.paragraphs.slice(-3)].join(' ');
  }

  clear(): void {
    this.handler.clear();
  }

  rebuildFromMessages(messages: Array<{ role: string; content: string }>): number {
    return this.handler.rebuildFromMessages(messages);
  }

  setLimits(opts: { maxHistoryMessages?: number; maxHistoryChars?: number; maxBlockChars?: number }): void {
    const limits: SessionContextLimits = {};
    if (opts.maxHistoryChars !== undefined) limits.maxNarrativeChars = opts.maxHistoryChars;
    if (opts.maxBlockChars !== undefined) limits.maxNarrativeChars = opts.maxBlockChars;
    if (opts.maxHistoryMessages !== undefined) {
      limits.maxParagraphs = Math.max(8, Math.min(opts.maxHistoryMessages, 40));
    }
    this.handler.setLimits(limits);
  }

  getAll(): ContextEntry[] {
    const doc = this.handler.getNarrativeDocument();
    return doc.paragraphs.map((p, i) => ({
      type: 'fact' as const,
      detail: p,
      ts: Date.parse(doc.updatedAt) + i,
    }));
  }
}
