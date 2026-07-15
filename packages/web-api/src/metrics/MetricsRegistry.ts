/**
 * Simple in-memory metrics registry.
 *
 * Prometheus is not used; this exposes a Prometheus-compatible text/plain
 * exposition endpoint with counters, histograms, and gauges.
 */
type Labels = Record<string, string | number>;

interface MetricValue {
  name: string;
  value: number;
  labels: Labels;
}

interface HistogramValue {
  name: string;
  buckets: number[];
  bucketLabels: string[];
  sum: number;
  count: number;
  labels: Labels;
}

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10];

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${v}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}

function getBucketLabel(upper: number): string {
  return upper === Infinity ? '+Inf' : String(upper);
}

function keyFor(name: string, labels: Labels): string {
  const keys = Object.keys(labels).sort();
  const labelStr = keys.map((k) => `${k}=${labels[k]}`).join(',');
  return `${name}:${labelStr}`;
}

class MetricsRegistry {
  private counters = new Map<string, MetricValue>();
  private histograms = new Map<string, HistogramValue>();
  private gauges = new Map<string, MetricValue>();
  private eventLoopLag = 0;

  constructor() {
    this.measureEventLoopLag();
  }

  private measureEventLoopLag(): void {
    const start = performance.now();
    setImmediate(() => {
      this.eventLoopLag = Math.max(0, performance.now() - start) / 1000;
      // Keep measuring every ~5s after the first call.
      setTimeout(() => this.measureEventLoopLag(), 5000);
    });
  }

  incrementCounter(name: string, labels: Labels, value = 1): void {
    const key = keyFor(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { name, value, labels });
    }
  }

  recordHistogram(name: string, labels: Labels, valueSeconds: number): void {
    const key = keyFor(name, labels);
    let existing = this.histograms.get(key);
    if (!existing) {
      existing = {
        name,
        buckets: HISTOGRAM_BUCKETS.map(() => 0),
        bucketLabels: HISTOGRAM_BUCKETS.map(getBucketLabel),
        sum: 0,
        count: 0,
        labels,
      };
      this.histograms.set(key, existing);
    }

    const hist = existing;
    hist.count += 1;
    hist.sum += valueSeconds;
    HISTOGRAM_BUCKETS.forEach((bucket, i) => {
      if (valueSeconds <= bucket) {
        hist.buckets[i] = (hist.buckets[i] ?? 0) + 1;
      }
    });
  }

  setGauge(name: string, labels: Labels, value: number): void {
    const key = keyFor(name, labels);
    this.gauges.set(key, { name, value, labels });
  }

  private renderProcessMetrics(): string[] {
    const mem = process.memoryUsage();
    return [
      '# HELP nodejs_heap_size_total_bytes Total heap size in bytes.',
      '# TYPE nodejs_heap_size_total_bytes gauge',
      `nodejs_heap_size_total_bytes ${mem.heapTotal}`,
      '# HELP nodejs_heap_size_used_bytes Used heap size in bytes.',
      '# TYPE nodejs_heap_size_used_bytes gauge',
      `nodejs_heap_size_used_bytes ${mem.heapUsed}`,
      '# HELP nodejs_external_memory_bytes External memory usage in bytes.',
      '# TYPE nodejs_external_memory_bytes gauge',
      `nodejs_external_memory_bytes ${mem.external}`,
      '# HELP nodejs_event_loop_lag_seconds Event loop lag in seconds.',
      '# TYPE nodejs_event_loop_lag_seconds gauge',
      `nodejs_event_loop_lag_seconds ${this.eventLoopLag.toFixed(6)}`,
    ];
  }

  private renderMetricsByName(values: Iterable<MetricValue>, type: 'counter' | 'gauge'): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const { name, value, labels } of values) {
      if (!seen.has(name)) {
        lines.push(`# HELP ${name} ${name}`);
        lines.push(`# TYPE ${name} ${type}`);
        seen.add(name);
      }
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
    return lines;
  }

  private renderHistograms(): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const h of this.histograms.values()) {
      if (!seen.has(h.name)) {
        lines.push(`# HELP ${h.name} ${h.name}`);
        lines.push(`# TYPE ${h.name} histogram`);
        seen.add(h.name);
      }
      h.buckets.forEach((count, i) => {
        lines.push(
          `http_request_duration_seconds_bucket${formatLabels({ ...h.labels, le: h.bucketLabels[i] ?? 'unknown' })} ${count}`,
        );
      });
      lines.push(`http_request_duration_seconds_sum${formatLabels(h.labels)} ${h.sum.toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count${formatLabels(h.labels)} ${h.count}`);
    }
    return lines;
  }

  report(): string {
    const lines: string[] = [];

    lines.push(...this.renderProcessMetrics());

    if (this.counters.size > 0) {
      lines.push(...this.renderMetricsByName(this.counters.values(), 'counter'));
    }

    if (this.histograms.size > 0) {
      lines.push(...this.renderHistograms());
    }

    if (this.gauges.size > 0) {
      lines.push(...this.renderMetricsByName(this.gauges.values(), 'gauge'));
    }

    return lines.join('\n') + '\n';
  }
}

export const metricsRegistry = new MetricsRegistry();
