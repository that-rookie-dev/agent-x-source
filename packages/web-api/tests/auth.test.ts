import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';

const { isAuthenticated, validateSession, hasRootUser, getAuthState, login, createRootUser, logout, changePassword } = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  validateSession: vi.fn(),
  hasRootUser: vi.fn(),
  getAuthState: vi.fn(),
  login: vi.fn(),
  createRootUser: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    authManager: {
      ...actual.authManager,
      hasRootUser,
      isAuthenticated,
      validateSession,
      getAuthState,
      login,
      createRootUser,
      logout,
      changePassword,
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

vi.mock('../src/ingestion-worker-ref.js', () => ({
  refreshIngestionWorkerGenerator: vi.fn(),
}));

import {
  extractSessionTokenFromCookie,
  authMiddleware,
  syncDEKMiddleware,
  validateWebSocketConnection,
  validateVoiceWebSocketConnection,
  createAuthRouter,
} from '../src/auth.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(payload: unknown) { body = payload; return this; },
    setHeader(name: string, value: string) { headers[name] = value; return this; },
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
  (res as any).__statusCode = () => statusCode;
  (res as any).__body = () => body;
  (res as any).__headers = () => headers;
  return res;
}

describe('extractSessionTokenFromCookie', () => {
  it('extracts token from cookie header', () => {
    expect(extractSessionTokenFromCookie('agentx_session=abc123; other=value')).toBe('abc123');
  });

  it('decodes URI-encoded tokens', () => {
    expect(extractSessionTokenFromCookie('agentx_session=hello%20world')).toBe('hello world');
  });

  it('returns undefined when no cookie header', () => {
    expect(extractSessionTokenFromCookie(undefined)).toBeUndefined();
  });

  it('returns undefined when agentx_session not present', () => {
    expect(extractSessionTokenFromCookie('other=value')).toBeUndefined();
  });

  it('returns undefined for empty cookie header', () => {
    expect(extractSessionTokenFromCookie('')).toBeUndefined();
  });
});

describe('authMiddleware', () => {
  beforeEach(() => {
    isAuthenticated.mockReset();
    isAuthenticated.mockReturnValue(false);
    hasRootUser.mockReset();
    hasRootUser.mockReturnValue(true);
    validateSession.mockReset();
    validateSession.mockReturnValue(null);
  });

  it('allows public paths without auth', () => {
    const req = makeReq({ path: '/api/health' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows /api/auth/setup without auth', () => {
    const req = makeReq({ path: '/api/auth/setup' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows non-api paths without auth', () => {
    const req = makeReq({ path: '/index.html' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects api paths without token', () => {
    const req = makeReq({ path: '/api/sessions' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    authMiddleware(req, res, next);
    expect((res as any).__statusCode()).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects api paths with invalid token', () => {
    const req = makeReq({ path: '/api/sessions', headers: { cookie: 'agentx_session=invalid' } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    isAuthenticated.mockReturnValue(false);
    authMiddleware(req, res, next);
    expect((res as any).__statusCode()).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows api paths with valid token', () => {
    const req = makeReq({ path: '/api/sessions', headers: { cookie: 'agentx_session=valid' } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    isAuthenticated.mockReturnValue(true);
    validateSession.mockReturnValue({ dek: Buffer.alloc(32) });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows api paths with Bearer token', () => {
    const req = makeReq({ path: '/api/sessions', headers: { authorization: 'Bearer valid-token' } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    isAuthenticated.mockReturnValue(true);
    validateSession.mockReturnValue({ dek: Buffer.alloc(32) });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows SSE paths with token query param', () => {
    const req = makeReq({
      path: '/api/chat/stream',
      headers: {},
      query: { token: 'query-token' },
    } as any);
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    isAuthenticated.mockReturnValue(true);
    validateSession.mockReturnValue({ dek: Buffer.alloc(32) });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('syncDEKMiddleware', () => {
  beforeEach(() => {
    validateSession.mockReset();
  });

  it('calls next when no token present', () => {
    const req = makeReq({ path: '/api/sessions' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    syncDEKMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets session on req when token is valid', () => {
    const session = { dek: Buffer.alloc(32), username: 'admin' };
    validateSession.mockReturnValue(session);
    const req = makeReq({ path: '/api/sessions', headers: { cookie: 'agentx_session=valid' } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;
    syncDEKMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).agentxSession).toEqual(session);
  });
});

describe('validateWebSocketConnection', () => {
  beforeEach(() => {
    hasRootUser.mockReset();
    isAuthenticated.mockReset();
  });

  it('allows loopback when no root user exists', () => {
    hasRootUser.mockReturnValue(false);
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as IncomingMessage;
    expect(validateWebSocketConnection(req)).toBe(true);
  });

  it('rejects non-loopback when no root user exists', () => {
    hasRootUser.mockReturnValue(false);
    const req = { socket: { remoteAddress: '192.168.1.1' }, headers: {} } as unknown as IncomingMessage;
    expect(validateWebSocketConnection(req)).toBe(false);
  });

  it('rejects when root user exists but no cookie', () => {
    hasRootUser.mockReturnValue(true);
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as IncomingMessage;
    expect(validateWebSocketConnection(req)).toBe(false);
  });

  it('allows when root user exists and valid cookie', () => {
    hasRootUser.mockReturnValue(true);
    isAuthenticated.mockReturnValue(true);
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { cookie: 'agentx_session=valid' },
    } as unknown as IncomingMessage;
    expect(validateWebSocketConnection(req)).toBe(true);
  });
});

describe('validateVoiceWebSocketConnection', () => {
  beforeEach(() => {
    hasRootUser.mockReset();
    isAuthenticated.mockReset();
  });

  it('allows loopback when no root user exists', () => {
    hasRootUser.mockReturnValue(false);
    const req = { socket: { remoteAddress: '::1' }, headers: {}, url: '/' } as unknown as IncomingMessage;
    expect(validateVoiceWebSocketConnection(req)).toBe(true);
  });

  it('allows with valid Bearer token', () => {
    hasRootUser.mockReturnValue(true);
    isAuthenticated.mockReturnValue(true);
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { authorization: 'Bearer valid' },
      url: '/',
    } as unknown as IncomingMessage;
    expect(validateVoiceWebSocketConnection(req)).toBe(true);
  });

  it('allows with valid query token', () => {
    hasRootUser.mockReturnValue(true);
    isAuthenticated.mockReturnValue(true);
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      url: '/?token=valid',
    } as unknown as IncomingMessage;
    expect(validateVoiceWebSocketConnection(req)).toBe(true);
  });

  it('rejects when no auth provided', () => {
    hasRootUser.mockReturnValue(true);
    isAuthenticated.mockReturnValue(false);
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
      url: '/',
    } as unknown as IncomingMessage;
    expect(validateVoiceWebSocketConnection(req)).toBe(false);
  });
});

describe('createAuthRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasRootUser.mockReturnValue(false);
  });

  it('returns an Express router', () => {
    const router = createAuthRouter();
    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
  });
});
