import { Router } from 'express';
import type { Response } from 'express';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';
import type { ApiContext } from '../services/ApiService.js';

export function router(ctx: ApiContext): Router {
  const r = Router();

  r.get('/api/metrics', (_req, res: Response) => {
    const metrics = ctx.api.getAgentMetrics();

    metricsRegistry.setGauge('agent_turns_total', {}, metrics.turnsTotal);
    metricsRegistry.setGauge('agent_tool_latency_seconds_avg', {}, metrics.toolLatencyAvg);
    metricsRegistry.setGauge('agent_tool_latency_seconds_p95', {}, metrics.toolLatencyP95);
    metricsRegistry.setGauge('agent_tool_latency_seconds_count', {}, metrics.toolLatencyCount);
    metricsRegistry.setGauge('agent_queue_depth', {}, metrics.queueDepth);
    metricsRegistry.setGauge('agent_memory_cache_hit_rate', {}, metrics.memoryCacheHitRate);

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(metricsRegistry.report());
  });

  return r;
}
