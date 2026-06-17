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

interface HistoryEntry {
  role: string;
  content: string;
  ts: number;
}

export class ContextTracker {
  private store = new Map<string, ContextEntry[]>();
  private maxEntries = 50;
  private sessionDir: string | null = null;
  private _scopePath: string | null = null;

  private recentHistory = new Map<string, HistoryEntry[]>();
  private maxHistoryMessages = 50;
  private maxHistoryChars = 48000;

  setSessionDir(dir: string, scopePath?: string): void {
    this.sessionDir = dir;
    if (scopePath) this._scopePath = scopePath;
    this.loadFromDisk();
    this.loadHistoryFromDisk();
    if (scopePath) {
      this._scopePath = scopePath;
      this.saveToDisk();
    }
  }

  setScopePath(scopePath: string): void {
    this._scopePath = scopePath;
    this.saveToDisk();
  }

  getScopePath(): string | null {
    return this._scopePath;
  }

  record(sessionId: string, role: 'user' | 'assistant' | 'crew', content: string, crewName?: string): void {
    const entries = this.store.get(sessionId) ?? [];
    const now = Date.now();

    // Push raw message into recent history
    const history = this.recentHistory.get(sessionId) ?? [];
    const displayName = role === 'crew' ? (crewName ?? 'Agent') : role === 'user' ? 'User' : 'Agent-X';
    const label = role === 'user' ? 'User' : displayName;
    history.push({ role: label, content: content.slice(0, 2000), ts: now });
    this.trimHistory(history);
    this.recentHistory.set(sessionId, history);

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
      if (!recorded) {
        entries.push({ type: 'fact', detail: `User: ${this.firstSentence(content, 200)}`, ts: now });
      }
    }

    if (role === 'assistant' || role === 'crew') {
      const dn = crewName ?? 'Agent-X';
      if (DECISION_PATTERNS.test(content)) {
        entries.push({ type: 'decision', detail: `${dn}: ${this.firstSentence(content, 200)}`, ts: now });
      } else {
        entries.push({ type: 'fact', detail: `${dn}: ${this.firstSentence(content, 200)}`, ts: now });
      }
    }

    while (entries.length > this.maxEntries) entries.shift();
    this.store.set(sessionId, entries);
    this.saveToDisk();
    this.saveHistoryToDisk();
    this.writeContextFile();
  }

  getContextSummary(sessionId: string): string {
    const entries = this.store.get(sessionId);
    if (!entries || entries.length === 0) return '';

    const recent = entries.slice(-40);
    const tasks = recent.filter(e => e.type === 'task').slice(-8);
    const decisions = recent.filter(e => e.type === 'decision').slice(-8);
    const questions = recent.filter(e => e.type === 'question').slice(-5);
    const delegations = recent.filter(e => e.type === 'delegation').slice(-5);

    const lines: string[] = [];
    if (tasks.length > 0) lines.push('Active tasks: ' + tasks.map(t => `- ${t.detail}`).join('\n'));
    if (decisions.length > 0) lines.push('Recent decisions: ' + decisions.map(d => `- ${d.detail}`).join('\n'));
    if (questions.length > 0) lines.push('Open questions: ' + questions.map(q => `- ${q.detail}`).join('\n'));
    if (delegations.length > 0) lines.push('Recent delegations: ' + delegations.map(d => `- ${d.detail}`).join('\n'));

    return lines.length > 0
      ? `[SESSION_CONTEXT]\nThe conversation has covered the following key points in PRIOR messages. Use this only for BACKGROUND understanding — the CURRENT task is the LAST message in the conversation:\n\n${lines.join('\n\n')}\n[/SESSION_CONTEXT]`
      : '';
  }

  getRecentHistory(sessionId: string): string {
    const history = this.recentHistory.get(sessionId);
    if (!history || history.length === 0) return '';

    const lines = history.map(e => `${e.role}: ${e.content}`);

    return `[RECENT_HISTORY]\nHere are the recent messages in this conversation (up to ${this.maxHistoryMessages} messages / ~12K tokens). Use this for continuity:\n\n${lines.join('\n')}\n\nIMPORTANT: The LAST message above is the CURRENT task you must execute. Earlier messages are past context only — do NOT treat them as active tasks. Respond ONLY to the latest user request. Do NOT resume or continue any prior task unless the latest message explicitly asks you to.\n[/RECENT_HISTORY]`;
  }

  /**
   * Build a professional structured context summary for context.txt.
   */
  getStructuredContext(sessionId: string): string {
    const entries = this.store.get(sessionId);
    const history = this.recentHistory.get(sessionId);
    if ((!entries || entries.length === 0) && (!history || history.length === 0)) return '';

    const clean = (s: string) => s.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const recent = (entries || []).slice(-50);
    const sections: string[] = [];

    // ─── Summary ───
    const taskCount = recent.filter(e => e.type === 'task').length;
    const decisionCount = recent.filter(e => e.type === 'decision').length;
    sections.push(`## Summary\n${taskCount} tasks discussed, ${decisionCount} actions taken across ${recent.length} context entries.`);

    // ─── Active Tasks ───
    const tasks = recent.filter(e => e.type === 'task').slice(-6);
    if (tasks.length > 0) {
      sections.push('## Active Tasks\n' + tasks.map(t => `- ${clean(t.detail)}`).join('\n'));
    }

    // ─── What Happened ───
    const decisions = recent.filter(e => e.type === 'decision').slice(-8);
    if (decisions.length > 0) {
      sections.push('## Actions Taken\n' + decisions.map(d => `- ${clean(d.detail)}`).join('\n'));
    }

    // ─── Key Points ───
    const facts = recent.filter(e => e.type === 'fact').slice(-5);
    if (facts.length > 0) {
      sections.push('## Key Points\n' + facts.map(f => `- ${clean(f.detail)}`).join('\n'));
    }

    // ─── Open Questions ───
    const questions = recent.filter(e => e.type === 'question').slice(-4);
    if (questions.length > 0) {
      sections.push('## Open Questions\n' + questions.map(q => `- ${clean(q.detail)}`).join('\n'));
    }

    // ─── Latest Exchange ───
    const recentHistory = (history || []).slice(-4);
    if (recentHistory.length > 0) {
      const lines = recentHistory.map(h => {
        const short = h.content.length > 120 ? clean(h.content.slice(0, 120)) + '…' : clean(h.content);
        return `- **${h.role}**: ${short}`;
      });
      sections.push('## Latest Exchange\n' + lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  getTextForExpertiseCheck(sessionId: string): string {
    const entries = this.store.get(sessionId);
    if (!entries || entries.length === 0) return '';
    return entries.slice(-8).map(e => e.detail).join(' ');
  }

  clear(sessionId: string): void {
    this.store.delete(sessionId);
    this.recentHistory.delete(sessionId);
    this.saveToDisk();
    this.saveHistoryToDisk();
  }

  /**
   * Rebuild context entries and recent history from conversation.json.
   * Call this when the user wants to refresh/rebuild the context summary.
   */
  rebuildFromConversation(sessionId: string): number {
    if (!this.sessionDir) return 0;
    this.clear(sessionId);
    try {
      const convPath = join(this.sessionDir, 'conversation.json');
      if (!existsSync(convPath)) return 0;
      const raw = JSON.parse(readFileSync(convPath, 'utf-8')) as Array<Record<string, unknown>>;
      const userAssistant = raw.filter((m: any) => m.role === 'user' || m.role === 'assistant');
      const recent = userAssistant.slice(-50);
      let count = 0;
      for (const msg of recent) {
        const role = msg['role'] as string;
        const content = (msg['content'] as string) || '';
        if (content) {
          this.record(sessionId, role as 'user' | 'assistant', content);
          count++;
        }
      }
      return count;
    } catch { return 0; }
  }

  getAll(sessionId: string): ContextEntry[] {
    return [...(this.store.get(sessionId) ?? [])];
  }

  private trimHistory(history: HistoryEntry[]): void {
    while (history.length > this.maxHistoryMessages) history.shift();
    let totalChars = history.reduce((sum, e) => sum + e.role.length + e.content.length + 2, 0);
    while (totalChars > this.maxHistoryChars && history.length > 1) {
      const removed = history.shift();
      if (removed) totalChars -= removed.role.length + removed.content.length + 2;
    }
  }

  private saveToDisk(): void {
    if (!this.sessionDir) return;
    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const filePath = join(this.sessionDir, 'context.json');
      const data: Record<string, unknown> = {};
      if (this._scopePath) {
        data['__scopePath__'] = this._scopePath;
      }
      for (const [sid, entries] of this.store.entries()) {
        data[sid] = entries;
      }
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch { /* best effort */ }
  }

  private writeContextFile(): void {
    if (!this.sessionDir) return;
    try {
      // Use the first session ID we have entries for (or first history)
      let sid = this.store.keys().next().value;
      if (!sid) sid = this.recentHistory.keys().next().value;
      if (!sid) return;
      const contextPath = join(this.sessionDir, 'context.txt');
      const structured = this.getStructuredContext(sid as string);
      if (structured) {
        writeFileSync(contextPath, structured);
      }
    } catch { /* best effort */ }
  }

  private loadFromDisk(): void {
    if (!this.sessionDir) return;
    try {
      const filePath = join(this.sessionDir, 'context.json');
      if (existsSync(filePath)) {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (typeof raw === 'object') {
          if (typeof raw['__scopePath__'] === 'string') {
            this._scopePath = raw['__scopePath__'] as string;
          }
          for (const [sid, entries] of Object.entries(raw)) {
            if (sid === '__scopePath__') continue;
            if (Array.isArray(entries)) {
              this.store.set(sid, entries as ContextEntry[]);
            }
          }
        }
      }
    } catch { /* best effort */ }
  }

  private saveHistoryToDisk(): void {
    if (!this.sessionDir) return;
    try {
      mkdirSync(this.sessionDir, { recursive: true });
      const filePath = join(this.sessionDir, 'context_summary.json');
      const allEntries: Record<string, HistoryEntry[]> = {};
      for (const [sid, history] of this.recentHistory.entries()) {
        allEntries[sid] = history;
      }
      writeFileSync(filePath, JSON.stringify(allEntries, null, 2));
    } catch { /* best effort */ }
  }

  private loadHistoryFromDisk(): void {
    if (!this.sessionDir) return;
    try {
      const filePath = join(this.sessionDir, 'context_summary.json');
      if (existsSync(filePath)) {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (typeof raw === 'object') {
          for (const [sid, history] of Object.entries(raw)) {
            if (Array.isArray(history)) {
              const typed = history as HistoryEntry[];
              this.trimHistory(typed);
              this.recentHistory.set(sid, typed);
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
