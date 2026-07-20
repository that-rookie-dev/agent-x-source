import {
  createPgNeuralDb,
  GrowthEngine,
  EmotionEngine,
  ExperienceEngine,
  EnhancedToolExecutor,
} from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from './state.js';

export async function getVitals(): Promise<Record<string, unknown>> {
  try {
    const eng = getEngine();
    const pool = eng.pgPool;
    if (!pool) {
      return { status: 'uninitialized', ageDays: 0, level: 'Fresh', wisdomScore: 0, totalExperiences: 0, totalInteractions: 0, totalCorrections: 0, avgConfidence: 0, currentMood: 'neutral', moodIntensity: 0.3, memories: { total: 0, categories: {} }, diaryEntries: 0, brainSizeFormatted: '0 B', nextMilestoneAt: null, capabilities: [], birthDate: null };
    }

    const neuralDb = createPgNeuralDb(pool);
    const growth = new GrowthEngine(neuralDb);
    const emotion = new EmotionEngine(neuralDb);
    const experience = new ExperienceEngine(neuralDb);

    const growthState = growth.getCurrentState();
    const emotionState = emotion.getCurrentState();
    const ageDays = growth.getAgeDays();

    let memoriesTotal = 0;
    const memoryCategories: Record<string, number> = {};
    try {
      const memRes = await pool.query('SELECT category, COUNT(*) as c FROM agent_memories GROUP BY category');
      for (const row of memRes.rows) {
        const category = row['category'] as string;
        const count = Number(row['c'] ?? 0);
        if (category) memoryCategories[category] = count;
        memoriesTotal += count;
      }
    } catch { /* table may not exist yet */ }

    let diaryEntries = 0;
    try {
      const diaryRes = await pool.query('SELECT COUNT(*) as c FROM agent_diary');
      diaryEntries = Number(diaryRes.rows[0]?.['c'] ?? 0);
    } catch { /* */ }

    let birthDate: string | null = null;
    try {
      const sources = await Promise.all([
        pool.query('SELECT MIN(created_at) as d FROM agent_experiences').catch(() => ({ rows: [] })),
        pool.query('SELECT MIN(created_at) as d FROM agent_memories').catch(() => ({ rows: [] })),
        pool.query('SELECT MIN(created_at) as d FROM agent_diary').catch(() => ({ rows: [] })),
      ]);
      const dates = sources
        .map((r: { rows: Array<Record<string, unknown>> }) => r.rows[0]?.['d'] as string | null | undefined)
        .filter((d: string | null | undefined): d is string => !!d);
      if (dates.length > 0) birthDate = dates.sort()[0] ?? null;
    } catch { /* */ }

    let capabilities: string[] = [];
    if (growthState?.capabilities) {
      try { capabilities = JSON.parse(growthState.capabilities); } catch { capabilities = []; }
    }

    let brainSizeFormatted = 'PG';
    try {
      const sizeRes = await pool.query('SELECT pg_database_size(current_database()) as bytes');
      const bytes = Number(sizeRes.rows[0]?.['bytes'] ?? 0);
      brainSizeFormatted = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    } catch { /* */ }

    return {
      status: 'initialized',
      ageDays,
      birthDate,
      level: growthState?.level ?? 'Fresh',
      wisdomScore: growthState?.wisdomScore ?? 0,
      totalExperiences: experience.getTotalCount(),
      totalInteractions: growthState?.totalInteractions ?? 0,
      totalCorrections: experience.getCorrectionCount(),
      avgConfidence: experience.getAverageConfidence(),
      currentMood: emotionState?.currentMood ?? 'neutral',
      moodIntensity: emotionState?.moodIntensity ?? 0.3,
      memories: { total: memoriesTotal, categories: memoryCategories },
      diaryEntries,
      brainSizeFormatted,
      nextMilestoneAt: growthState?.nextMilestoneAt ?? null,
      capabilities,
    };
  } catch (e) {
    getLogger().error('GET_VITALS', e instanceof Error ? e : String(e));
    return { status: 'uninitialized', ageDays: 0, level: 'Fresh', wisdomScore: 0, totalExperiences: 0, totalInteractions: 0, totalCorrections: 0, avgConfidence: 0, currentMood: 'neutral', moodIntensity: 0.3, memories: { total: 0, categories: {} }, diaryEntries: 0, brainSizeFormatted: '0 B', nextMilestoneAt: null, capabilities: [], birthDate: null };
  }
}

/**
 * Aggregate autonomy status for the Health panel observability.
 * Combines circuit breaker status, neural context, memory-driven suggestions,
 * escalation state, hallucination guardrail, offline fallback, and compaction details.
 */
export function getAutonomyStatus(): Record<string, unknown> {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) return { available: false };

    const health = agent.getHealth();

    // Circuit breaker details
    const executor = agent.getToolExecutor();
    let circuitBreakers: Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> = [];
    if (executor && executor instanceof EnhancedToolExecutor) {
      circuitBreakers = executor.getCircuitBreakerStatus();
    }

    // Neural context
    let provenContext = '';
    let cautionContext = '';
    let growthContext = '';
    try {
      const expEngine = agent.experienceEngineInstance;
      if (expEngine) {
        provenContext = expEngine.getProvenContext?.() ?? '';
        cautionContext = expEngine.getCautionContext?.() ?? '';
      }
      const growEngine = agent.growthEngineInstance;
      if (growEngine) {
        growthContext = growEngine.getGrowthContext?.() ?? '';
      }
    } catch { /* */ }

    // Memory-driven approach
    let memoryDrivenContext = '';
    try {
      const rl = agent.reflectionLoopInstance;
      if (rl && typeof rl.getBestApproach === 'function') {
        memoryDrivenContext = rl.getBestApproach?.('current task') ?? '';
      }
    } catch { /* */ }

    // Escalation state — active checkpoints
    let activeCheckpoints = 0;
    let checkpointDetails: Array<{ description: string; checkpointId: string }> = [];
    try {
      const pendingCkp = agent.pendingCheckpoint;
      if (pendingCkp) {
        activeCheckpoints = 1;
        checkpointDetails = [{ description: 'Active checkpoint awaiting user input', checkpointId: pendingCkp.checkpointId }];
      }
    } catch { /* */ }

    // Offline fallback status
    const offlineFallback = { available: false, provider: '', model: '' };

    // DB backend mode
    const dbMode = 'postgres';

    // Compaction stats
    const compactionCount = health.compactionCount;
    const tokenUsagePct = health.contextWindow > 0 ? Math.round((health.contextTokens / health.contextWindow) * 100) : 0;

    return {
      available: true,
      health,
      circuitBreakers,
      neural: { proven: provenContext, caution: cautionContext, growth: growthContext },
      memoryDriven: memoryDrivenContext,
      escalation: {
        activeCheckpoints,
        checkpointDetails,
      },
      offlineFallback,
      dbMode,
      compaction: {
        count: compactionCount,
        contextTokens: health.contextTokens,
        contextWindow: health.contextWindow,
        tokenUsagePct,
      },
    };
  } catch {
    return { available: false };
  }
}
