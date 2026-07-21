import type { ToolResult, ToolExecutionContext, TodoItem } from '@agentx/shared';
import { getSessionTodoManager } from '../TodoAccess.js';

type TodoInput = {
  id?: string | number;
  content?: string;
  title?: string;
  detail?: string;
  description?: string;
  status?: string;
};

function mapStatus(raw: string | undefined): TodoItem['status'] {
  const s = (raw ?? 'pending').toLowerCase().replace(/_/g, '-');
  if (s === 'in-progress' || s === 'inprogress' || s === 'ongoing' || s === 'running') return 'in-progress';
  if (s === 'completed' || s === 'done' || s === 'complete') return 'completed';
  return 'not-started';
}

/** Split free-form content into a one-line heading + optional detail body. */
function splitTodoContent(raw: string): { title: string; detail?: string } {
  const text = raw.trim();
  if (!text) return { title: '' };
  const nl = text.indexOf('\n');
  if (nl >= 0) {
    const title = text.slice(0, nl).trim();
    const detail = text.slice(nl + 1).trim();
    return { title: title || text.slice(0, 72), detail: detail || undefined };
  }
  if (text.length > 72) {
    const sentence = text.match(/^(.{20,72}?[.!?])\s+(.+)$/);
    if (sentence?.[1] && sentence[2]) {
      return { title: sentence[1].trim(), detail: sentence[2].trim() };
    }
    const cut = text.lastIndexOf(' ', 60);
    if (cut > 20) {
      return { title: text.slice(0, cut).trim(), detail: text.slice(cut + 1).trim() };
    }
  }
  return { title: text };
}

function normalizeTodoFields(t: TodoInput): { title: string; detail?: string; status: TodoItem['status'] } {
  const explicitDetail = String(t.detail ?? t.description ?? '').trim();
  const raw = String(t.content ?? t.title ?? '').trim();
  if (t.title != null && String(t.title).trim()) {
    const title = String(t.title).trim();
    const fromContent = t.content != null ? String(t.content).trim() : '';
    const detail = explicitDetail
      || (fromContent && fromContent !== title ? fromContent : undefined);
    return { title, detail, status: mapStatus(t.status) };
  }
  const split = splitTodoContent(raw);
  return {
    title: split.title,
    detail: explicitDetail || split.detail,
    status: mapStatus(t.status),
  };
}

function formatTodos(items: TodoItem[]): string {
  if (items.length === 0) return 'No todos';
  return items.map((t) => {
    const mark = t.status === 'completed' ? '[x]' : t.status === 'in-progress' ? '[~]' : '[ ]';
    const detail = t.detail?.trim() ? ` — ${t.detail.trim()}` : '';
    return `${mark} #${t.id} ${t.title}${detail} (${t.status})`;
  }).join('\n');
}

function nextActionHint(items: TodoItem[]): string {
  const inProg = items.filter((i) => i.status === 'in-progress');
  const pending = items.filter((i) => i.status === 'not-started');
  if (inProg.length === 0 && pending.length > 0) {
    return `NEXT: call todo_write(merge:true) and set #${pending[0]!.id} status=in_progress before continuing work.`;
  }
  if (inProg.length > 0) {
    const ids = inProg.map((i) => `#${i.id}`).join(', ');
    return `NEXT: when finished with ${ids}, call todo_write(merge:true) marking them completed and advancing the next pending item(s) to in_progress. Parallel streams may keep multiple items in_progress.`;
  }
  return 'NEXT: all todos completed.';
}

/** Create or update session todos (Cursor-compatible). Updates the right-panel TASKS list live. */
export async function todoWrite(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const mgr = getSessionTodoManager(context.sessionId);
  if (!mgr) return { success: false, output: 'Todo manager not available for this session', error: 'NOT_AVAILABLE' };

  // Models sometimes pass todos as a JSON string.
  let todosRaw = args['todos'];
  if (typeof todosRaw === 'string') {
    try { todosRaw = JSON.parse(todosRaw); } catch { /* keep as-is */ }
  }
  const todos = todosRaw as TodoInput[] | undefined;
  if (!Array.isArray(todos) || todos.length === 0) {
    return { success: false, output: 'todos array is required', error: 'INVALID_ARGS' };
  }

  const merge = args['merge'] === true || args['merge'] === 'true';

  if (!merge) {
    const normalized = todos
      .map((t) => normalizeTodoFields(t))
      .filter((t) => t.title);
    const items = mgr.replaceAll(normalized);
    return {
      success: true,
      output: `Updated ${items.length} todo(s)\n${formatTodos(items)}\n${nextActionHint(items)}`,
      metadata: { count: items.length, items, revision: mgr.getRevision() },
    };
  }

  for (const t of todos) {
    const { title, detail, status } = normalizeTodoFields(t);
    const numericId = t.id !== undefined ? Number(t.id) : NaN;
    const existing = mgr.findItem({
      id: Number.isFinite(numericId) ? numericId : undefined,
      title: title || undefined,
    });

    if (existing) {
      mgr.updateItem(existing.id, {
        ...(title ? { title } : {}),
        ...(detail !== undefined ? { detail } : {}),
        status,
      });
    } else if (title) {
      mgr.addItem(title, status, detail);
    }
  }

  const items = mgr.getItems();
  return {
    success: true,
    output: `${formatTodos(items)}\n${nextActionHint(items)}`,
    metadata: { count: items.length, items, revision: mgr.getRevision() },
  };
}

/** List session todos. */
export async function todoRead(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const mgr = getSessionTodoManager(context.sessionId);
  if (!mgr) return { success: false, output: 'Todo manager not available for this session', error: 'NOT_AVAILABLE' };
  const items = mgr.getItems();
  const progress = mgr.getProgress();
  return {
    success: true,
    output: `${formatTodos(items)}\n${nextActionHint(items)}`,
    metadata: { items, progress },
  };
}

/** Delete one todo or clear all. */
export async function todoDelete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const mgr = getSessionTodoManager(context.sessionId);
  if (!mgr) return { success: false, output: 'Todo manager not available for this session', error: 'NOT_AVAILABLE' };

  if (args['clear'] === true || args['all'] === true) {
    mgr.clear();
    return { success: true, output: 'Cleared all todos' };
  }

  const id = Number(args['id']);
  if (!Number.isFinite(id)) {
    return { success: false, output: 'id (number) or clear:true is required', error: 'INVALID_ARGS' };
  }

  if (!mgr.deleteItem(id)) {
    return { success: false, output: `Todo #${id} not found`, error: 'NOT_FOUND' };
  }
  return { success: true, output: `Deleted todo #${id}` };
}
