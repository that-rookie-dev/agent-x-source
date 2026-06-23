import type { ToolResult, ToolExecutionContext, TodoItem } from '@agentx/shared';
import { getSessionTodoManager } from '../TodoAccess.js';

type TodoInput = {
  id?: string | number;
  content?: string;
  title?: string;
  status?: string;
};

function mapStatus(raw: string | undefined): TodoItem['status'] {
  const s = (raw ?? 'pending').toLowerCase().replace(/_/g, '-');
  if (s === 'in-progress' || s === 'inprogress') return 'in-progress';
  if (s === 'completed' || s === 'done' || s === 'complete') return 'completed';
  return 'not-started';
}

function formatTodos(items: TodoItem[]): string {
  if (items.length === 0) return 'No todos';
  return items.map((t) => {
    const mark = t.status === 'completed' ? '[x]' : t.status === 'in-progress' ? '[~]' : '[ ]';
    return `${mark} #${t.id} ${t.title} (${t.status})`;
  }).join('\n');
}

function applyStatus(mgr: ReturnType<typeof getSessionTodoManager>, id: number, status: TodoItem['status']): void {
  if (status === 'in-progress') mgr!.startItem(id);
  else if (status === 'completed') mgr!.completeItem(id);
  else mgr!.updateItem(id, { status: 'not-started' });
}

/** Create or update session todos (Cursor-compatible). */
export async function todoWrite(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const mgr = getSessionTodoManager(context.sessionId);
  if (!mgr) return { success: false, output: 'Todo manager not available for this session', error: 'NOT_AVAILABLE' };

  const todos = args['todos'] as TodoInput[] | undefined;
  if (!Array.isArray(todos) || todos.length === 0) {
    return { success: false, output: 'todos array is required', error: 'INVALID_ARGS' };
  }

  const merge = args['merge'] === true;

  if (!merge) {
    mgr.clear();
    for (const t of todos) {
      const title = (t.content ?? t.title ?? '').trim();
      if (!title) continue;
      const item = mgr.addItem(title);
      applyStatus(mgr, item.id, mapStatus(t.status));
    }
    return { success: true, output: `Updated ${mgr.getItems().length} todo(s)`, metadata: { count: mgr.getItems().length } };
  }

  for (const t of todos) {
    const title = (t.content ?? t.title ?? '').trim();
    const status = mapStatus(t.status);
    const numericId = t.id !== undefined ? Number(t.id) : NaN;

    if (Number.isFinite(numericId) && mgr.getItems().some((i) => i.id === numericId)) {
      if (title) mgr.updateItem(numericId, { title });
      applyStatus(mgr, numericId, status);
    } else if (title) {
      const item = mgr.addItem(title);
      applyStatus(mgr, item.id, status);
    }
  }

  return { success: true, output: formatTodos(mgr.getItems()), metadata: { count: mgr.getItems().length } };
}

/** List session todos. */
export async function todoRead(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const mgr = getSessionTodoManager(context.sessionId);
  if (!mgr) return { success: false, output: 'Todo manager not available for this session', error: 'NOT_AVAILABLE' };
  const items = mgr.getItems();
  const progress = mgr.getProgress();
  return {
    success: true,
    output: formatTodos(items),
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
