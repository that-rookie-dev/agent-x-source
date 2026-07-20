import { Router } from 'express';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { getSessionDir, pathExists, atomicWriteFileSync } from './shared.js';

export function createTodosRouter(): Router {
  const r = Router();

  r.get('/api/todos', async (req, res) => {
    try {
      const sessionId = (req.query['sessionId'] as string) || '';
      const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
      const todoPath = join(dir, 'todos.json');
      const todos = (await pathExists(todoPath)) ? JSON.parse(await readFile(todoPath, 'utf-8') || '[]') : [];
      res.json({ todos });
    } catch (e: unknown) {
      getLogger().error('GET_API_TODOS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  r.post('/api/todos', async (req, res) => {
    try {
      const sessionId = (req.body as Record<string, string>)['sessionId'] || '';
      const todos = (req.body as Record<string, unknown>)['todos'] as Array<{ id: string; title: string; status: string }>;
      const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
      const todoPath = join(dir, 'todos.json');
      await atomicWriteFileSync(todoPath, JSON.stringify(todos || [], null, 2));
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_TODOS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.put('/api/todos/:itemId', async (req, res) => {
    try {
      const sessionId = (req.body as Record<string, string>)['sessionId'] || '';
      const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
      const todoPath = join(dir, 'todos.json');
      const todos: Array<{ id: string; title: string; status: string }> = (await pathExists(todoPath))
        ? JSON.parse(await readFile(todoPath, 'utf-8') || '[]') : [];
      const idx = todos.findIndex((t) => t.id === req.params['itemId']);
      if (idx >= 0) {
        const todo = todos[idx]!;
        todo.status = (req.body as Record<string, string>)['status'] || todo.status;
        todo.title = (req.body as Record<string, string>)['title'] || todo.title;
      }
      await atomicWriteFileSync(todoPath, JSON.stringify(todos, null, 2));
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('PUT_API_TODOS_ITEMID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
    }
  });

  return r;
}
