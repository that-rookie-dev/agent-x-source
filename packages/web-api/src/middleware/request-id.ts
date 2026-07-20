import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Generate or inherit a request ID and expose it on req/res.
 * - Uses the existing X-Request-Id header if present.
 * - Falls back to a short UUID.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined) ||
    crypto.randomUUID().slice(0, 8);

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
