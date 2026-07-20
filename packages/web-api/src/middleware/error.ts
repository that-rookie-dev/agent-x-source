import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '@agentx/shared';

export interface OperationalError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function isOperationalError(err: unknown): err is OperationalError {
  return (
    err instanceof Error &&
    (err as OperationalError).isOperational === true
  );
}

export function createOperationalError(
  message: string,
  statusCode = 500,
): OperationalError {
  const err = new Error(message) as OperationalError;
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

/**
 * Centralized Express error handler.
 * Returns clean JSON. Never leaks stack traces in production unless
 * AGENTX_DEBUG_ERRORS is set.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const logger = getLogger();
  const statusCode =
    (err as OperationalError).statusCode ??
    (res.statusCode && res.statusCode >= 400 ? res.statusCode : 500);

  const requestId = req.requestId;

  logger.error('API_ERROR', {
    message: err.message,
    stack: err.stack,
    statusCode,
    requestId,
  });

  const isDev = process.env['NODE_ENV'] !== 'production';
  const exposeDebug = process.env['AGENTX_DEBUG_ERRORS'] === 'true' || isDev;

  res.status(statusCode).json({
    status: 'error',
    code: statusCode,
    message: isOperationalError(err) ? err.message : 'Internal server error',
    requestId,
    ...(exposeDebug && err.stack ? { stack: err.stack } : {}),
  });
}
