import type { Request, Response, NextFunction } from 'express';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';

/**
 * Record HTTP request metrics for each request.
 * Increments http_requests_total and observes http_request_duration_seconds.
 */
export function requestMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  const observe = () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const method = req.method;
    const status = res.statusCode;

    metricsRegistry.incrementCounter('http_requests_total', { method, status }, 1);
    metricsRegistry.recordHistogram('http_request_duration_seconds', { method, status }, durationSec);
  };

  res.on('finish', observe);
  next();
}
