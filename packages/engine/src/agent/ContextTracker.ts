import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TASK_PATTERNS = /\b(build|create|draft|write|implement|deploy|fix|refactor|review|test|optimize|install|configure|migrate|design|plan|analyze|audit|document|translate|convert|setup)\b/i;
const DECISION_PATTERNS = /\b(done|completed|finished|created|deleted|updated|moved|copied|saved|committed|deployed|published|resolved|fixed|merged)\b/i;
const QUESTION_PATTERNS = /\?$/;

export interface ContextEntry {
  type: 'task' | 'decision' | 'question' | 'delegation' | 'fact';
  detail: string;
  ts: number;
}

export class ContextTracker {
  private store = new Map<string, ContextEntry[]>();
  private maxEntries = 40;
  private sessionDir: string | null = null;

  setSessionDir(dir: string): void {
    this.sessionDir = dir;
    this.loadFromDisk();
  }

  record(sessionId: string, role: 'user' | 'assistant' | 'crew', content: string, crewName?: string): void {
    const entries = this.store.get(sessionId) ?? [];
    const now = Date.now();

    if (role === 'user') {
      let recorded = false;
      if (QUESTION_PATTERNS.test(content.trim())) {
        entries.push({ type: 'question', detail: content.trim().slice(0, 200), ts: now });
        recorded = true;
      }
      if (TASK_PATTERNS.test(content)) {
        entries.push({ type: 'task', detail: this.firstSentence(content, 200), ts: now });
        recorded = true;
      }
      const mentionMatch = content.match(/@(\w+)/);
      if (mentionMatch) {
        entries.push({ type: 'delegation', detail: `User requested @${mentionMatch[1]} to handle: ${this.firstSentence(content, 150)}`, ts: now });
        recorded = true;
      }
      // Always capture at least the first sentence of every user message for context awareness
      if (!recorded) {
        entries.push({ type: 'fact', detail: `User: ${this.firstSentence(content, 200)}`, ts: now });
      }
    }

    if (role === 'assistant' || role === 'crew') {
      const displayName = crewName ?? 'Agent-X';
      if (DECISION_PATTERNS.test(content)) {
        entries.push({ type: 'decision', detail: `${displayName}: ${this.firstSentence(content, 200)}`, ts: now });
      } else {
        entries.push({ type: 'fact', detail: `${displayName}: ${this.firstSentence(content, 200)}`, ts: now });
      }
    }

    while (entries.length > this.maxEntries) entries.shift();
    this.store.set(sessionId, entries);
    this.saveToDisk();
  }

  getContextSummary(sessionId: string): string {
    const entries = this.store.get(sessionId);
    if (!entries || entries.length === 0) return '';

    const recent = entries.slice(-15);
    const tasks = recent.filter(e => e.type === 'task').slice(-5);
    const decisions = recent.filter(e => e.type === 'decision').slice(-5);
    const questions = recent.filter(e => e.type === 'question').slice(-3);
    const delegations = recent.filter(e => e.type === 'delegation').slice(-3);

    const lines: string[] = [];
    if (tasks.length > 0) lines.push('Active tasks: ' + tasks.map(t => `- ${t.detail}`).join('\n'));
    if (decisions.length > 0) lines.push('Recent decisions: ' + decisions.map(d => `- ${d.detail}`).join('\n'));
    if (questions.length > 0) lines.push('Open questions: ' + questions.map(q => `- ${q.detail}`).join('\n'));
    if (delegations.length > 0) lines.push('Recent delegations: ' + delegations.map(d => `- ${d.detail}`).join('\n'));

    return lines.length > 0
      ? `[SESSION_CONTEXT]\nThe conversation has covered the following key points. Use this for awareness when responding:\n\n${lines.join('\n\n')}\n[/SESSION_CONTEXT]`
      : '';
  }

  getTextForExpertiseCheck(sessionId: string): string {
    const entries = this.store.get(sessionId);
    if (!entries || entries.length === 0) return '';
    return entries.slice(-8).map(e => e.detail).join(' ');
  }

  clear(sessionId: string): void {
    this.store.delete(sessionId);
    this.saveToDisk();
  }

  getAll(sessionId: string): ContextEntry[] {
    return [...(this.store.get(sessionId) ?? [])];
  }

  private saveToDisk(): void {
    if (!this.sessionDir) return;
    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const filePath = join(this.sessionDir, 'context.json');
      const allEntries: Record<string, ContextEntry[]> = {};
      for (const [sid, entries] of this.store.entries()) {
        allEntries[sid] = entries;
      }
      writeFileSync(filePath, JSON.stringify(allEntries, null, 2));
    } catch { /* best effort */ }
  }

  private loadFromDisk(): void {
    if (!this.sessionDir) return;
    try {
      const filePath = join(this.sessionDir, 'context.json');
      if (existsSync(filePath)) {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (typeof raw === 'object') {
          for (const [sid, entries] of Object.entries(raw)) {
            if (Array.isArray(entries)) {
              this.store.set(sid, entries as ContextEntry[]);
            }
          }
        }
      }
    } catch { /* best effort */ }
  }

  private firstSentence(text: string, maxLen: number): string {
    const trimmed = text.replace(/^[#*`\s-]+/, '').trim();
    const periodIdx = Math.min(
      ...[trimmed.indexOf('.'), trimmed.indexOf('!'), trimmed.indexOf('\n')].filter(i => i > 0)
    );
    const sentence = (periodIdx > 0 ? trimmed.slice(0, periodIdx + 1) : trimmed.split(' ').slice(0, 15).join(' '));
    return sentence.length > maxLen ? sentence.slice(0, maxLen - 3) + '...' : sentence;
  }
}
