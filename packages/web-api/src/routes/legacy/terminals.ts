/**
 * Terminals route group — REST + WebSocket for live terminal sessions.
 *
 * REST:
 *   POST   /api/sessions/:id/terminals          — start a terminal
 *   GET    /api/sessions/:id/terminals          — list terminals
 *   GET    /api/sessions/:id/terminals/:tid     — get terminal info/output
 *   POST   /api/sessions/:id/terminals/:tid/input — send input
 *   DELETE /api/sessions/:id/terminals/:tid     — kill terminal
 *
 * WebSocket:
 *   /api/sessions/:id/terminals/:tid/stream     — live output stream
 */
import { Router } from 'express';
import { resolve } from 'node:path';
import { TerminalManager } from '@agentx/engine';
import { getActiveWorkspacePath } from '../../workspace.js';

export function createTerminalsRouter(): Router {
  const r = Router();
  const manager = TerminalManager.getInstance();

  /** Start a new terminal. */
  r.post('/api/sessions/:id/terminals', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const { command, cwd, label, env } = req.body as {
        command: string;
        cwd?: string;
        label?: string;
        env?: Record<string, string>;
      };

      if (!command) {
        return res.status(400).json({ error: 'command is required' });
      }

      const scopePath = getActiveWorkspacePath() ?? process.cwd();
      const resolvedCwd = cwd ? resolve(scopePath, cwd) : scopePath;

      const session = manager.start({
        command,
        cwd: resolvedCwd,
        sessionId,
        env,
        label,
      });

      // Wait a brief moment for initial output
      await new Promise((r2) => setTimeout(r2, 300));

      res.json(session.toInfo());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /** List terminals for a session. */
  r.get('/api/sessions/:id/terminals', (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const terminals = manager.listBySession(sessionId);
      res.json({ terminals });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /** Get terminal info and output. */
  r.get('/api/sessions/:id/terminals/:tid', (req, res) => {
    try {
      const tid = req.params['tid']!;
      const session = manager.get(tid);
      if (!session) return res.status(404).json({ error: 'Terminal not found' });

      const mode = (req.query['mode'] as string) ?? 'info';
      const info = session.toInfo();

      if (mode === 'tail') {
        const maxLines = parseInt(req.query['maxLines'] as string) || 80;
        return res.json({ ...info, output: session.getTail(maxLines) });
      }

      if (mode === 'full') {
        const maxChars = parseInt(req.query['maxChars'] as string) || 100_000;
        return res.json({ ...info, output: session.getFullOutput(maxChars) });
      }

      res.json(info);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /** Send input to a terminal. */
  r.post('/api/sessions/:id/terminals/:tid/input', (req, res) => {
    try {
      const tid = req.params['tid']!;
      const { text } = req.body as { text: string };
      if (text === undefined) return res.status(400).json({ error: 'text is required' });

      const session = manager.get(tid);
      if (!session) return res.status(404).json({ error: 'Terminal not found' });
      if (!session.isAlive()) return res.status(409).json({ error: 'Terminal is not alive' });

      session.sendInput(text);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /** Kill a terminal. */
  r.delete('/api/sessions/:id/terminals/:tid', (req, res) => {
    try {
      const tid = req.params['tid']!;
      const ok = manager.kill(tid);
      if (!ok) return res.status(404).json({ error: 'Terminal not found' });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /** Resize a terminal. */
  r.post('/api/sessions/:id/terminals/:tid/resize', (req, res) => {
    try {
      const tid = req.params['tid']!;
      const { cols, rows } = req.body as { cols: number; rows: number };
      const session = manager.get(tid);
      if (!session) return res.status(404).json({ error: 'Terminal not found' });
      session.resize(cols ?? 120, rows ?? 30);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return r;
}
