import type { Message } from '@agentx/shared';

interface TurnRecord {
  latencyMs: number;
  tokens: number;
  tokensPerSecond: number;
}

export class PerfTracker {
  private enabled = process.env['PERF_TRACKING'] !== '0';
  private starts = new Map<string, number>();
  private records: TurnRecord[] = [];
  private toolLatencies: number[] = [];

  turnStart(sessionId: string, timestamp = Date.now()): void {
    if (!this.enabled) return;
    this.starts.set(sessionId, timestamp);
  }

  turnEnd(sessionId: string, result: Message, timestamp = Date.now()): void {
    if (!this.enabled) return;
    const start = this.starts.get(sessionId);
    if (start === undefined) return;

    const latencyMs = timestamp - start;
    this.starts.delete(sessionId);
    const tokens = result.tokenCount ?? 0;
    const tokensPerSecond = latencyMs > 0 && tokens > 0 ? tokens / (latencyMs / 1000) : 0;

    this.records.push({ latencyMs, tokens, tokensPerSecond });
  }

  recordTurnLatency(latencyMs: number, tokens: number): void {
    if (!this.enabled) return;
    const tokensPerSecond = latencyMs > 0 && tokens > 0 ? tokens / (latencyMs / 1000) : 0;
    this.records.push({ latencyMs, tokens, tokensPerSecond });
  }

  getStats(): {
    totalTurns: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    avgTokensPerSecond: number;
  } {
    const latencies = this.records.map((r) => r.latencyMs);
    const total = latencies.length;
    const avgLatencyMs = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;
    const maxLatencyMs = total > 0 ? Math.max(...latencies) : 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95LatencyMs = total > 0 ? sorted[Math.floor((total - 1) * 0.95)]! : 0;
    const avgTokensPerSecond = total > 0
      ? this.records.reduce((a, r) => a + r.tokensPerSecond, 0) / total
      : 0;

    return {
      totalTurns: total,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: Math.round(p95LatencyMs),
      maxLatencyMs: Math.round(maxLatencyMs),
      avgTokensPerSecond: Math.round(avgTokensPerSecond * 100) / 100,
    };
  }

  recordToolLatency(latencyMs: number): void {
    if (!this.enabled) return;
    this.toolLatencies.push(latencyMs);
  }

  getToolLatencyStats(): {
    totalTools: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
  } {
    const latencies = this.toolLatencies;
    const total = latencies.length;
    const avgLatencyMs = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;
    const maxLatencyMs = total > 0 ? Math.max(...latencies) : 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95LatencyMs = total > 0 ? sorted[Math.floor((total - 1) * 0.95)]! : 0;
    return {
      totalTools: total,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: Math.round(p95LatencyMs),
      maxLatencyMs: Math.round(maxLatencyMs),
    };
  }

  reset(): void {
    this.starts.clear();
    this.records = [];
    this.toolLatencies = [];
  }
}

let perfTracker: PerfTracker | undefined;

export function getPerfTracker(): PerfTracker {
  if (!perfTracker) perfTracker = new PerfTracker();
  return perfTracker;
}
