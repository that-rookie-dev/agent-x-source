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
  private db: any;
  private sessionId: string;
  private maxEntries = 50;
  private _scopePath: string | null = null;

  private entriesCache: ContextEntry[] | null = null;
  private historyCache: HistoryEntry[] | null = null;
  private maxHistoryMessages = 50;
  private maxHistoryChars = 48000;

  constructor(db: any, sessionId: string) {
    this.db = db;
    this.sessionId = sessionId;
    this.ensureTables();
    this._scopePath = this.loadScopePath();
  }

  private ensureTables(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS context_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          entry_type TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS session_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS session_scope (
          session_id TEXT PRIMARY KEY,
          scope_path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_entries_session ON context_entries(session_id);
        CREATE INDEX IF NOT EXISTS idx_session_history_session ON session_history(session_id);
      `);
    } catch { /* non-critical */ }
  }

  setScopePath(scopePath: string): void {
    this._scopePath = scopePath;
    if (this.db) {
      try {
        this.db.prepare(
          'INSERT OR REPLACE INTO session_scope (session_id, scope_path) VALUES (?, ?)'
        ).run(this.sessionId, scopePath);
      } catch { /* best effort */ }
    }
  }

  getScopePath(): string | null {
    return this._scopePath;
  }

  private loadScopePath(): string | null {
    if (this.db) {
      try {
        const row = this.db.prepare(
          'SELECT scope_path FROM session_scope WHERE session_id = ?'
        ).get(this.sessionId) as { scope_path: string } | undefined;
        if (row) return row.scope_path;
      } catch { /* best effort */ }
    }
    return null;
  }

  record(role: 'user' | 'assistant' | 'crew', content: string, crewName?: string): void {
    const now = Date.now();

    const displayName = role === 'crew' ? (crewName ?? 'Agent') : role === 'user' ? 'User' : 'Agent-X';
    const label = role === 'user' ? 'User' : displayName;
    this.recordHistory(label, content.slice(0, 2000), now);

    if (role === 'user') {
      let recorded = false;
      if (QUESTION_PATTERNS.test(content.trim())) {
        this.persistEntry('question', content.trim().slice(0, 200), now);
        recorded = true;
      }
      if (TASK_PATTERNS.test(content)) {
        this.persistEntry('task', this.firstSentence(content, 200), now);
        recorded = true;
      }
      const mentionMatch = content.match(/@(\w+)/);
      if (mentionMatch) {
        this.persistEntry('delegation', `User requested @${mentionMatch[1]} to handle: ${this.firstSentence(content, 150)}`, now);
        recorded = true;
      }
      if (!recorded) {
        this.persistEntry('fact', `User: ${this.firstSentence(content, 200)}`, now);
      }
    }

    if (role === 'assistant' || role === 'crew') {
      const dn = crewName ?? 'Agent-X';
      if (DECISION_PATTERNS.test(content)) {
        this.persistEntry('decision', `${dn}: ${this.firstSentence(content, 200)}`, now);
      } else {
        this.persistEntry('fact', `${dn}: ${this.firstSentence(content, 200)}`, now);
      }
    }

    this.enforceEntryLimits();
    this.entriesCache = null;
  }

  recordHistory(role: string, content: string, ts?: number): void {
    if (this.db) {
      try {
        this.db.prepare(
          'INSERT INTO session_history (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
        ).run(this.sessionId, role, content, new Date(ts ?? Date.now()).toISOString());
      } catch { /* best effort */ }
      this.enforceHistoryLimits();
    } else {
      const history = this.historyCache ?? [];
      history.push({ role, content: content.slice(0, 2000), ts: ts ?? Date.now() });
      this.trimHistory(history);
      this.historyCache = history;
    }
    this.historyCache = null;
  }

  getContextSummary(): string {
    const entries = this.loadEntries();
    if (entries.length === 0) return '';

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

  getRecentHistory(): string {
    const history = this.loadHistory();
    if (history.length === 0) return '';

    const lines = history.map(e => `${e.role}: ${e.content}`);

    return `[RECENT_HISTORY]\nHere are the recent messages in this conversation (up to ${this.maxHistoryMessages} messages / ~12K tokens). Use this for continuity:\n\n${lines.join('\n')}\n\nIMPORTANT: The LAST message above is the CURRENT task you must execute. Earlier messages are past context only — do NOT treat them as active tasks. Respond ONLY to the latest user request. Do NOT resume or continue any prior task unless the latest message explicitly asks you to.\n[/RECENT_HISTORY]`;
  }

  getStructuredContext(): string {
    const entries = this.loadEntries();
    const history = this.loadHistory();
    if (entries.length === 0 && history.length === 0) return '';

    const clean = (s: string) => s.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const recent = entries.slice(-50);
    const sections: string[] = [];

    const taskCount = recent.filter(e => e.type === 'task').length;
    const decisionCount = recent.filter(e => e.type === 'decision').length;
    sections.push(`## Summary\n${taskCount} tasks discussed, ${decisionCount} actions taken across ${recent.length} context entries.`);

    const tasks = recent.filter(e => e.type === 'task').slice(-6);
    if (tasks.length > 0) {
      sections.push('## Active Tasks\n' + tasks.map(t => `- ${clean(t.detail)}`).join('\n'));
    }

    const decisions = recent.filter(e => e.type === 'decision').slice(-8);
    if (decisions.length > 0) {
      sections.push('## Actions Taken\n' + decisions.map(d => `- ${clean(d.detail)}`).join('\n'));
    }

    const facts = recent.filter(e => e.type === 'fact').slice(-5);
    if (facts.length > 0) {
      sections.push('## Key Points\n' + facts.map(f => `- ${clean(f.detail)}`).join('\n'));
    }

    const questions = recent.filter(e => e.type === 'question').slice(-4);
    if (questions.length > 0) {
      sections.push('## Open Questions\n' + questions.map(q => `- ${clean(q.detail)}`).join('\n'));
    }

    const recentHistory = history.slice(-4);
    if (recentHistory.length > 0) {
      const lines = recentHistory.map(h => {
        const short = h.content.length > 120 ? clean(h.content.slice(0, 120)) + '…' : clean(h.content);
        return `- **${h.role}**: ${short}`;
      });
      sections.push('## Latest Exchange\n' + lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  getTextForExpertiseCheck(): string {
    const entries = this.loadEntries();
    if (entries.length === 0) return '';
    return entries.slice(-8).map(e => e.detail).join(' ');
  }

  clear(): void {
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM context_entries WHERE session_id = ?').run(this.sessionId);
        this.db.prepare('DELETE FROM session_history WHERE session_id = ?').run(this.sessionId);
      } catch { /* best effort */ }
    }
    this.entriesCache = null;
    this.historyCache = null;
  }

  rebuildFromMessages(messages: Array<{ role: string; content: string }>): number {
    this.clear();
    const userAssistant = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const recent = userAssistant.slice(-50);
    let count = 0;
    for (const msg of recent) {
      if (msg.content) {
        this.record(msg.role as 'user' | 'assistant', msg.content);
        count++;
      }
    }
    return count;
  }

  getAll(): ContextEntry[] {
    return this.loadEntries();
  }

  private persistEntry(type: string, detail: string, ts?: number): void {
    if (this.db) {
      try {
        this.db.prepare(
          'INSERT INTO context_entries (session_id, entry_type, detail, created_at) VALUES (?, ?, ?, ?)'
        ).run(this.sessionId, type, detail, new Date(ts ?? Date.now()).toISOString());
      } catch { /* best effort */ }
    } else {
      const entries = this.entriesCache ?? [];
      entries.push({ type: type as ContextEntry['type'], detail, ts: ts ?? Date.now() });
      this.entriesCache = entries;
    }
  }

  private enforceEntryLimits(): void {
    if (!this.db) return;
    try {
      const row = this.db.prepare(
        'SELECT COUNT(*) as c FROM context_entries WHERE session_id = ?'
      ).get(this.sessionId) as { c: number };
      if (row.c > this.maxEntries) {
        const excess = row.c - this.maxEntries;
        this.db.prepare(
          `DELETE FROM context_entries WHERE id IN (
            SELECT id FROM context_entries WHERE session_id = ? ORDER BY created_at ASC LIMIT ?
          )`
        ).run(this.sessionId, excess);
      }
    } catch { /* best effort */ }
  }

  private enforceHistoryLimits(): void {
    if (!this.db) return;
    try {
      const countRow = this.db.prepare(
        'SELECT COUNT(*) as c FROM session_history WHERE session_id = ?'
      ).get(this.sessionId) as { c: number };
      if (countRow.c > this.maxHistoryMessages) {
        const excess = countRow.c - this.maxHistoryMessages;
        this.db.prepare(
          `DELETE FROM session_history WHERE id IN (
            SELECT id FROM session_history WHERE session_id = ? ORDER BY created_at ASC LIMIT ?
          )`
        ).run(this.sessionId, excess);
      }
    } catch { /* best effort */ }
  }

  private loadEntries(): ContextEntry[] {
    if (this.entriesCache) return this.entriesCache;
    if (this.db) {
      try {
        const rows = this.db.prepare(
          'SELECT entry_type, detail, created_at FROM context_entries WHERE session_id = ? ORDER BY created_at ASC'
        ).all(this.sessionId) as Array<{ entry_type: string; detail: string; created_at: string }>;
        const entries: ContextEntry[] = rows.map(r => ({
          type: r.entry_type as ContextEntry['type'],
          detail: r.detail,
          ts: new Date(r.created_at).getTime(),
        }));
        this.entriesCache = entries;
        return entries;
      } catch { /* fall through to empty */ }
    }
    return [];
  }

  private loadHistory(): HistoryEntry[] {
    if (this.historyCache) return this.historyCache;
    if (this.db) {
      try {
        const rows = this.db.prepare(
          'SELECT role, content, created_at FROM session_history WHERE session_id = ? ORDER BY created_at ASC'
        ).all(this.sessionId) as Array<{ role: string; content: string; created_at: string }>;
        const entries: HistoryEntry[] = rows.map(r => ({
          role: r.role,
          content: r.content,
          ts: new Date(r.created_at).getTime(),
        }));
        this.historyCache = entries;
        return entries;
      } catch { /* fall through to empty */ }
    }
    return [];
  }

  private trimHistory(history: HistoryEntry[]): void {
    while (history.length > this.maxHistoryMessages) history.shift();
    let totalChars = history.reduce((sum, e) => sum + e.role.length + e.content.length + 2, 0);
    while (totalChars > this.maxHistoryChars && history.length > 1) {
      const removed = history.shift();
      if (removed) totalChars -= removed.role.length + removed.content.length + 2;
    }
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
