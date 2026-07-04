/**
 * Governs ingestion worker lifecycle: pause when the app is hidden or no RAG sources exist.
 */
import type { IngestionWorker } from '@agentx/engine';
import { getLogger } from '@agentx/shared';

interface IngestionDbPool {
  query<T = Record<string, unknown>>(text: string): Promise<{ rows: T[] }>;
}

let worker: IngestionWorker | null = null;
let appVisible = true;
let ragSourceCount = 0;
let neuralBrainEnabled = true;
let evaluateTimer: ReturnType<typeof setTimeout> | null = null;

export function bindIngestionWorker(instance: IngestionWorker | null): void {
  worker = instance;
  scheduleEvaluate();
}

export function setIngestionAppVisible(visible: boolean): void {
  if (appVisible === visible) return;
  appVisible = visible;
  scheduleEvaluate();
}

export function setIngestionNeuralBrainEnabled(enabled: boolean): void {
  neuralBrainEnabled = enabled;
  scheduleEvaluate();
}

export async function refreshIngestionRagSourceCount(pool: IngestionDbPool): Promise<number> {
  try {
    const { rows } = await pool.query<{ sources: string; pendingJobs: string }>(
      `SELECT
        (SELECT COUNT(*)::text FROM memory_sources WHERE COALESCE(kind, '') <> 'archived') AS sources,
        (SELECT COUNT(*)::text FROM ingestion_jobs WHERE status IN ('pending', 'running')) AS "pendingJobs"`,
    );
    const sources = parseInt(rows[0]?.sources ?? '0', 10) || 0;
    const pendingJobs = parseInt(rows[0]?.pendingJobs ?? '0', 10) || 0;
    ragSourceCount = sources + pendingJobs;
  } catch {
    ragSourceCount = 0;
  }
  scheduleEvaluate();
  return ragSourceCount;
}

function shouldRunWorker(): boolean {
  return neuralBrainEnabled && appVisible && ragSourceCount > 0;
}

function scheduleEvaluate(): void {
  if (evaluateTimer) clearTimeout(evaluateTimer);
  evaluateTimer = setTimeout(() => {
    evaluateTimer = null;
    evaluateIngestionWorker();
  }, 100);
}

export function evaluateIngestionWorker(): void {
  if (!worker) return;
  const run = shouldRunWorker();
  if (run) {
    worker.resume();
    getLogger().debug('INGESTION_GOVERNOR', `Worker resumed (visible=${appVisible}, sources=${ragSourceCount})`);
  } else {
    worker.pause();
    getLogger().debug('INGESTION_GOVERNOR', `Worker paused (visible=${appVisible}, sources=${ragSourceCount}, neural=${neuralBrainEnabled})`);
  }
}

export function getIngestionGovernorState(): {
  appVisible: boolean;
  ragSourceCount: number;
  neuralBrainEnabled: boolean;
  shouldRun: boolean;
} {
  return {
    appVisible,
    ragSourceCount,
    neuralBrainEnabled,
    shouldRun: shouldRunWorker(),
  };
}
