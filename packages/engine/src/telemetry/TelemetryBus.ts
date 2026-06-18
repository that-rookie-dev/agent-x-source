import type { TelemetryBus, TelemetryEvent, TelemetryConfig, MetricSample } from '@agentx/shared';

type EventHandler = (event: TelemetryEvent) => void;
type MetricHandler = (sample: MetricSample) => void;

interface InternalMetric {
  definition: { name: string; help: string; unit?: string };
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<string, number[]>;
}

export class DefaultTelemetryBus implements TelemetryBus {
  private metrics: Map<string, InternalMetric> = new Map();
  private eventHandlers: Set<EventHandler> = new Set();
  private metricHandlers: Set<MetricHandler> = new Set();
  private config: TelemetryConfig;
  private running = false;

  // Replay ring buffer — stores the last N telemetry events so SSE reconnections
  // don't lose critical events like message_received or loading_end.
  private replayBuffer: TelemetryEvent[] = [];
  private static readonly REPLAY_SIZE = 50;

  constructor(config?: Partial<TelemetryConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      metricsPrefix: config?.metricsPrefix ?? 'agentx',
      sampleRate: config?.sampleRate ?? 1.0,
    };
  }

  increment(name: string, value = 1, labels?: Record<string, string>): void {
    if (!this.shouldSample()) return;
    const key = this.labelKey(labels);
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { definition: { name, help: '' }, counters: new Map(), gauges: new Map(), histograms: new Map() };
      this.metrics.set(name, metric);
    }
    metric.counters.set(key, (metric.counters.get(key) || 0) + value);
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.shouldSample()) return;
    const key = this.labelKey(labels);
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { definition: { name, help: '' }, counters: new Map(), gauges: new Map(), histograms: new Map() };
      this.metrics.set(name, metric);
    }
    metric.gauges.set(key, value);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.shouldSample()) return;
    const key = this.labelKey(labels);
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { definition: { name, help: '' }, counters: new Map(), gauges: new Map(), histograms: new Map() };
      this.metrics.set(name, metric);
    }
    const arr = metric.histograms.get(key) || [];
    arr.push(value);
    if (arr.length > 1000) arr.shift();
    metric.histograms.set(key, arr);
  }

  emit(event: TelemetryEvent): void {
    if (!this.config.enabled) return;

    // Push into replay ring buffer (replace oldest when full)
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > DefaultTelemetryBus.REPLAY_SIZE) {
      this.replayBuffer.shift();
    }

    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* swallow */ }
    }
  }

  snapshot(): MetricSample[] {
    const samples: MetricSample[] = [];
    const prefix = this.config.metricsPrefix || 'agentx';
    for (const [, metric] of this.metrics) {
      for (const [key, value] of metric.counters) {
        const labels = this.parseLabelKey(key);
        if (labels && Object.keys(labels).length > 0) {
          samples.push({ name: `${prefix}_${metric.definition.name}_total`, value, labels, timestamp: Date.now() });
        } else {
          samples.push({ name: `${prefix}_${metric.definition.name}_total`, value, timestamp: Date.now() });
        }
      }
      for (const [key, value] of metric.gauges) {
        const labels = this.parseLabelKey(key);
        if (labels && Object.keys(labels).length > 0) {
          samples.push({ name: `${prefix}_${metric.definition.name}`, value, labels, timestamp: Date.now() });
        } else {
          samples.push({ name: `${prefix}_${metric.definition.name}`, value, timestamp: Date.now() });
        }
      }
      for (const [, values] of metric.histograms) {
        if (values.length === 0) continue;
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const count = sorted.length;
        const p50 = sorted[Math.floor(count * 0.5)] ?? 0;
        const p90 = sorted[Math.floor(count * 0.9)] ?? 0;
        const p99 = sorted[Math.floor(count * 0.99)] ?? 0;
        samples.push({ name: `${prefix}_${metric.definition.name}_count`, value: count, timestamp: Date.now() });
        samples.push({ name: `${prefix}_${metric.definition.name}_sum`, value: sum, timestamp: Date.now() });
        samples.push({ name: `${prefix}_${metric.definition.name}_p50`, value: p50, timestamp: Date.now() });
        samples.push({ name: `${prefix}_${metric.definition.name}_p90`, value: p90, timestamp: Date.now() });
        samples.push({ name: `${prefix}_${metric.definition.name}_p99`, value: p99, timestamp: Date.now() });
      }
    }
    return samples;
  }

  onEvent(handler: EventHandler): () => void {
    // Replay buffered events so reconnecting subscribers don't miss critical state
    for (const ev of this.replayBuffer) {
      try { handler(ev); } catch { /* swallow */ }
    }
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onMetric(handler: MetricHandler): () => void {
    this.metricHandlers.add(handler);
    return () => this.metricHandlers.delete(handler);
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.eventHandlers.clear();
    this.metricHandlers.clear();
  }

  private shouldSample(): boolean {
    if (!this.config.enabled || !this.running) return false;
    return Math.random() < (this.config.sampleRate ?? 1.0);
  }

  private labelKey(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
  }

  private parseLabelKey(key: string): Record<string, string> | null {
    if (!key) return null;
    const result: Record<string, string> = {};
    for (const part of key.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) result[part.slice(0, eq)] = part.slice(eq + 1);
    }
    return Object.keys(result).length > 0 ? result : null;
  }
}
