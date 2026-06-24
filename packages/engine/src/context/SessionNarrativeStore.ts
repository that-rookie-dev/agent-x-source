import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionNarrativeDocument } from '@agentx/shared';

/** In-memory narrative store — keyed strictly by sessionId (no cross-session access). */
export class SessionNarrativeStore {
  private readonly narratives = new Map<string, SessionNarrativeDocument>();
  private persistDir: string | null = null;

  setPersistDir(dir: string | null): void {
    this.persistDir = dir;
  }

  load(sessionId: string): SessionNarrativeDocument | null {
    this.assertId(sessionId);

    const cached = this.narratives.get(sessionId);
    if (cached) {
      return {
        ...cached,
        paragraphs: [...cached.paragraphs],
        crewRoster: [...cached.crewRoster],
        facts: [...cached.facts],
      };
    }

    if (this.persistDir) {
      const path = this.filePath(sessionId);
      if (existsSync(path)) {
        try {
          const raw = JSON.parse(readFileSync(path, 'utf-8')) as SessionNarrativeDocument;
          if (raw.sessionId !== sessionId) return null;
          this.narratives.set(sessionId, raw);
          return raw;
        } catch { /* fall through */ }
      }
    }

    return null;
  }

  save(doc: SessionNarrativeDocument): void {
    this.assertId(doc.sessionId);
    this.narratives.set(doc.sessionId, doc);

    if (this.persistDir) {
      try {
        mkdirSync(this.persistDir, { recursive: true });
        writeFileSync(this.filePath(doc.sessionId), JSON.stringify(doc, null, 2), 'utf-8');
      } catch { /* best-effort */ }
    }
  }

  delete(sessionId: string): void {
    this.assertId(sessionId);
    this.narratives.delete(sessionId);
    if (this.persistDir) {
      const path = this.filePath(sessionId);
      try {
        if (existsSync(path)) writeFileSync(path, '', 'utf-8');
      } catch { /* ignore */ }
    }
  }

  private filePath(_sessionId: string): string {
    return join(this.persistDir!, 'session-narrative.json');
  }

  private assertId(sessionId: string): void {
    if (!sessionId?.trim()) throw new Error('sessionId required for narrative store');
  }
}

/** Process-wide store; isolation enforced by sessionId key + handler checks. */
export const globalNarrativeStore = new SessionNarrativeStore();
