import type { TodoItem } from '../api';

export type TodoStatus = TodoItem['status'];

function normalizeStatus(raw: unknown): TodoStatus {
  const s = String(raw ?? 'not-started').toLowerCase().replace(/_/g, '-');
  if (s === 'in-progress' || s === 'inprogress' || s === 'ongoing' || s === 'running') return 'in-progress';
  if (s === 'completed' || s === 'done' || s === 'complete') return 'completed';
  return 'not-started';
}

/** Split free-form content into a one-line heading + optional detail (UI normalize fallback). */
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

/** Normalize engine/API todo payloads into stable UI TodoItem rows. */
export function normalizeTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  let nextId = 1;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const explicitDetail = String(rec['detail'] ?? rec['description'] ?? '').trim();
    const rawTitle = String(rec['title'] ?? '').trim();
    const rawContent = String(rec['content'] ?? '').trim();
    let title = rawTitle;
    let detail = explicitDetail || undefined;
    if (!title && rawContent) {
      const split = splitTodoContent(rawContent);
      title = split.title;
      detail = detail || split.detail;
    } else if (title && rawContent && rawContent !== title && !detail) {
      detail = rawContent;
    } else if (title && !detail && title.length > 72) {
      const split = splitTodoContent(title);
      title = split.title;
      detail = split.detail;
    }
    if (!title) continue;
    const idNum = rec['id'] !== undefined && Number.isFinite(Number(rec['id']))
      ? Number(rec['id'])
      : nextId++;
    nextId = Math.max(nextId, idNum + 1);
    out.push({
      id: String(idNum),
      title,
      ...(detail ? { detail } : {}),
      status: normalizeStatus(rec['status']),
    });
  }
  return out;
}

export function todoProgressLabel(items: TodoItem[]): string {
  const done = items.filter((t) => t.status === 'completed').length;
  return `${done}/${items.length}`;
}

export function statusLabel(status: TodoStatus): string {
  if (status === 'in-progress') return 'ongoing';
  if (status === 'completed') return 'done';
  return 'pending';
}
