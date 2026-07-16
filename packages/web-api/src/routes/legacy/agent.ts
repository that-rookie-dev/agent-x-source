/**
 * Agent route group (persona, mode escalation, turn state, vitals, autonomy).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createAgentRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady, getVitals, getAutonomyStatus } from '../../engine.js';
import { EnhancedToolExecutor } from '@agentx/engine';
import { turnRegistry } from '../../turn-registry.js';

export function createAgentRouter(): Router {
  const r = Router();

  r.get('/api/agent/persona', (_req, res) => {
    const eng = getEngine();
    try {
      const store = eng.sessionManager.getStorageAdapter();
      if (store && typeof store.getPersona === 'function') {
        const persona = store.getPersona();
        res.json(persona ?? {});
      } else {
        res.json({});
      }
    } catch (e) {
      res.json({});
    }
  });

  r.put('/api/agent/persona', async (req, res) => {
    const eng = getEngine();
    try {
      await awaitEngineStorageReady();
      const store = eng.sessionManager.getStorageAdapter();
      if (store && typeof store.setPersona === 'function') {
        store.setPersona({
          name: req.body.name ?? 'Agent-X',
          description: req.body.description ?? '',
          communicationStyle: req.body.communicationStyle ?? 'direct',
          decisionMaking: req.body.decisionMaking ?? 'balanced',
          domainContext: req.body.domainContext ?? 'general',
          traits: req.body.traits ?? [],
        });
      }
      // If there's a running agent, update its persona in-memory
      if (eng.agent) {
        const personaData = {
          name: req.body.name ?? 'Agent-X',
          description: req.body.description ?? '',
          communicationStyle: req.body.communicationStyle ?? 'direct',
          decisionMaking: req.body.decisionMaking ?? 'balanced',
          domainContext: req.body.domainContext ?? 'general',
          traits: req.body.traits ?? [],
        };
        eng.agent.applyPersona(personaData);
        // Re-seed identity manager so evolution overlay is in sync
        try { eng.agent.applyPersona(personaData); } catch (e) {
          try { eng.agent.applyPersona(personaData); } catch { /* ignore */ }
        }
      }
      res.json({ ok: true });
    } catch (err) {
      getLogger().error('PUT_API_AGENT_PERSONA', err instanceof Error ? err : String(err));
      res.status(500).json({ ok: false, error: 'Failed to save persona.' });
    }
  });

  r.post('/api/agent/step-cap/respond', (req, res) => {
    try {
      const { continueRun } = req.body as { continueRun: boolean };
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.respondToStepCap(!!continueRun);
      res.json({ ok: true, continueRun: !!continueRun });
    } catch (e) {
      getLogger().error('STEP_CAP', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'step-cap-failed' });
    }
  });

  r.get('/api/agent/turn-state', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.json({ phase: 'idle' }); return; }
      const snap = agent.getTurnStateSnapshot();
      res.json(snap ?? { phase: 'idle' });
    } catch (e) {
      res.status(500).json({ error: 'turn-state-failed' });
    }
  });

  r.get('/api/chat/turn/:turnId', (req, res) => {
    const record = turnRegistry.get(req.params.turnId);
    if (!record) { res.status(404).json({ error: 'turn-not-found' }); return; }
    res.json(record);
  });

  r.get('/api/agent/state', (_req, res) => {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) {
      res.json({ active: false, session: null, crew: null, model: null, processing: false });
      return;
    }
    const session = eng.sessionManager.getActiveSession();
    const crewStates = eng.sessionManager.getCrewStates();
    res.json({
      active: true,
      session: session ? { id: session.id, title: session.title, status: session.status, scopePath: session.scopePath } : null,
      crew: { crewStates },
      model: { provider: session?.providerId, model: session?.modelId },
      processing: agent.lifecycle.isProcessing(),
      bypassPermissions: agent.bypassPermissions,
    });
  });

  r.get('/api/agent/vitals', async (_req, res) => {
    try {
      const vitals = await getVitals();
      res.json(vitals);
    } catch (e) {
      getLogger().error('GET_API_AGENT_VITALS', e instanceof Error ? e : String(e));
      res.status(500).json({ status: 'uninitialized', error: e instanceof Error ? e.message : 'vitals-error' });
    }
  });

  r.get('/api/agent/autonomy-status', (_req, res) => {
    try {
      const status = getAutonomyStatus();
      res.json(status);
    } catch (e) {
      getLogger().error('GET_API_AUTONOMY_STATUS', e instanceof Error ? e : String(e));
      res.status(500).json({ available: false, error: e instanceof Error ? e.message : 'autonomy-error' });
    }
  });

  r.post('/api/agent/circuit-breaker/reset', (req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'No active agent' }); return; }
      const executor = agent.getToolExecutor();
      const toolName = req.body?.tool;
      const isEnhanced = executor instanceof EnhancedToolExecutor;
      if (toolName && isEnhanced) {
        executor.resetCircuitBreaker(toolName);
        res.json({ ok: true, tool: toolName });
      } else if (!toolName && isEnhanced) {
        executor.resetAllCircuitBreakers();
        res.json({ ok: true, all: true });
      } else {
        res.status(400).json({ error: 'Missing tool name or executor unavailable' });
      }
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'reset-failed' });
    }
  });


  return r;
}
