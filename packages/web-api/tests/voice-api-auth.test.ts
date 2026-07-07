import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { isAuthenticated } = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
}));

vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    authManager: {
      ...actual.authManager,
      hasRootUser: () => true,
      isAuthenticated,
      validateSession: vi.fn(),
    },
    getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(() => ({
    configManager: { load: () => ({}) },
  })),
  setEngineDEK: vi.fn(),
}));

import { authMiddleware } from '../src/auth.js';

function runAuth(path: string, headers: Record<string, string> = {}) {
  const req = { path, headers, cookies: {} } as unknown as Request;
  let statusCode = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  authMiddleware(req, res, next);
  return { statusCode, body, next };
}

describe('voice API authentication', () => {
  beforeEach(() => {
    isAuthenticated.mockReset();
    isAuthenticated.mockReturnValue(false);
  });

  it('rejects unauthenticated GET /api/voice/capabilities', () => {
    const { statusCode, body, next } = runAuth('/api/voice/capabilities');
    expect(statusCode).toBe(401);
    expect(body).toMatchObject({ error: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated POST /api/voice/preview', () => {
    const { statusCode, body } = runAuth('/api/voice/preview');
    expect(statusCode).toBe(401);
    expect(body).toMatchObject({ error: 'unauthorized' });
  });

  it('rejects unauthenticated GET /api/voice/assets', () => {
    const { statusCode } = runAuth('/api/voice/assets');
    expect(statusCode).toBe(401);
  });

  it('allows authenticated voice capabilities request', () => {
    isAuthenticated.mockReturnValue(true);
    const { statusCode, next } = runAuth('/api/voice/capabilities', { cookie: 'agentx_session=valid' });
    expect(statusCode).toBe(0);
    expect(next).toHaveBeenCalled();
  });
});
