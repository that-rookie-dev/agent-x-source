import { generateId } from '@agentx/shared';

export interface ExperienceEntry {
  id: string;
  sessionId: string;
  category: 'tool_execution' | 'code_generation' | 'decision' | 'response_quality' | 'error_correction' | 'user_feedback';
  action: string;
  context?: string | null;
  result: 'success' | 'failure' | 'partial' | 'corrected';
  confidence: number;
  reward: number;
  correction?: string | null;
  learnings: string;
  metadata?: string | null;
  createdAt: string;
}

export interface ExperienceTrial {
  category: ExperienceEntry['category'];
  action: string;
  context?: string;
  result: ExperienceEntry['result'];
  correction?: string;
  reward?: number;
  metadata?: Record<string, unknown>;
}

export interface NeuralDb {
  prepare(sql: string): NeuralStatement;
}

export interface NeuralStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export class ExperienceEngine {
  private db: NeuralDb;

  constructor(db: NeuralDb) {
    this.db = db;
  }

  /** Record a trial after every tool execution, LLM response, or decision. */
  recordTrial(sessionId: string, trial: ExperienceTrial): ExperienceEntry {
    const pastTrials = this.getRecent(trial.category, trial.action, 20);
    const baseConfidence = pastTrials.length > 0
      ? pastTrials.reduce((sum, t) => sum + t.confidence, 0) / pastTrials.length
      : 0.5;

    let delta = 0;
    if (trial.result === 'success') delta += 0.05;
    if (trial.result === 'failure') delta -= 0.10;
    if (trial.result === 'corrected') delta -= 0.15;
    if (trial.result === 'partial') delta -= 0.03;
    delta += (trial.reward || 0) * 0.1;

    const newConfidence = Math.max(0, Math.min(1, baseConfidence + delta));
    const learnings = this.generateLearnings(trial, pastTrials, newConfidence);

    const entry: ExperienceEntry = {
      id: generateId(),
      sessionId,
      category: trial.category,
      action: trial.action,
      context: trial.context ?? null,
      result: trial.result,
      confidence: newConfidence,
      reward: trial.reward ?? 0,
      correction: trial.correction ?? null,
      learnings: JSON.stringify(learnings),
      metadata: trial.metadata ? JSON.stringify(trial.metadata) : null,
      createdAt: new Date().toISOString(),
    };

    try {
      this.db.prepare(`
        INSERT INTO agent_experiences (id, session_id, category, action, context, result, confidence, reward, correction, learnings, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `).run(entry.id, entry.sessionId, entry.category, entry.action, entry.context, entry.result, entry.confidence, entry.reward, entry.correction, entry.learnings, entry.metadata);
    } catch { /* table may not exist yet */ }

    return entry;
  }

  /** Get confidence score for a specific action pattern. */
  getConfidence(category: string, action: string): number {
    const trials = this.getRecent(category, action, 20);
    if (trials.length === 0) return 0.5;
    return trials.reduce((sum, t) => sum + t.confidence, 0) / trials.length;
  }

  /** Get proven patterns with high confidence. */
  getProvenPatterns(minConfidence = 0.7): ExperienceEntry[] {
    try {
      return this.db.prepare(
        `SELECT * FROM agent_experiences WHERE confidence >= $1 ORDER BY confidence DESC LIMIT 50`
      ).all(minConfidence) as unknown as ExperienceEntry[];
    } catch { return []; }
  }

  /** Get context string for system prompt injection. */
  getCautionContext(): string {
    const lowConf = this.getProvenPatterns(0);
    const risky = lowConf.filter(e => e.confidence < 0.3 && e.category === 'tool_execution').slice(0, 3);
    if (risky.length === 0) return '';

    const warnings = risky.map(e =>
      `  - ${e.action}: confidence ${(e.confidence * 100).toFixed(0)}%. ${JSON.parse(e.learnings).slice(-1)[0] || 'Proceed with caution.'}`
    ).join('\n');

    return `[CAUTION]\nLow-confidence actions — verify before executing:\n${warnings}\n[/CAUTION]`;
  }

  /** Get proven patterns for injection. */
  getProvenContext(): string {
    const proven = this.getProvenPatterns(0.8);
    if (proven.length === 0) return '';

    const patterns = proven.slice(0, 5).map(e =>
      `  - ${e.action}: mastered (${(e.confidence * 100).toFixed(0)}% confidence, ${this.getTrialCount(e.category, e.action)} trials)`
    ).join('\n');

    return `[PROVEN_PATTERNS]\nWell-established capabilities:\n${patterns}\n[/PROVEN_PATTERNS]`;
  }

  /** Get total experience count. */
  getTotalCount(): number {
    try {
      const row = this.db.prepare('SELECT COUNT(*)::int as c FROM agent_experiences').get() as { c: number } | undefined;
      return row?.c ?? 0;
    } catch { return 0; }
  }

  /** Get average confidence across all experiences. */
  getAverageConfidence(): number {
    try {
      const row = this.db.prepare('SELECT AVG(confidence) as a FROM agent_experiences').get() as { a: number } | undefined;
      return row?.a ?? 0.5;
    } catch { return 0.5; }
  }

  /** Get total corrections count. */
  getCorrectionCount(): number {
    try {
      const row = this.db.prepare("SELECT COUNT(*)::int as c FROM agent_experiences WHERE result = 'corrected'").get() as { c: number } | undefined;
      return row?.c ?? 0;
    } catch { return 0; }
  }

  private getRecent(category: string, action: string, limit: number): ExperienceEntry[] {
    try {
      return this.db.prepare(
        `SELECT * FROM agent_experiences WHERE category = $1 AND action = $2 ORDER BY created_at DESC LIMIT $3`
      ).all(category, action, limit) as unknown as ExperienceEntry[];
    } catch { return []; }
  }

  private getTrialCount(category: string, action: string): number {
    try {
      const row = this.db.prepare(
        `SELECT COUNT(*)::int as c FROM agent_experiences WHERE category = $1 AND action = $2`
      ).get(category, action) as { c: number } | undefined;
      return row?.c ?? 0;
    } catch { return 0; }
  }

  private generateLearnings(trial: ExperienceTrial, pastTrials: ExperienceEntry[], confidence: number): string[] {
    const learnings: string[] = [];

    if (trial.result === 'success' && confidence > 0.7) {
      learnings.push(`Pattern "${trial.action}" is reliable (${(confidence * 100).toFixed(0)}% confidence across ${pastTrials.length + 1} trials).`);
    }
    if (trial.result === 'failure') {
      learnings.push(`Action "${trial.action}" failed. Context: ${trial.context?.slice(0, 100) || 'unspecified'}.`);
    }
    if (trial.result === 'corrected' && trial.correction) {
      learnings.push(`Correction learned: "${trial.correction}". Will apply this going forward.`);
    }
    if (confidence < 0.3 && pastTrials.length > 1) {
      learnings.push(`Confidence for "${trial.action}" is critically low. Request user confirmation before attempting.`);
    }
    if (trial.reward && trial.reward > 0.5) {
      learnings.push(`User provided positive feedback (+${trial.reward}). This behavior is valued.`);
    }
    if (trial.reward && trial.reward < -0.5) {
      learnings.push(`User provided negative feedback (${trial.reward}). Adjust approach immediately.`);
    }

    return learnings.length > 0 ? learnings : ['No significant learning from this trial.'];
  }
}
