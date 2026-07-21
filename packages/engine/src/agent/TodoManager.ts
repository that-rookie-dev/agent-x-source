import type { TodoItem, EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';

export type TodoStatus = TodoItem['status'];

function normalizeStatus(raw: string | undefined): TodoStatus {
  const s = (raw ?? 'not-started').toLowerCase().replace(/_/g, '-');
  if (s === 'in-progress' || s === 'inprogress' || s === 'ongoing' || s === 'running') return 'in-progress';
  if (s === 'completed' || s === 'done' || s === 'complete') return 'completed';
  return 'not-started';
}

export class TodoManager {
  private items: TodoItem[] = [];
  private eventBus: AgentEventBus;
  private nextId = 1;
  private persistFn: ((items: TodoItem[]) => void) | null = null;
  /** Bumps on every mutation so mid-turn prepareStep can inject fresh checklist text. */
  private revision = 0;
  private sessionId: string | undefined;

  constructor(eventBus: AgentEventBus, sessionId?: string) {
    this.eventBus = eventBus;
    this.sessionId = sessionId;
  }

  setSessionId(sessionId: string | undefined): void {
    this.sessionId = sessionId;
  }

  getRevision(): number {
    return this.revision;
  }

  /** Optional disk/API persistence hook (session todos.json). */
  setPersistHandler(fn: ((items: TodoItem[]) => void) | null): void {
    this.persistFn = fn;
  }

  addItem(title: string, status: TodoStatus = 'not-started', detail?: string): TodoItem {
    const item: TodoItem = {
      id: this.nextId++,
      title,
      ...(detail ? { detail } : {}),
      status: normalizeStatus(status),
    };
    this.items.push(item);
    this.emitUpdate();
    return item;
  }

  addItems(titles: string[]): TodoItem[] {
    return titles.map((title) => this.addItem(title));
  }

  /**
   * Replace the entire checklist in one emit (todo_write merge:false).
   * Multiple items may be in_progress when workstreams run in parallel.
   */
  replaceAll(todos: Array<{ title: string; detail?: string; status?: string }>): TodoItem[] {
    this.items = [];
    this.nextId = 1;
    for (const t of todos) {
      const title = (t.title ?? '').trim();
      if (!title) continue;
      const detail = (t.detail ?? '').trim() || undefined;
      const item: TodoItem = {
        id: this.nextId++,
        title,
        ...(detail ? { detail } : {}),
        status: normalizeStatus(t.status),
      };
      this.items.push(item);
    }
    // Promote a pending item when nothing is active — never reopen completed work.
    if (this.items.length > 0 && !this.items.some((i) => i.status === 'in-progress')) {
      const firstPending = this.items.find((i) => i.status === 'not-started');
      if (firstPending) firstPending.status = 'in-progress';
    }
    this.emitUpdate();
    return this.getItems();
  }

  /**
   * Restore from disk without emitting (agent boot). Caller may emit afterwards.
   */
  loadSnapshot(items: Array<{ id?: number | string; title?: string; content?: string; detail?: string; description?: string; status?: string }>, emit = false): void {
    this.items = [];
    this.nextId = 1;
    let maxId = 0;
    for (const raw of items) {
      const title = String(raw.title ?? raw.content ?? '').trim();
      if (!title) continue;
      const detail = String(raw.detail ?? raw.description ?? '').trim() || undefined;
      const idNum = raw.id !== undefined && Number.isFinite(Number(raw.id)) ? Number(raw.id) : this.nextId++;
      maxId = Math.max(maxId, idNum);
      this.items.push({
        id: idNum,
        title,
        ...(detail ? { detail } : {}),
        status: normalizeStatus(raw.status),
      });
    }
    this.nextId = Math.max(this.nextId, maxId + 1);
    if (emit) this.emitUpdate();
    else this.revision += 1; // treat hydrate as a new revision for prepareStep
  }

  startItem(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.status = 'in-progress';
    this.emitUpdate();
  }

  completeItem(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.status = 'completed';
    this.emitUpdate();
  }

  updateItem(id: number, updates: { title?: string; detail?: string; status?: TodoStatus | string }): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    if (updates.title !== undefined) item.title = updates.title;
    if (updates.detail !== undefined) {
      const d = updates.detail.trim();
      if (d) item.detail = d;
      else delete item.detail;
    }
    if (updates.status !== undefined) {
      item.status = normalizeStatus(updates.status);
    }
    this.emitUpdate();
    return true;
  }

  /** Find by id or exact title (case-insensitive). */
  findItem(idOrTitle: { id?: number; title?: string }): TodoItem | undefined {
    if (idOrTitle.id !== undefined && Number.isFinite(idOrTitle.id)) {
      const byId = this.items.find((i) => i.id === idOrTitle.id);
      if (byId) return byId;
    }
    const title = (idOrTitle.title ?? '').trim().toLowerCase();
    if (!title) return undefined;
    return this.items.find((i) => i.title.trim().toLowerCase() === title);
  }

  deleteItem(id: number): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.emitUpdate();
    return true;
  }

  getItems(): TodoItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  getProgress(): { completed: number; total: number; current: string | null; inProgress: string[] } {
    const completed = this.items.filter((i) => i.status === 'completed').length;
    const inProgress = this.items.filter((i) => i.status === 'in-progress');
    return {
      completed,
      total: this.items.length,
      current: inProgress[0]?.title ?? null,
      inProgress: inProgress.map((i) => i.title),
    };
  }

  hasIncomplete(): boolean {
    return this.items.some((i) => i.status === 'not-started' || i.status === 'in-progress');
  }

  getIncomplete(): TodoItem[] {
    return this.getItems().filter((i) => i.status === 'not-started' || i.status === 'in-progress');
  }

  /**
   * Ensure work is actively tracked: if anything is pending and nothing is
   * in_progress, promote the next wave (up to `parallel` items) so continuations
   * and sub-agent slots keep moving.
   */
  ensureActiveWork(parallel = 3): TodoItem[] {
    const pending = this.items.filter((i) => i.status === 'not-started');
    const active = this.items.filter((i) => i.status === 'in-progress');
    if (pending.length === 0) return this.getItems();
    if (active.length > 0) return this.getItems();
    const n = Math.max(1, Math.min(parallel, pending.length));
    for (let i = 0; i < n; i++) {
      pending[i]!.status = 'in-progress';
    }
    this.emitUpdate();
    return this.getItems();
  }

  /** Compact checklist text for mid-turn prepareStep injection. */
  formatActiveBlock(opts?: { deferred?: boolean }): string {
    const items = this.getItems();
    if (items.length === 0) {
      return '[ACTIVE_TODOS]\n(no checklist yet — call todo_write)\n[/ACTIVE_TODOS]';
    }
    const lines = items.map((t) => {
      const mark = t.status === 'completed' ? '[x]' : t.status === 'in-progress' ? '[~]' : '[ ]';
      return `${mark} #${t.id} ${t.title}`;
    });
    if (opts?.deferred) {
      return [
        '[ACTIVE_TODOS — PARKED FOR LATER]',
        'Do NOT resume these items this turn — answer the user\'s new message only.',
        '',
        ...lines,
        '[/ACTIVE_TODOS]',
      ].join('\n');
    }
    const active = items.filter((t) => t.status === 'in-progress');
    const pending = items.filter((t) => t.status === 'not-started');
    let focus: string;
    if (active.length > 0) {
      focus = `Focus now: ${active.map((t) => `#${t.id} ${t.title}`).join(' · ')}`;
    } else if (pending.length > 0) {
      focus = `No item in_progress — mark #${pending[0]!.id} (or parallel items) in_progress before continuing.`;
    } else {
      focus = 'All items completed.';
    }
    return [
      '[ACTIVE_TODOS — live checklist update]',
      focus,
      'When you finish an item: immediately todo_write(merge:true) with that id status=completed and set the next pending item(s) to in_progress.',
      'Parallel workstreams may have multiple in_progress items at once.',
      '',
      ...lines,
      '[/ACTIVE_TODOS]',
    ].join('\n');
  }

  clear(): void {
    this.items = [];
    this.nextId = 1;
    this.emitUpdate();
  }

  private emitUpdate(): void {
    // Batch complete: clear the whole checklist once every item is done
    // (same lifecycle as ephemeral sub-agent cards — not one-by-one).
    if (this.items.length > 0 && this.items.every((i) => i.status === 'completed')) {
      this.items = [];
      this.nextId = 1;
    }
    this.revision += 1;
    const items = this.getItems();
    this.eventBus.emit({
      type: 'todo_update',
      items,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    } as EngineEvent);
    try {
      this.persistFn?.(items);
    } catch {
      /* best-effort */
    }
  }
}
