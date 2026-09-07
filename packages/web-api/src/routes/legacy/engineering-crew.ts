/**
 * Engineering Crew route group — REST surface for Plan Artifacts produced by the
 * isolated Engineering Crew subsystem (design doc Section 5).
 *
 * Namespace: /api/engineering-crew/...
 * Intentionally separate from /api/crews/... (persona Crew system) per the
 * isolation requirement in design doc Section 0.
 */
import { Router } from 'express';
import { EngineeringCrew, EngineeringCrewStore, type PlanArtifact, type PlanPhase } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';

/** Get a DB store if a Postgres pool is available, otherwise null (fall back to JSON checkpoints). */
function getStore(): EngineeringCrewStore | null {
  try {
    const eng = getEngine();
    const pool = eng.pgPool;
    if (pool && typeof pool.query === 'function') {
      return new EngineeringCrewStore(pool as import('pg').Pool);
    }
  } catch { /* engine not initialized */ }
  return null;
}

export function createEngineeringCrewRouter(): Router {
  const r = Router();

  // ── List all Engineering Crew checkpoints (Plan Artifacts) ──
  r.get('/api/engineering-crew/runs', async (_req, res) => {
    try {
      // Try DB first
      const store = getStore();
      if (store) {
        const dbRuns = await store.listRuns();
        if (dbRuns.length > 0) {
          res.json({ runs: dbRuns.map((r) => ({
            taskId: r.taskId,
            objective: r.objective,
            status: r.status,
            phases: r.phases.map((p: PlanPhase) => ({
              id: p.id,
              title: p.title,
              status: p.status,
              dependsOn: p.dependsOn,
              acceptanceCriteria: p.acceptanceCriteria,
              unknowns: p.unknowns ?? [],
              verification: p.verification ?? [],
            })),
          })) });
          return;
        }
      }
      // Fall back to JSON checkpoints
      const taskIds = EngineeringCrew.listCheckpoints();
      const runs = taskIds.map((taskId: string) => {
        const plan: PlanArtifact | null = EngineeringCrew.loadCheckpoint(taskId);
        if (!plan) return { taskId, status: 'unknown' as const, phases: [] };
        const phaseStatuses = plan.phases.map((p: PlanPhase) => p.status);
        const allVerified = phaseStatuses.length > 0 && phaseStatuses.every((s: string) => s === 'verified');
        const anyBlocked = phaseStatuses.some((s: string) => s === 'blocked');
        return {
          taskId,
          objective: plan.objective,
          status: allVerified ? 'complete' as const : anyBlocked ? 'blocked' as const : 'in_progress' as const,
          phases: plan.phases.map((p: PlanPhase) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            dependsOn: p.dependsOn,
            acceptanceCriteria: p.acceptanceCriteria,
            unknowns: p.unknowns ?? [],
            verification: p.verification ?? [],
          })),
        };
      });
      res.json({ runs });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `List runs failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to list Engineering Crew runs' });
    }
  });

  // ── Get a single Plan Artifact by task ID ──
  r.get('/api/engineering-crew/runs/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params as { taskId: string };
      // Try DB first
      const store = getStore();
      if (store) {
        const dbPlan = await store.loadRun(taskId);
        if (dbPlan) {
          res.json({ run: { taskId, plan: dbPlan } });
          return;
        }
      }
      // Fall back to JSON checkpoint
      const plan: PlanArtifact | null = EngineeringCrew.loadCheckpoint(taskId);
      if (!plan) {
        res.status(404).json({ error: `No Engineering Crew run found for task ID "${taskId}"` });
        return;
      }
      res.json({ run: { taskId, plan } });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `Get run failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to get Engineering Crew run' });
    }
  });

  // ── Get only the phases of a run (for UI progress display) ──
  r.get('/api/engineering-crew/runs/:taskId/phases', (req, res) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const plan: PlanArtifact | null = EngineeringCrew.loadCheckpoint(taskId);
      if (!plan) {
        res.status(404).json({ error: `No Engineering Crew run found for task ID "${taskId}"` });
        return;
      }
      res.json({
        phases: plan.phases.map((p: PlanPhase) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          dependsOn: p.dependsOn,
          acceptanceCriteria: p.acceptanceCriteria,
          unknowns: p.unknowns ?? [],
          verification: p.verification ?? [],
          implementationNotes: p.implementationNotes ?? null,
        })),
      });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `Get phases failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to get phases' });
    }
  });

  // ── Get the verification evidence for a specific phase ──
  r.get('/api/engineering-crew/runs/:taskId/phases/:phaseId/verification', (req, res) => {
    try {
      const { taskId, phaseId } = req.params as { taskId: string; phaseId: string };
      const plan: PlanArtifact | null = EngineeringCrew.loadCheckpoint(taskId);
      if (!plan) {
        res.status(404).json({ error: `No Engineering Crew run found for task ID "${taskId}"` });
        return;
      }
      const phase: PlanPhase | undefined = plan.phases.find((p: PlanPhase) => p.id === phaseId);
      if (!phase) {
        res.status(404).json({ error: `Phase "${phaseId}" not found in run "${taskId}"` });
        return;
      }
      res.json({
        phaseId: phase.id,
        title: phase.title,
        status: phase.status,
        verification: phase.verification ?? [],
        acceptanceCriteria: phase.acceptanceCriteria,
      });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `Get verification failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to get verification evidence' });
    }
  });

  // ── Get the acceptance criteria and unknowns for a run ──
  r.get('/api/engineering-crew/runs/:taskId/criteria', (req, res) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const plan: PlanArtifact | null = EngineeringCrew.loadCheckpoint(taskId);
      if (!plan) {
        res.status(404).json({ error: `No Engineering Crew run found for task ID "${taskId}"` });
        return;
      }
      const allUnknowns = plan.phases.flatMap((p: PlanPhase) =>
        (p.unknowns ?? []).map((u) => ({ phaseId: p.id, ...u })),
      );
      res.json({
        objective: plan.objective,
        acceptanceCriteria: plan.acceptanceCriteria,
        unknowns: allUnknowns,
        blocked: allUnknowns.some((u) => u.escalated && !u.resolution),
      });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `Get criteria failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to get criteria' });
    }
  });

  // ── POST /api/engineering-crew/runs — manually trigger a new crew run (#3) ──
  r.post('/api/engineering-crew/runs', async (req, res) => {
    try {
      const { objective, sessionId } = req.body as { objective?: string; sessionId?: string };
      if (!objective || !objective.trim()) {
        res.status(400).json({ error: 'objective is required' });
        return;
      }
      const eng = getEngine();
      const agent = eng.agent;
      if (agent) {
        // #14/#15: If an active agent session exists, use it (preserves full chat context)
        void agent.sendMessage(objective, { userId: req.body.userId }).catch((e) => {
          getLogger().error('ENGINEERING_CREW_API', `Manual trigger via agent failed: ${e instanceof Error ? e.message : String(e)}`);
        });
        res.status(202).json({ status: 'accepted', objective, sessionId: sessionId ?? agent.sessionId, mode: 'agent' });
      } else {
        // #14: No active agent session — can't run the crew without a SubAgentManager.
        // The crew needs an agent's SubAgentManager to spawn LLM-backed sub-agents.
        res.status(409).json({ error: 'No active agent session — start a chat session first, or trigger via chat' });
      }
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `POST runs failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to trigger crew run' });
    }
  });

  // ── POST /api/engineering-crew/runs/:taskId/resume — manually resume a crew run (#3) ──
  r.post('/api/engineering-crew/runs/:taskId/resume', async (req, res) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const { objective } = req.body as { objective?: string };
      const store = getStore();
      let plan: PlanArtifact | null = null;
      if (store) plan = await store.loadRun(taskId);
      if (!plan) plan = EngineeringCrew.loadCheckpoint(taskId);
      if (!plan) {
        res.status(404).json({ error: `No Engineering Crew run found for task ID "${taskId}"` });
        return;
      }
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) {
        res.status(409).json({ error: 'No active agent session — resume via chat instead' });
        return;
      }
      const resumeObjective = objective ?? `Resume work on: ${plan.objective}`;
      void agent.sendMessage(resumeObjective, { userId: req.body.userId }).catch((e) => {
        getLogger().error('ENGINEERING_CREW_API', `Manual resume failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      res.status(202).json({ status: 'accepted', taskId, objective: resumeObjective });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `POST resume failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to resume crew run' });
    }
  });

  // ── DELETE /api/engineering-crew/runs/:taskId — cancel/delete a crew run (#3) ──
  r.delete('/api/engineering-crew/runs/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const store = getStore();
      // #16: Cancel the in-memory running crew if it's active
      const eng = getEngine();
      const agent = eng.agent;
      if (agent) {
        const activeCrew = agent.getActiveCrew?.();
        if (activeCrew && activeCrew.taskId === taskId) {
          activeCrew.cancel();
          getLogger().info('ENGINEERING_CREW_API', `Cancelled in-memory crew ${taskId}`);
        }
      }
      if (store) {
        // Delete the run from the DB (not just mark cancelled), then delete checkpoint file
        await store.deleteRun(taskId).catch(() => {});
      }
      // Delete the checkpoint file if it exists
      EngineeringCrew.deleteCheckpoint(taskId);
      res.json({ status: 'deleted', taskId });
    } catch (e) {
      getLogger().error('ENGINEERING_CREW_API', `DELETE run failed: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: 'Failed to delete crew run' });
    }
  });

  return r;
}
