import type { Request, Response } from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, getDefaultWorkspaceDir, getLogger } from '@agentx/shared';
import { getEngine } from './engine.js';

function resolveScopePath(scopePath?: string): string {
  if (scopePath && scopePath.trim()) return scopePath.trim();
  return getDefaultWorkspaceDir();
}

/** POST /api/agent-x-core/session — create or return the lifelong Agent-X core session. */
export async function postAgentXCoreSession(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { scopePath?: string } | undefined;
    const eng = getEngine();
    const cfg = eng.configManager.load();
    if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
      res.status(400).json({ error: 'no-provider' });
      return;
    }

    const mgr = eng.sessionManager as unknown as {
      findAgentXCoreSession?: () => { id: string } | null;
      ensureAgentXCoreSession?: (
        providerId: string,
        modelId: string,
        scopePath: string,
      ) => { id: string; title?: string; contextKind?: string };
    };

    const existing = mgr.findAgentXCoreSession?.() ?? null;
    const scopePath = resolveScopePath(body?.scopePath);
    const session = mgr.ensureAgentXCoreSession?.(
      cfg.provider.activeProvider,
      cfg.provider.activeModel,
      scopePath,
    );
    if (!session) {
      res.status(500).json({ error: 'core-session-unavailable' });
      return;
    }

    const created = !existing;
    if (created) {
      try {
        mkdirSync(join(getDataDir(), 'sessions', session.id), { recursive: true });
      } catch {
        // best-effort
      }
    }

    res.json({
      sessionId: session.id,
      created,
      session,
    });
  } catch (e: unknown) {
    getLogger().error('POST_AGENT_X_CORE_SESSION', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'core-session-failed' });
  }
}
