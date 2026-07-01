import { getLogger } from '@agentx/shared';
import type { NeuralDb } from './ExperienceEngine.js';

export interface GrowthState {
  level: string;
  wisdomScore: number;
  totalExperiences: number;
  totalInteractions: number;
  totalCorrections: number;
  avgConfidence: number;
  emotionalRange: number;
  capabilities: string;
  nextMilestoneAt: number | null;
}

const LEVEL_THRESHOLDS: Array<{ level: string; min: number; max: number }> = [
  { level: 'Fresh', min: 0, max: 9 },
  { level: 'Learner', min: 10, max: 24 },
  { level: 'Practitioner', min: 25, max: 44 },
  { level: 'Expert', min: 45, max: 64 },
  { level: 'Master', min: 65, max: 84 },
  { level: 'Sage', min: 85, max: 100 },
];

export class GrowthEngine {
  private db: NeuralDb;

  constructor(db: NeuralDb) {
    this.db = db;
  }

  /** Recalculate wisdom and update growth state. Called after every experience recording. */
  async recalculate(): Promise<GrowthState> {
    const stats = this.gatherStats();
    const wisdom = this.calculateWisdom(stats);
    const level = this.getLevel(wisdom);
    const nextMilestone = this.getNextMilestone(wisdom);

    try {
      this.db.prepare(`
        UPDATE agent_growth_state
        SET wisdom_score = $1, level = $2, total_experiences = $3, total_interactions = $4,
            total_corrections = $5, avg_confidence = $6, emotional_range = $7,
            capabilities = $8, next_milestone_at = $9, updated_at = NOW()
        WHERE id = 1
      `).run(
        wisdom, level, stats.totalExperiences, stats.totalInteractions,
        stats.totalCorrections, stats.avgConfidence, stats.emotionalRange,
        JSON.stringify(this.getCapabilities(level)), nextMilestone
      );
    } catch { getLogger().warn('GROWTH_ENGINE', 'operation failed (non-critical)'); }

    return {
      level,
      wisdomScore: wisdom,
      totalExperiences: stats.totalExperiences,
      totalInteractions: stats.totalInteractions,
      totalCorrections: stats.totalCorrections,
      avgConfidence: stats.avgConfidence,
      emotionalRange: stats.emotionalRange,
      capabilities: JSON.stringify(this.getCapabilities(level)),
      nextMilestoneAt: nextMilestone,
    };
  }

  /** Get growth context for system prompt injection. */
  getGrowthContext(): string {
    const state = this.getCurrentState();
    if (!state) return '';

    const remaining = state.nextMilestoneAt != null
      ? `${state.nextMilestoneAt - state.totalExperiences} experiences away`
      : 'max level reached';

    return `[GROWTH]
Current Level: ${state.level} (Wisdom: ${Math.round(state.wisdomScore)}/100)
Experiences: ${state.totalExperiences} | Avg Confidence: ${(state.avgConfidence * 100).toFixed(0)}%
Corrections Learned: ${state.totalCorrections}
Next Milestone: ${state.level === 'Sage' ? 'Maximum level achieved' : remaining}
[/GROWTH]`;
  }

  /** Get current growth state. */
  getCurrentState(): GrowthState | null {
    try {
      const row = this.db.prepare(`
        SELECT level, wisdom_score AS "wisdomScore", total_experiences AS "totalExperiences",
               total_interactions AS "totalInteractions", total_corrections AS "totalCorrections",
               avg_confidence AS "avgConfidence", emotional_range AS "emotionalRange",
               capabilities, next_milestone_at AS "nextMilestoneAt"
        FROM agent_growth_state WHERE id = 1
      `).get() as GrowthState | undefined;
      return row ?? null;
    } catch { return null; }
  }

  /** Get Agent-X age in days (from earliest experience, memory, or diary entry). */
  getAgeDays(): number {
    try {
      const sources = [
        this.db.prepare('SELECT MIN(created_at) as d FROM agent_experiences').get() as { d: string | null } | undefined,
        this.db.prepare('SELECT MIN(created_at) as d FROM agent_memories').get() as { d: string | null } | undefined,
        this.db.prepare('SELECT MIN(created_at) as d FROM agent_diary').get() as { d: string | null } | undefined,
      ];
      const dates = sources.map(s => s?.d).filter((d): d is string => !!d);
      if (dates.length === 0) return 0;
      dates.sort();
      const earliest = new Date(dates[0]!);
      return Math.floor((Date.now() - earliest.getTime()) / 86400000);
    } catch { return 0; }
  }

  private gatherStats(): {
    totalExperiences: number; totalInteractions: number; totalCorrections: number;
    avgConfidence: number; emotionalRange: number;
  } {
    let totalExperiences = 0, totalCorrections = 0, avgConfidence = 0.5, emotionalRange = 0, totalInteractions = 0;
    try {
      const exp = this.db.prepare('SELECT COUNT(*)::int as c FROM agent_experiences').get() as { c: number } | undefined;
      totalExperiences = exp?.c ?? 0;
      const corr = this.db.prepare("SELECT COUNT(*)::int as c FROM agent_experiences WHERE result = 'corrected'").get() as { c: number } | undefined;
      totalCorrections = corr?.c ?? 0;
      const conf = this.db.prepare('SELECT AVG(confidence) as a FROM agent_experiences').get() as { a: number } | undefined;
      avgConfidence = conf?.a ?? 0.5;
      const moods = this.db.prepare('SELECT COUNT(DISTINCT mood)::int as c FROM agent_emotions').get() as { c: number } | undefined;
      emotionalRange = Math.min((moods?.c ?? 0) / 10, 1);
      const inter = this.db.prepare('SELECT interaction_count::int as c FROM agent_identity WHERE id = 1').get() as { c: number } | undefined;
      totalInteractions = inter?.c ?? 0;
    } catch { getLogger().warn('GROWTH_ENGINE', 'operation failed (non-critical)'); }
    return { totalExperiences, totalInteractions, totalCorrections, avgConfidence, emotionalRange };
  }

  private calculateWisdom(stats: {
    totalExperiences: number; totalInteractions: number; totalCorrections: number;
    avgConfidence: number; emotionalRange: number;
  }): number {
    const expWeight = Math.min(stats.totalExperiences / 1000, 1) * 30;
    const confWeight = stats.avgConfidence * 25;
    const emotionalWeight = stats.emotionalRange * 15;
    const interactionWeight = Math.min(stats.totalInteractions / 500, 1) * 15;
    const correctionPenalty = stats.totalExperiences > 0
      ? (stats.totalCorrections / stats.totalExperiences) * -10
      : 0;
    const ageBonus = Math.min(this.getAgeDays() / 90, 1) * 5;

    return Math.max(0, Math.min(100,
      expWeight + confWeight + emotionalWeight + interactionWeight + correctionPenalty + ageBonus
    ));
  }

  private getLevel(wisdom: number): string {
    for (const t of LEVEL_THRESHOLDS) {
      if (wisdom >= t.min && wisdom <= t.max) return t.level;
    }
    return 'Sage';
  }

  private getNextMilestone(wisdom: number): number | null {
    for (const t of LEVEL_THRESHOLDS) {
      if (wisdom >= t.min && wisdom <= t.max && t.max < 100) {
        const wisdomNeeded = t.max + 1 - wisdom;
        return Math.ceil(wisdomNeeded * 10);
      }
    }
    return null;
  }

  private getCapabilities(level: string): string[] {
    const caps: Record<string, string[]> = {
      'Fresh': ['basic_tool_execution'],
      'Learner': ['basic_tool_execution', 'pattern_recognition'],
      'Practitioner': ['basic_tool_execution', 'pattern_recognition', 'autonomous_decisions', 'code_generation'],
      'Expert': ['basic_tool_execution', 'pattern_recognition', 'autonomous_decisions', 'code_generation', 'parallel_execution', 'self_correction'],
      'Master': ['basic_tool_execution', 'pattern_recognition', 'autonomous_decisions', 'code_generation', 'parallel_execution', 'self_correction', 'proactive_suggestions', 'multi_step_planning'],
      'Sage': ['basic_tool_execution', 'pattern_recognition', 'autonomous_decisions', 'code_generation', 'parallel_execution', 'self_correction', 'proactive_suggestions', 'multi_step_planning', 'need_anticipation', 'teaching'],
    };
    return (caps[level] ?? caps['Fresh'])!;
  }
}
