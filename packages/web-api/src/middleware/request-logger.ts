import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '@agentx/shared';

/**
 * Log every request as a structured JSON line with request ID, method, path,
 * status code, duration, and user agent.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();

  const logRequest = () => {
    const durationMs = Math.round(performance.now() - start);
    const requestId = req.requestId ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? undefined;

    getLogger().info(
      'request',
      `${req.method} ${req.path}`,
      {
        service: 'web-api',
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        userAgent,
      },
    );
  };

  res.on('finish', logRequest);
  next();
}
