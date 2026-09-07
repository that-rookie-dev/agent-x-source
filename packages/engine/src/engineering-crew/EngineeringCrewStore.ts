import { getLogger } from '@agentx/shared';
import type { Pool } from 'pg';
import type { PlanArtifact, PlanPhase } from './types.js';

/**
 * Database persistence for Engineering Crew Plan Artifacts (design doc Section 5.1).
 *
 * Stores runs and phases in `engineering_crew_runs` / `engineering_crew_phases` tables,
 * separate from the persona Crew system's tables (design doc Section 0 — isolation mandate).
 *
 * The in-memory `EngineeringCrew` orchestrator remains the source of truth during a run;
 * this class mirrors state to Postgres for queryable persistence, REST API consumption,
 * and cross-restart recovery. Writes are best-effort — a DB failure never blocks the crew.
 */
export class EngineeringCrewStore {
  constructor(private readonly pool: Pool) {}

  /** Upsert a run and all its phases from a Plan Artifact. */
  async saveRun(plan: PlanArtifact, sessionId?: string, summary?: string, rounds?: number, status?: string): Promise<void> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return;
    try {
      const allVerified = plan.phases.length > 0 && plan.phases.every((p) => p.status === 'verified');
      const anyBlocked = plan.phases.some((p) => p.status === 'blocked');
      const derivedStatus = allVerified ? 'complete' : anyBlocked ? 'blocked' : 'in_progress';
      const finalStatus = status ?? derivedStatus;

      await client.query(
        `INSERT INTO engineering_crew_runs (task_id, session_id, objective, status, acceptance_criteria, updated_at, completed_at, summary, rounds, plan_snapshot)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
         ON CONFLICT (task_id) DO UPDATE SET
           objective = EXCLUDED.objective,
           status = EXCLUDED.status,
           acceptance_criteria = EXCLUDED.acceptance_criteria,
           updated_at = NOW(),
           completed_at = EXCLUDED.completed_at,
           summary = EXCLUDED.summary,
           rounds = EXCLUDED.rounds,
           plan_snapshot = EXCLUDED.plan_snapshot`,
        [
          plan.taskId,
          sessionId ?? null,
          plan.objective,
          finalStatus,
          JSON.stringify(plan.acceptanceCriteria),
          allVerified ? new Date().toISOString() : null,
          summary ?? null,
          rounds ?? 0,
          JSON.stringify(plan),
        ],
      );

      // Replace all phases for this run (simplest correct approach)
      await client.query('DELETE FROM engineering_crew_phases WHERE run_task_id = $1', [plan.taskId]);
      for (const phase of plan.phases) {
        await client.query(
          `INSERT INTO engineering_crew_phases
             (id, run_task_id, title, status, depends_on, acceptance_criteria, unknowns, verification, implementation_notes, retry_count, explicit_commands, code_document, test_document, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
          [
            phase.id,
            plan.taskId,
            phase.title,
            phase.status,
            JSON.stringify(phase.dependsOn),
            JSON.stringify(phase.acceptanceCriteria),
            JSON.stringify(phase.unknowns ?? []),
            JSON.stringify(phase.verification ?? []),
            phase.implementationNotes ?? null,
            phase.retryCount ?? 0,
            phase.explicitCommands ? JSON.stringify(phase.explicitCommands) : null,
            JSON.stringify(phase.codeDocument ?? {}),
            JSON.stringify(phase.testDocument ?? {}),
          ],
        );
      }
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `saveRun failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      client.release();
    }
  }

  /** Load a Plan Artifact from the database by task ID. */
  async loadRun(taskId: string): Promise<PlanArtifact | null> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return null;
    try {
      const runResult = await client.query('SELECT * FROM engineering_crew_runs WHERE task_id = $1', [taskId]);
      if (runResult.rows.length === 0) return null;
      const row = runResult.rows[0] as Record<string, unknown>;

      // #2: Restore phases from plan_snapshot JSON (which includes codeDocument/testDocument)
      // rather than from the engineering_crew_phases table (which doesn't store them).
      // Fall back to the phases table if plan_snapshot doesn't contain phases.
      let phases: PlanPhase[] | null = null;
      const snapshot = row['plan_snapshot'] as string | null;
      if (snapshot) {
        try {
          const parsed = JSON.parse(snapshot) as PlanArtifact;
          if (parsed.phases && parsed.phases.length > 0) {
            phases = parsed.phases;
          }
        } catch { /* fall through to phases table */ }
      }
      if (!phases) {
        const phasesResult = await client.query(
          'SELECT * FROM engineering_crew_phases WHERE run_task_id = $1 ORDER BY id',
          [taskId],
        );
        phases = phasesResult.rows.map((r) => this.rowToPhase(r as Record<string, unknown>));
      }

      return {
        taskId: row['task_id'] as string,
        objective: row['objective'] as string,
        acceptanceCriteria: this.parseJsonArray(row['acceptance_criteria'] as string),
        phases,
        createdAt: new Date(row['created_at'] as string).getTime(),
        updatedAt: new Date(row['updated_at'] as string).getTime(),
        // Restore SOP documents from plan_snapshot if available
        prd: this.parseJsonField(row['plan_snapshot'] as string, 'prd'),
        design: this.parseJsonField(row['plan_snapshot'] as string, 'design'),
        taskList: this.parseJsonField(row['plan_snapshot'] as string, 'taskList'),
      };
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `loadRun failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      client.release();
    }
  }

  /** List all runs with their phase statuses. */
  async listRuns(): Promise<Array<{ taskId: string; objective: string; status: string; phases: PlanPhase[]; createdAt: number; updatedAt: number }>> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return [];
    try {
      const result = await client.query(
        `SELECT r.task_id, r.objective, r.status, r.created_at, r.updated_at,
                COALESCE(
                  (SELECT json_agg(p ORDER BY p.id)
                   FROM (
                     SELECT id, title, status, depends_on, acceptance_criteria, unknowns, verification, code_document, test_document
                     FROM engineering_crew_phases
                     WHERE run_task_id = r.task_id
                   ) p),
                  '[]'::json
                ) AS phases
         FROM engineering_crew_runs r
         ORDER BY r.updated_at DESC`,
      );
      return result.rows.map((r) => ({
        taskId: r['task_id'] as string,
        objective: r['objective'] as string,
        status: r['status'] as string,
        phases: (r['phases'] as any[] ?? []).map((p) => ({
          id: p['id'] as string,
          title: p['title'] as string,
          status: p['status'] as PlanPhase['status'],
          dependsOn: JSON.parse(p['depends_on'] as string) as string[],
          acceptanceCriteria: JSON.parse(p['acceptance_criteria'] as string) as string[],
          unknowns: JSON.parse(p['unknowns'] as string) as any[],
          verification: JSON.parse(p['verification'] as string) as any[],
          codeDocument: this.parseJson(p['code_document'] as string, undefined),
          testDocument: this.parseJson(p['test_document'] as string, undefined),
          retryCount: 0,
        } as PlanPhase)),
        createdAt: new Date(r['created_at'] as string).getTime(),
        updatedAt: new Date(r['updated_at'] as string).getTime(),
      }));
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `listRuns failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Find the most recent incomplete (in_progress/blocked/timed_out/failed) crew run
   * for a given session. Returns null if no incomplete run exists or the pool is unavailable.
   *
   * Used by the Agent to detect whether a coding turn is a "continue from pending work"
   * request — if a prior run exists for this session, the Agent can resume it instead of
   * starting a fresh crew pipeline.
   */
  async findIncompleteRunBySession(sessionId: string): Promise<{ taskId: string; objective: string; status: string; plan: PlanArtifact } | null> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return null;
    try {
      const result = await client.query(
        `SELECT task_id, objective, status, plan_snapshot
         FROM engineering_crew_runs
         WHERE session_id = $1 AND status IN ('in_progress', 'blocked', 'timed_out', 'failed')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [sessionId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as Record<string, unknown>;
      let plan: PlanArtifact | null = null;
      try {
        plan = JSON.parse(row['plan_snapshot'] as string) as PlanArtifact;
      } catch {
        plan = await this.loadRun(row['task_id'] as string);
      }
      if (!plan) return null;
      return {
        taskId: row['task_id'] as string,
        objective: row['objective'] as string,
        status: row['status'] as string,
        plan,
      };
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `findIncompleteRunBySession failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      client.release();
    }
  }

  /** Find the most recent run (any status) for a session — used to check if the session has prior crew work. */
  async findLatestRunBySession(sessionId: string): Promise<{ taskId: string; objective: string; status: string } | null> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return null;
    try {
      const result = await client.query(
        `SELECT task_id, objective, status
         FROM engineering_crew_runs
         WHERE session_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [sessionId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as Record<string, unknown>;
      return {
        taskId: row['task_id'] as string,
        objective: row['objective'] as string,
        status: row['status'] as string,
      };
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `findLatestRunBySession failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      client.release();
    }
  }

  /** Update the status of a run (#3 — DELETE/cancel endpoint). */
  async updateRunStatus(taskId: string, status: string): Promise<void> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return;
    try {
      await client.query(
        'UPDATE engineering_crew_runs SET status = $2, updated_at = NOW() WHERE task_id = $1',
        [taskId, status],
      );
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `updateRunStatus failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      client.release();
    }
  }

  /** Permanently delete a run and all its phases from the DB. */
  async deleteRun(taskId: string): Promise<void> {
    const client = await this.pool.connect().catch(() => null);
    if (!client) return;
    try {
      await client.query('DELETE FROM engineering_crew_phases WHERE run_task_id = $1', [taskId]);
      await client.query('DELETE FROM engineering_crew_runs WHERE task_id = $1', [taskId]);
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW_DB', `deleteRun failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      client.release();
    }
  }

  private rowToPhase(row: Record<string, unknown>): PlanPhase {
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      status: row['status'] as PlanPhase['status'],
      dependsOn: this.parseJsonArray(row['depends_on'] as string),
      acceptanceCriteria: this.parseJsonArray(row['acceptance_criteria'] as string),
      unknowns: this.parseJson(row['unknowns'] as string, []),
      verification: this.parseJson(row['verification'] as string, []),
      implementationNotes: (row['implementation_notes'] as string) ?? undefined,
      retryCount: (row['retry_count'] as number) ?? 0,
      explicitCommands: this.parseJson(row['explicit_commands'] as string, undefined),
      codeDocument: this.parseJson(row['code_document'] as string, undefined),
      testDocument: this.parseJson(row['test_document'] as string, undefined),
    };
  }

  private parseJsonArray(s: string | null | undefined): string[] {
    if (!s) return [];
    try { return JSON.parse(s) as string[]; } catch { return []; }
  }

  private parseJson<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  }

  /** Extract a specific field from a JSON snapshot string. */
  private parseJsonField<T = unknown>(snapshot: string | null | undefined, field: string): T | undefined {
    if (!snapshot) return undefined;
    try {
      const parsed = JSON.parse(snapshot) as Record<string, unknown>;
      return parsed[field] as T | undefined;
    } catch { return undefined; }
  }
}
