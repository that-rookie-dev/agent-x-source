export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = a instanceof Set ? a : new Set(a);
  const right = b instanceof Set ? b : new Set(b);
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  return inter / (left.size + right.size - inter);
}

export function specificityFactor(pattern: string): number {
  const unique = new Set(tokens(pattern));
  if (unique.size <= 1) return 0.35;
  return Math.min(1, unique.size / 6);
}

export function recencyFactor(lastObservedAt: number, observationWindowMs: number, now = Date.now()): number {
  const elapsed = Math.max(0, now - lastObservedAt);
  return Math.exp(-elapsed / Math.max(1, observationWindowMs));
}

export function scoreConfidence(input: {
  frequency: number;
  minFrequency: number;
  lastObservedAt: number;
  pattern: string;
  observationWindowMs: number;
  priorBoost?: number;
  rejectedCount?: number;
  now?: number;
}): number {
  const base = input.frequency / Math.max(1, input.minFrequency);
  const recency = recencyFactor(input.lastObservedAt, input.observationWindowMs, input.now);
  const specificity = specificityFactor(input.pattern);
  const prior = input.priorBoost ?? 1;
  const rejected = input.rejectedCount ?? 0;
  const rejectionPenalty = rejected >= 3 ? 0.1 : rejected >= 2 ? 0.25 : rejected >= 1 ? 0.5 : 1;
  return Math.min(1, Math.max(0, base * recency * specificity * prior * rejectionPenalty));
}

export function ngramSet(text: string, n = 3): Set<string> {
  const t = tokens(text);
  const out = new Set<string>();
  if (t.length < n) {
    for (const token of t) out.add(token);
    return out;
  }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n).join(' '));
  return out;
}
