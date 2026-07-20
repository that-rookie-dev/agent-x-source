import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { validate, permissionRespondSchema, permissionInstructSchema, permissionRespondBatchSchema } from '../../validation.js';

export function createPermissionRouter(): Router {
  const r = Router();

  r.post('/api/permission/respond', validate(permissionRespondSchema), (req, res) => {
    try {
      const { requestId, choice } = req.body as { requestId: string; choice: 'allow_once' | 'allow_always' | 'deny' };
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.respondToPermission(requestId, choice);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_PERMISSION_RESPOND', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'respond-failed' });
    }
  });

  r.post('/api/permission/instruct', validate(permissionInstructSchema), (req, res) => {
    try {
      const { requestId, instruction } = req.body as { requestId: string; instruction: string };
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.respondToPermissionInstruction(requestId, instruction);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_PERMISSION_INSTRUCT', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'instruct-failed' });
    }
  });

  r.post('/api/permission/respond-batch', validate(permissionRespondBatchSchema), (req, res) => {
    try {
      const { choice } = req.body as { choice: 'allow_once' | 'allow_always' | 'deny' };
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.respondToPermissionBatch(choice);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_PERMISSION_RESPOND_BATCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'respond-batch-failed' });
    }
  });

  return r;
}
