import type { Express, Request, Response } from 'express';
import type { CapabilitySsePayload } from '@agentx/shared';
import { getRuntimeCapabilityManager, siMetrics } from '@agentx/engine';
import { broadcast } from './ws.js';
import { metricsRegistry } from './metrics/MetricsRegistry.js';

const clients = new Set<Response>();

export function emitCapabilitySse(payload: CapabilitySsePayload): void {
  const chunk = `event: ${payload.event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(chunk); } catch { /* disconnected */ }
  }
  broadcast({ type: 'capability_event', ...payload });
}

export function attachCapabilityEventBridge(): void {
  const mgr = getRuntimeCapabilityManager();
  if (!mgr) return;
  mgr.removeAllListeners('capability-event');
  mgr.on('capability-event', (payload: CapabilitySsePayload) => {
    emitCapabilitySse(payload);
    try {
      metricsRegistry.incrementCounter('si_events_total', { event: payload.event });
      const snap = siMetrics.snapshot();
      metricsRegistry.setGauge('si_generations_total', {}, snap.generationsTotal);
      metricsRegistry.setGauge('si_sandbox_runs_total', {}, snap.sandboxRunsTotal);
      metricsRegistry.setGauge('si_observations_total', {}, snap.observationsTotal);
      metricsRegistry.setGauge('si_errors_total', {}, snap.errorsTotal);
    } catch { /* metrics optional */ }
  });
}

export function registerCapabilityEventRoutes(app: Express): void {
  app.get('/api/events/capabilities', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });
}
