import { Router } from 'express';
import { join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { getLogger } from '@agentx/shared';
import { getSessionTodoManager } from '@agentx/engine';
import { getSessionDir, pathExists, atomicWriteFileSync } from './shared.js';

type UiTodoStatus = 'not-started' | 'in-progress' | 'completed';

export interface UiTodoItem {
  id: number;
  title: string;
  status: UiTodoStatus;
}

function normalizeStatus(raw: unknown): UiTodoStatus {
  const s = String(raw ?? 'not-started').toLowerCase().replace(/_/g, '-');
  if (s === 'in-progress' || s === 'inprogress' || s === 'ongoing' || s === 'running') return 'in-progress';
  if (s === 'completed' || s === 'done' || s === 'complete') return 'completed';
  return 'not-started';
}

function normalizeTodos(raw: unknown): UiTodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: UiTodoItem[] = [];
  let nextId = 1;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = String(rec['title'] ?? rec['content'] ?? '').trim();
    if (!title) continue;
    const idNum = rec['id'] !== undefined && Number.isFinite(Number(rec['id'])) ? Number(rec['id']) : nextId++;
    nextId = Math.max(nextId, idNum + 1);
    out.push({ id: idNum, title, status: normalizeStatus(rec['status']) });
  }
  return out;
}

async function readTodosFile(sessionId: string): Promise<UiTodoItem[]> {
  const dir = getSessionDir(sessionId || 'default');
  const todoPath = join(dir, 'todos.json');
  if (!(await pathExists(todoPath))) return [];
  try {
    return normalizeTodos(JSON.parse(await readFile(todoPath, 'utf-8') || '[]'));
  } catch {
    return [];
  }
}

async function writeTodosFile(sessionId: string, items: UiTodoItem[]): Promise<void> {
  const dir = getSessionDir(sessionId || 'default');
  await mkdir(dir, { recursive: true });
  const todoPath = join(dir, 'todos.json');
  await atomicWriteFileSync(todoPath, JSON.stringify(items, null, 2));
}

export function createTodosRouter(): Router {
  const r = Router();

  r.get('/api/todos', async (req, res) => {
    try {
      const sessionId = (req.query['sessionId'] as string) || '';
      const mgr = sessionId ? getSessionTodoManager(sessionId) : undefined;
      if (mgr) {
        res.json({ todos: mgr.getItems() });
        return;
      }
      res.json({ todos: await readTodosFile(sessionId) });
    } catch (e: unknown) {
      getLogger().error('GET_API_TODOS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  r.post('/api/todos', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const sessionId = String(body['sessionId'] ?? '');
      const items = normalizeTodos(body['todos']);
      await writeTodosFile(sessionId, items);
      const mgr = sessionId ? getSessionTodoManager(sessionId) : undefined;
      if (mgr) {
        mgr.loadSnapshot(items, true);
      }
      res.json({ ok: true, todos: items });
    } catch (e: unknown) {
      getLogger().error('POST_API_TODOS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.put('/api/todos/:itemId', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const sessionId = String(body['sessionId'] ?? '');
      const itemId = Number(req.params['itemId']);
      const mgr = sessionId ? getSessionTodoManager(sessionId) : undefined;

      if (mgr && Number.isFinite(itemId)) {
        const ok = mgr.updateItem(itemId, {
          ...(body['title'] !== undefined ? { title: String(body['title']) } : {}),
          ...(body['status'] !== undefined ? { status: normalizeStatus(body['status']) } : {}),
        });
        if (!ok) {
          res.status(404).json({ error: 'not-found' });
          return;
        }
        res.json({ ok: true, todos: mgr.getItems() });
        return;
      }

      const todos = await readTodosFile(sessionId);
      const idx = todos.findIndex((t) => String(t.id) === String(req.params['itemId']));
      if (idx < 0) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      const todo = todos[idx]!;
      if (body['status'] !== undefined) todo.status = normalizeStatus(body['status']);
      if (body['title'] !== undefined) todo.title = String(body['title']);
      await writeTodosFile(sessionId, todos);
      res.json({ ok: true, todos });
    } catch (e: unknown) {
      getLogger().error('PUT_API_TODOS_ITEMID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
    }
  });

  return r;
}
