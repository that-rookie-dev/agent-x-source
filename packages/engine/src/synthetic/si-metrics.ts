type Kind = 'generation' | 'sandbox' | 'approval' | 'observation' | 'error' | 'queue';

interface Sample {
  kind: Kind;
  ok: boolean;
  at: number;
}

const samples: Sample[] = [];
const MAX = 2_000;

export const siMetrics = {
  increment(kind: Kind, ok = true): void {
    samples.push({ kind, ok, at: Date.now() });
    if (samples.length > MAX) samples.splice(0, samples.length - MAX);
  },

  snapshot(now = Date.now()): {
    generationsTotal: number;
    generationSuccessRate: number;
    sandboxRunsTotal: number;
    sandboxPassRate: number;
    approvalsTotal: number;
    observationsTotal: number;
    errorsTotal: number;
    queuePressure: number;
  } {
    const hour = samples.filter((s) => now - s.at <= 3_600_000);
    const gens = hour.filter((s) => s.kind === 'generation');
    const sand = hour.filter((s) => s.kind === 'sandbox');
    return {
      generationsTotal: gens.length,
      generationSuccessRate: gens.length ? gens.filter((s) => s.ok).length / gens.length : 1,
      sandboxRunsTotal: sand.length,
      sandboxPassRate: sand.length ? sand.filter((s) => s.ok).length / sand.length : 1,
      approvalsTotal: hour.filter((s) => s.kind === 'approval').length,
      observationsTotal: hour.filter((s) => s.kind === 'observation').length,
      errorsTotal: hour.filter((s) => s.kind === 'error').length,
      queuePressure: hour.filter((s) => s.kind === 'queue').length,
    };
  },

  alerts(now = Date.now()): string[] {
    const out: string[] = [];
    const five = samples.filter((s) => now - s.at <= 5 * 60_000);
    const hour = samples.filter((s) => now - s.at <= 3_600_000);
    const sand = five.filter((s) => s.kind === 'sandbox');
    if (sand.length >= 4 && sand.filter((s) => !s.ok).length / sand.length > 0.5) {
      out.push('Sandbox failure rate > 50% in 5 min window');
    }
    const gens = hour.filter((s) => s.kind === 'generation');
    if (gens.length >= 5 && gens.filter((s) => s.ok).length / gens.length < 0.3) {
      out.push('Generation success rate < 30% in 1 hour');
    }
    const errs = hour.filter((s) => s.kind === 'error');
    if (errs.length >= 8) out.push('Store write errors increasing');
    if (five.filter((s) => s.kind === 'queue').length >= 6) {
      out.push('Concurrent sandbox limit consistently reached');
    }
    return out;
  },

  reset(): void {
    samples.length = 0;
  },
};
