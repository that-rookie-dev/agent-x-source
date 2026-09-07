import { generateId, type ObservedPattern } from '@agentx/shared';
import type { CapabilityObserver, CapabilityStore } from './interfaces.js';
import { jaccard, ngramSet, scoreConfidence, tokens } from './observer-score.js';

const IGNORED_TOOLS = new Set([
  'ask_clarification',
  'todo_write',
  'todo_read',
  'present_visual',
]);

export interface ObserverOptions {
  minFrequency?: number;
  minConfidenceThreshold?: number;
  observationWindowMs?: number;
  maxActiveObservations?: number;
  sweepEveryTurns?: number;
  sweepIntervalMs?: number;
  onThreshold?: (pattern: ObservedPattern) => void;
}

export class DefaultCapabilityObserver implements CapabilityObserver {
  private running = false;
  private turnCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly minFrequency: number;
  private readonly minConfidenceThreshold: number;
  private readonly observationWindowMs: number;
  private readonly maxActiveObservations: number;
  private readonly sweepEveryTurns: number;
  private readonly sweepIntervalMs: number;
  private readonly onThreshold?: (pattern: ObservedPattern) => void;

  constructor(
    private store: CapabilityStore,
    minFrequencyOrOpts: number | ObserverOptions = 3,
  ) {
    const opts: ObserverOptions = typeof minFrequencyOrOpts === 'number'
      ? { minFrequency: minFrequencyOrOpts }
      : minFrequencyOrOpts;
    this.minFrequency = opts.minFrequency ?? 3;
    this.minConfidenceThreshold = opts.minConfidenceThreshold ?? 0.6;
    this.observationWindowMs = opts.observationWindowMs ?? 3_600_000;
    this.maxActiveObservations = opts.maxActiveObservations ?? 50;
    this.sweepEveryTurns = opts.sweepEveryTurns ?? 5;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? (typeof minFrequencyOrOpts === 'number' ? 0 : 60_000);
    this.onThreshold = opts.onThreshold;
  }

  async start(): Promise<void> {
    this.running = true;
    if (this.timer) clearInterval(this.timer);
    if (this.sweepIntervalMs > 0) {
      this.timer = setInterval(() => {
        if (!this.running) return;
        void this.sweep().catch(() => undefined);
      }, this.sweepIntervalMs);
      this.timer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getPatterns(minConfidence = 0): Promise<ObservedPattern[]> {
    return this.store.getObservations(minConfidence);
  }

  async acknowledgePattern(id: string): Promise<void> {
    await this.store.updateObservation(id, { acknowledged: true });
  }

  async ignorePattern(id: string): Promise<void> {
    await this.store.updateObservation(id, { ignored: true, acknowledged: true });
  }

  async recordRejection(patternId: string): Promise<void> {
    const pattern = await this.store.getObservation(patternId);
    if (!pattern || pattern.origin === 'user-prompt') return;
    const rejectedCount = (pattern.rejectedCount ?? 0) + 1;
    const prior = await this.usagePrior(pattern.pattern);
    const confidence = scoreConfidence({
      frequency: pattern.frequency,
      minFrequency: this.minFrequency,
      lastObservedAt: pattern.lastObservedAt,
      pattern: pattern.pattern,
      observationWindowMs: this.observationWindowMs,
      priorBoost: prior,
      rejectedCount,
      now: Date.now(),
    });
    await this.store.updateObservation(patternId, {
      rejectedCount,
      confidence,
      ignored: rejectedCount >= 3,
      acknowledged: rejectedCount >= 3,
    });
  }

  async reportUserPromptObservation(
    prompt: string,
    options?: { examples?: Array<{ input: Record<string, unknown>; expectedOutput?: unknown }> },
  ): Promise<ObservedPattern> {
    const now = Date.now();
    const pattern: ObservedPattern = {
      id: generateId('obs'),
      pattern: prompt.trim(),
      frequency: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      context: prompt.trim(),
      confidence: 1,
      origin: 'user-prompt',
      exampleInputs: options?.examples,
      acknowledged: false,
    };
    await this.store.insertObservation(pattern);
    const stored = (await this.store.getObservations()).find((p) => p.pattern === pattern.pattern);
    return stored ?? pattern;
  }

  async observeTurn(input: {
    sessionId: string;
    userText: string;
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<ObservedPattern[]> {
    if (!this.running) return [];
    const created: ObservedPattern[] = [];
    created.push(...await this.recordRepeatedTools(input));
    created.push(...await this.recordPhrasing(input.userText));
    created.push(...await this.recordWorkflow(input.tools, input.userText));
    created.push(...await this.matchKeywordTriggers(input.userText));
    created.push(...await this.mineAggregates());
    this.turnCount += 1;
    if (this.turnCount % this.sweepEveryTurns === 0) {
      created.push(...await this.sweep());
    }
    await this.rescoreAll();
    this.emitThresholds(created);
    return created;
  }

  async sweep(): Promise<ObservedPattern[]> {
    const created = await this.mineAggregates();
    await this.rescoreAll();
    this.emitThresholds(created);
    return created;
  }

  private emitThresholds(patterns: ObservedPattern[]): void {
    if (!this.onThreshold) return;
    for (const pattern of patterns) {
      if (pattern.origin === 'user-prompt') continue;
      if (pattern.ignored || pattern.acknowledged) continue;
      if (pattern.frequency >= this.minFrequency && pattern.confidence >= this.minConfidenceThreshold) {
        this.onThreshold(pattern);
      }
    }
  }

  private async recordRepeatedTools(input: {
    userText: string;
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<ObservedPattern[]> {
    const created: ObservedPattern[] = [];
    const counts = new Map<string, number>();
    for (const tool of input.tools) {
      if (IGNORED_TOOLS.has(tool.name) || tool.name.startsWith('si_')) continue;
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }
    for (const [name, n] of counts) {
      if (n < 2) continue;
      const pattern = await this.upsertPattern(`repeated tool ${name}`, input.userText, n);
      if (pattern) created.push(pattern);
    }
    return created;
  }

  private async recordPhrasing(userText: string): Promise<ObservedPattern[]> {
    const text = userText.trim();
    if (text.length < 12) return [];
    const grams = ngramSet(text);
    const existing = await this.store.getObservations(0, { includeIgnored: true });
    for (const row of existing) {
      if (row.ignored) continue;
      const score = jaccard(grams, ngramSet(row.pattern));
      if (score >= 0.45) {
        const next = await this.upsertPattern(row.pattern, text, 1);
        return next ? [next] : [];
      }
      if (row.pattern.includes(text) || text.includes(row.pattern)) {
        const next = await this.upsertPattern(row.pattern, text, 1);
        return next ? [next] : [];
      }
    }
    const pattern = await this.upsertPattern(`phrasing: ${text.slice(0, 180)}`, text, 1);
    return pattern ? [pattern] : [];
  }

  private async recordWorkflow(
    tools: Array<{ name: string }>,
    userText: string,
  ): Promise<ObservedPattern[]> {
    const names = tools
      .map((t) => t.name)
      .filter((n) => !IGNORED_TOOLS.has(n) && !n.startsWith('si_'));
    if (names.length < 3) return [];
    const seq = names.slice(0, 6).join('→');
    const pattern = await this.upsertPattern(`workflow ${seq}`, userText, 1);
    return pattern ? [pattern] : [];
  }

  private async matchKeywordTriggers(userText: string): Promise<ObservedPattern[]> {
    const created: ObservedPattern[] = [];
    const existing = await this.store.getObservations(0, { includeIgnored: true });
    for (const row of existing) {
      if (row.ignored || row.origin === 'user-prompt') continue;
      const needle = row.pattern.replace(/^(repeated tool|cross-session tool|workflow|phrasing:)\s+/i, '').trim();
      if (needle.length < 4) continue;
      let hit = false;
      try {
        hit = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(userText);
      } catch {
        hit = userText.toLowerCase().includes(needle.toLowerCase());
      }
      if (!hit && tokens(needle).some((t) => userText.toLowerCase().includes(t))) hit = true;
      if (hit) {
        const next = await this.upsertPattern(row.pattern, userText, 1);
        if (next) created.push(next);
      }
    }
    return created;
  }

  private async mineAggregates(): Promise<ObservedPattern[]> {
    const created: ObservedPattern[] = [];
    const aggregates = await this.store.listToolExecutionAggregates(this.minFrequency);
    for (const row of aggregates) {
      if (IGNORED_TOOLS.has(row.toolName) || row.toolName.startsWith('si_')) continue;
      const pattern = await this.upsertPattern(
        `cross-session tool ${row.toolName}`,
        `tool_executions aggregate for ${row.toolName}`,
        row.frequency,
        row.lastAt,
      );
      if (pattern) created.push(pattern);
    }
    return created;
  }

  private async upsertPattern(
    patternText: string,
    context: string,
    frequency: number,
    lastAt = Date.now(),
  ): Promise<ObservedPattern | null> {
    const existing = (await this.store.getObservations(0, { includeIgnored: true }))
      .find((p) => p.pattern === patternText);
    if (existing?.ignored) return null;
    const active = (await this.store.getObservations(0)).filter((p) => !p.acknowledged);
    if (!existing && active.length >= this.maxActiveObservations) return null;

    const prior = await this.usagePrior(patternText);
    const rejectedCount = existing?.rejectedCount ?? 0;
    const confidence = scoreConfidence({
      frequency: (existing?.frequency ?? 0) + frequency,
      minFrequency: this.minFrequency,
      lastObservedAt: lastAt,
      pattern: patternText,
      observationWindowMs: this.observationWindowMs,
      priorBoost: prior,
      rejectedCount,
    });
    const pattern: ObservedPattern = {
      id: existing?.id ?? generateId('obs'),
      pattern: patternText,
      frequency,
      firstObservedAt: existing?.firstObservedAt ?? lastAt,
      lastObservedAt: lastAt,
      context: context.slice(0, 500),
      confidence,
      origin: 'autonomous',
      acknowledged: false,
      ignored: false,
      rejectedCount,
    };
    await this.store.insertObservation(pattern);
    return (await this.store.getObservations(0, { includeIgnored: true }))
      .find((p) => p.pattern === patternText) ?? pattern;
  }

  private async usagePrior(patternText: string): Promise<number> {
    try {
      const tools = await this.store.getMostUsedTools(8);
      if (!tools.length) return 1;
      const patternTokens = new Set(tokens(patternText));
      const hit = tools.some((t) => jaccard(patternTokens, tokens(`${t.name} ${t.description}`)) >= 0.25);
      return hit ? 1.15 : 1;
    } catch {
      return 1;
    }
  }

  private async rescoreAll(): Promise<void> {
    const rows = await this.store.getObservations(0, { includeIgnored: true });
    for (const row of rows) {
      if (row.origin === 'user-prompt') continue;
      if (row.ignored) continue;
      const prior = await this.usagePrior(row.pattern);
      const confidence = scoreConfidence({
        frequency: row.frequency,
        minFrequency: this.minFrequency,
        lastObservedAt: row.lastObservedAt,
        pattern: row.pattern,
        observationWindowMs: this.observationWindowMs,
        priorBoost: prior,
        rejectedCount: row.rejectedCount,
      });
      if (Math.abs(confidence - row.confidence) > 0.01) {
        await this.store.updateObservation(row.id, { confidence });
      }
    }
  }
}
