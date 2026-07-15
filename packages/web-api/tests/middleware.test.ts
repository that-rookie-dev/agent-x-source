import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    getLogger: () => loggerMock,
  };
});

import { errorHandler, createOperationalError } from '../src/middleware/error.js';

function makeRes(): Response & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
} {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name];
    },
  } as unknown as Response & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
  return res;
}

describe('error handler middleware', () => {
  beforeEach(() => {
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 for unhandled errors', () => {
    const err = new Error('boom');
    const req = { requestId: 'req-123' } as unknown as Request;
    const res = makeRes();
    errorHandler(err, req, res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ status: 'error', code: 500, message: 'Internal server error' });
  });

  it('includes the requestId in the response', () => {
    const err = new Error('boom');
    const req = { requestId: 'req-abc-456' } as unknown as Request;
    const res = makeRes();
    errorHandler(err, req, res, vi.fn() as NextFunction);
    expect(res.body).toMatchObject({ requestId: 'req-abc-456' });
  });

  it('logs the error', () => {
    const err = new Error('logged-failure');
    const req = { requestId: 'req-log-1' } as unknown as Request;
    const res = makeRes();
    errorHandler(err, req, res, vi.fn() as NextFunction);
    expect(loggerMock.error).toHaveBeenCalled();
    const [label, payload] = loggerMock.error.mock.calls[0];
    expect(label).toBe('API_ERROR');
    expect(payload).toMatchObject({ message: 'logged-failure', requestId: 'req-log-1' });
  });

  it('preserves statusCode for operational errors', () => {
    const err = createOperationalError('not found', 404);
    const req = { requestId: 'req-op-1' } as unknown as Request;
    const res = makeRes();
    errorHandler(err, req, res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ code: 404, message: 'not found' });
  });
});
