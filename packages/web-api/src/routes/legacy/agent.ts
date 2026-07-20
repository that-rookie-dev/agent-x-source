/**
 * Agent route group (persona, mode escalation, turn state, autonomy).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createAgentRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import type { AgentPersonaConfig } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getPersonaStore } from '@agentx/engine';
import { getEngine, awaitEngineStorageReady, getAutonomyStatus } from '../../engine.js';
import { EnhancedToolExecutor } from '@agentx/engine';
import { turnRegistry } from '../../turn-registry.js';

function normalizePersonaBody(body: Record<string, unknown>): AgentPersonaConfig {
  return {
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Agent-X',
    description: typeof body.description === 'string' ? body.description : '',
    communicationStyle: (body.communicationStyle as AgentPersonaConfig['communicationStyle']) ?? 'direct',
    decisionMaking: (body.decisionMaking as AgentPersonaConfig['decisionMaking']) ?? 'balanced',
    domainContext: typeof body.domainContext === 'string' ? body.domainContext : 'general',
    traits: Array.isArray(body.traits) ? body.traits.filter((t): t is string => typeof t === 'string') : [],
  };
}

export function createAgentRouter(): Router {
  const r = Router();

  r.get('/api/agent/persona', (_req, res) => {
    try {
      res.json(getPersonaStore().get());
    } catch (e) {
      getLogger().error('GET_API_AGENT_PERSONA', e instanceof Error ? e : String(e));
      res.json({});
    }
  });

  r.put('/api/agent/persona', async (req, res) => {
    const eng = getEngine();
    try {
      await awaitEngineStorageReady();
      const personaData = normalizePersonaBody(req.body ?? {});
      getPersonaStore().save(personaData);
      if (eng.agent) {
        eng.agent.applyPersona(personaData);
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
