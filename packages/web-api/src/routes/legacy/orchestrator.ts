import { Router } from 'express';
import type { AgentOrchestrator } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { planOrchestratorMap, planOrchestratorById } from './shared.js';

export function createOrchestratorRouter(): Router {
  const r = Router();

  r.post('/api/orchestrator/plan', async (req, res) => {
    const eng = getEngine();
    if (!eng.agent) {
      res.status(400).json({ error: 'No active agent' });
      return;
    }
    const { goal, steps } = req.body as { goal?: string; steps?: Array<{ description: string; instruction: string; tools: string[]; dependsOn: string[] }> };
    if (!goal) {
      res.status(400).json({ error: 'goal is required' });
      return;
    }

    try {
      const { AgentOrchestrator } = await import('@agentx/engine');
      const orchestrator = new AgentOrchestrator(eng.agent.agents, eng.agent.events);
      const plan = await orchestrator.createPlan(goal);

      if (steps) {
        for (const step of steps) {
          orchestrator.addStep(plan.id, step.description, step.instruction, step.tools, step.dependsOn);
        }
      }

      // Store for later execution — store orchestrator in a WeakMap keyed by the plan
      planOrchestratorMap.set(plan as object, orchestrator);
      // Also map by plan id for lookup during execute endpoint
      planOrchestratorById.set(plan.id, orchestrator);

      res.json({ plan: { id: plan.id, goal: plan.goal, steps: plan.steps, status: plan.status, createdAt: plan.createdAt } });
    } catch (e: unknown) {
      getLogger().error('POST_API_ORCHESTRATOR_PLAN', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'create-plan-failed' });
    }
  });

  r.post('/api/orchestrator/plan/:id/execute', async (req, res) => {
    const eng = getEngine();
    if (!eng.agent) {
      res.status(400).json({ error: 'No active agent' });
      return;
    }
    try {
      // If an orchestrator was stored earlier for this plan id, use it. Otherwise fall back
      // to creating a fresh orchestrator and running a dynamic plan from the request body.
      const stored = planOrchestratorById.get(req.params['id']!);
      if (stored) {
        // We stored the orchestrator instance; assume it exposes execute and getPlan methods
        try {
          const orches = stored as AgentOrchestrator;
          const result = await orches.execute(req.params['id']!);
          // Cleanup stored orchestrator for this plan id now that execution finished
          try { planOrchestratorById.delete(req.params['id']!); } catch (e) { /* ignore */ }
          res.json({ plan: result });
          return;
        } catch (e) {
          // If stored orchestrator failed, continue to fallback creation
          try { planOrchestratorById.delete(req.params['id']!); } catch (e) { /* ignore */ }
        }
      }

      const { AgentOrchestrator } = await import('@agentx/engine');
      const orchestrator = new AgentOrchestrator(eng.agent.agents, eng.agent.events);
      // Re-build the plan from agent orchestrator state using provided steps (if any)
      const plan = await orchestrator.createPlan('dynamic');
      if (req.body?.['steps']) {
        for (const step of (req.body as { steps: Array<{ description: string; instruction: string; tools: string[]; dependsOn: string[] }> }).steps) {
          orchestrator.addStep(plan.id, step.description, step.instruction, step.tools, step.dependsOn);
        }
      }
      const result = await orchestrator.execute(plan.id);
      res.json({ plan: result });
    } catch (e: unknown) {
      getLogger().error('POST_API_ORCHESTRATOR_PLAN_ID_EXECUTE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'execute-plan-failed' });
    }
  });

  return r;
}
