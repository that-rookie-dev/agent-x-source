import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { sessionSettings, applySessionModeToAgent, isCrewPrivateSessionRecord } from '../../chat-helpers.js';

let _preHyperdriveMode: 'agent' | 'plan' = 'plan';

export function createModeRouter(): Router {
  const r = Router();

  r.post('/api/mode/hyperdrive', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      const activeSess = eng.sessionManager.getActiveSession?.();
      if (isCrewPrivateSessionRecord(activeSess)) {
        res.status(409).json({
          error: 'crew-private-no-hyperdrive',
          message: 'Hyperdrive is not available in crew private chats.',
        });
        return;
      }
      const enabled = agent.toggleHyperdriveMode();
      if (enabled) {
        _preHyperdriveMode = sessionSettings.mode;
        sessionSettings.mode = 'agent';
      } else {
        sessionSettings.mode = _preHyperdriveMode;
      }
      // Persist hyperdrive state to DB (mode unchanged — hyperdrive is an overlay)
      try {
        const sess = eng.sessionManager.getActiveSession();
        if (sess) {
          eng.sessionManager.updateSession({ hyperdrive: enabled });
        }
      } catch (e) { /* best-effort */ }
      res.json({ ok: true, hyperdriveMode: enabled, mode: sessionSettings.mode });
    } catch (e: unknown) {
      getLogger().error('HYPERDRIVE_TOGGLE', e instanceof Error ? e : String(e));
      res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
    }
  });

  r.get('/api/mode/hyperdrive', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.json({ hyperdriveMode: false, mode: sessionSettings.mode }); return; }
      res.json({ hyperdriveMode: agent.hyperdriveMode, mode: sessionSettings.mode });
    } catch (e) {
      res.json({ hyperdriveMode: false, mode: sessionSettings.mode });
    }
  });

  return r;
}
