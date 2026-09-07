/**
 * Web-API Authentication Middleware & Routes
 *
 * Provides:
 * - Express middleware for session validation
 * - Auth endpoints (setup, login, logout, status)
 * - Secure cookie configuration
 *
 * All auth operations are wrapped in APP-domain observability spans
 * (trace.domain='APP', trace.kind='auth_operation') and emit
 * `auth_operations_total{operation,provider,success}` counters via the
 * metrics registry. No credentials, tokens, passwords, or PII are recorded
 * on spans — only structural metadata (operation, provider, success,
 * failure reason, duration).
 */

import type { Request, Response, NextFunction, Router } from 'express';
import type { IncomingMessage } from 'node:http';
import express from 'express';
import { authManager, getLogger } from '@agentx/shared';
import type { AuthSession } from '@agentx/shared';
import { setEngineDEK, getEngine } from './engine.js';
import { startAppSpan } from '@agentx/engine';
import { metricsRegistry } from './metrics/MetricsRegistry.js';
import { clearDevFlagsForToken } from './middleware/dev-mode.js';

/** Provider webhook/media paths — signature-authenticated, not cookie/session. */
export function isTelephonyWebhookPath(pathname: string): boolean {
  // /api/telephony/:providerId/(inbound|status|recording|health|media)
  // Exclude /api/telephony/providers/*
  return /^\/api\/telephony\/(?!providers(?:\/|$))[^/]+\/(inbound|status|recording|health|media)\/?$/.test(
    pathname,
  );
}

/**
 * Handle returned by {@link startAuthSpan}. Extends the base app-span handle
 * with the monotonic start timestamp and operation/provider labels so
 * {@link endAuthSpan} can compute duration and emit the correct counter labels.
 */
type AuthSpanHandle = ReturnType<typeof startAppSpan> & {
  start: bigint;
  operation: string;
  provider: string;
};

/**
 * Start an APP-domain span for an auth operation.
 *
 * Always sets `auth.operation` and `auth.provider`; `trace.domain='APP'`
 * and `trace.kind='auth'` are set by `startAppSpan`. Additional
 * structural attributes (e.g. `auth.method`) may be passed via `attrs`.
 */
function startAuthSpan(
  operation: string,
  provider = 'local',
  attrs?: Record<string, string | number | boolean>,
): AuthSpanHandle {
  const start = process.hrtime.bigint();
  const handle = startAppSpan(`auth.${operation}`, 'auth', 'auth', {
    'auth.operation': operation,
    'auth.provider': provider,
    ...(attrs ?? {}),
  });
  return { ...handle, start, operation, provider };
}

/**
 * End an auth span: record `auth.success` and `auth.duration_ms`, optionally
 * record an error (sets span status to ERROR, records the exception, and sets
 * `auth.failure_reason`), end the span, and increment the
 * `auth_operations_total{operation,provider,success}` counter.
 */
function endAuthSpan(handle: AuthSpanHandle, success: boolean, error?: string): void {
  const durationMs = Math.round(Number(process.hrtime.bigint() - handle.start) / 1e6);
  handle.span.setAttribute('auth.success', success);
  handle.span.setAttribute('auth.duration_ms', durationMs);
  if (!success && error) {
    handle.span.setAttribute('auth.failure_reason', error);
    handle.span.recordError(error);
  }
  handle.span.end();
  metricsRegistry.incrementCounter('auth_operations_total', {
    operation: handle.operation,
    provider: handle.provider,
    success: String(success),
  });
}

function useSecureCookies(req?: Request): boolean {
  if (process.env['AGENTX_SECURE_COOKIES'] === 'true') return true;
  if (process.env['AGENTX_SECURE_COOKIES'] === 'false') return false;
  return req?.secure === true;
}

const SSE_TOKEN_PATHS = new Set([
  '/api/chat/stream',
  '/api/logs/stream',
  '/api/neural-cortex/graph/events',
  '/api/events/capabilities',
]);

/**
 * Extract session token from cookie or Authorization header.
 */
export function extractSessionTokenFromCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/agentx_session=([^;]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return undefined;
}

function getToken(req: Request): string | undefined {
  const fromCookie = extractSessionTokenFromCookie(req.headers.cookie);
  if (fromCookie) return fromCookie;

  // Check Authorization header
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  if (SSE_TOKEN_PATHS.has(req.path)) {
    const tokenParam = req.query.token as string | undefined;
    if (tokenParam) return tokenParam;
  }

  return undefined;
}

/**
 * Middleware to sync engine DEK from valid session.
 * This ensures the engine can read/write encrypted config.
 */
export function syncDEKMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = getToken(req);
  if (token) {
    const session = authManager.validateSession(token);
    if (session) {
      // Ensure engine state exists before setting DEK on it
      // (getEngine() is lazily created by route handlers — middleware runs first).
      // In keyring-less/headless environments this can fail; don't break auth.
      try {
        getEngine();
        setEngineDEK(session.dek);
      } catch (e) {
        getLogger().warn('AUTH', 'Failed to initialize engine DEK; encrypted data may be unavailable', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      req.agentxSession = session;
    }
  }
  next();
}

/**
 * Express middleware to protect routes.
 * Skips auth for health checks and auth endpoints themselves.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Public paths that don't require authentication (and shouldn't create auth noise)
  const publicPaths = [
    '/api/health',
    '/api/auth/setup',
    '/api/auth/login',
    '/api/auth/status',
    '/api/auth/check',
    // OAuth providers redirect the user's browser here without an Agent-X
    // session (popup opened with noopener; cookies may be absent). Security
    // comes from the single-use, unguessable PKCE `state` parameter.
    '/api/integrations/oauth/callback',
  ];

  // Static files and SPA fallback
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  if (publicPaths.includes(req.path)) {
    next();
    return;
  }

  // Telephony provider webhooks/media — authenticated by signature middleware, not session.
  // Management under /api/telephony/providers remains session-protected.
  if (isTelephonyWebhookPath(req.path)) {
    next();
    return;
  }

  const handle = startAuthSpan('middleware');
  const { span } = handle;

  const token = getToken(req);
  const tokenValid = !!token && authManager.isAuthenticated(token);
  span.setAttribute('auth.token_valid', tokenValid);

  if (!tokenValid) {
    endAuthSpan(handle, false, 'unauthorized');
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }

  // Sync DEK and attach session info
  syncDEKMiddleware(req, res, () => {});
  if (res.locals.httpSpan && req.agentxSession?.token) {
    res.locals.httpSpan.setAttribute('session.id', req.agentxSession.token);
  }
  endAuthSpan(handle, true);
  next();
}

/**
 * Create auth router with all auth endpoints.
 */
export function createAuthRouter(): Router {
  const router = express.Router();

  /**
   * GET /api/auth/check
   * Check if auth is required (has root user been created?)
   */
  router.get('/auth/check', (_req, res) => {
    const handle = startAuthSpan('check');
    try {
      const hasRootUser = authManager.hasRootUser();
      handle.span.setAttribute('auth.has_root_user', hasRootUser);
      endAuthSpan(handle, true);
      res.json({ hasRootUser });
    } catch (e: unknown) {
      endAuthSpan(handle, false, e instanceof Error ? e.message : 'check-failed');
      res.status(500).json({ error: 'check-failed', message: 'Failed to check auth state' });
    }
  });

  /**
   * GET /api/auth/status
   * Get current authentication state.
   */
  router.get('/auth/status', (req, res) => {
    const handle = startAuthSpan('status');
    try {
      const token = getToken(req);
      const state = authManager.getAuthState(token);
      handle.span.setAttribute('auth.authenticated', state.isAuthenticated);
      endAuthSpan(handle, true);
      // Expose session token for WebSocket auth (Electron may not attach cookies to WS upgrades).
      res.json({
        ...state,
        sessionToken: state.isAuthenticated && token ? token : undefined,
      });
    } catch (e: unknown) {
      endAuthSpan(handle, false, e instanceof Error ? e.message : 'status-failed');
      res.status(500).json({ error: 'status-failed', message: 'Failed to get auth state' });
    }
  });

  /**
   * POST /api/auth/setup
   * Create the root user (one-time setup).
   */
  router.post('/auth/setup', async (req, res) => {
    const handle = startAuthSpan('setup', 'local', { 'auth.method': 'password' });
    const { withContext } = handle;

    await withContext(async () => {
      try {
        if (authManager.hasRootUser()) {
          endAuthSpan(handle, false, 'already-configured');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(409).json({ error: 'already-configured', message: 'Root user already exists' });
          return;
        }

        const { username, password } = req.body as { username?: string; password?: string };

        if (!username || typeof username !== 'string' || username.length < 3) {
          endAuthSpan(handle, false, 'invalid-credentials');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({ error: 'invalid-username', message: 'Username must be at least 3 characters' });
          return;
        }

        if (!password || typeof password !== 'string' || password.length < 8) {
          endAuthSpan(handle, false, 'invalid-credentials');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({ error: 'invalid-password', message: 'Password must be at least 8 characters' });
          return;
        }

        // Enforce password complexity
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

        if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
          endAuthSpan(handle, false, 'weak-password');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({
            error: 'weak-password',
            message: 'Password must contain uppercase, lowercase, number, and special character',
          });
          return;
        }

        await authManager.createRootUser(username, password);

        // Auto-login after setup
        const token = await authManager.login(username, password);

        // Set engine DEK for encrypted config access
        const session = authManager.validateSession(token);
        if (session) {
          setEngineDEK(session.dek);
        }

        // Set secure session cookie
        res.cookie('agentx_session', token, {
          httpOnly: true,
          secure: useSecureCookies(req),
          sameSite: 'lax', // lax needed for same-origin page navigations
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          path: '/',
        });

        endAuthSpan(handle, true);
        res.json({ ok: true, username, token });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Setup failed';
        endAuthSpan(handle, false, 'setup-failed');
        metricsRegistry.incrementCounter('auth_failures_total', {});
        res.status(500).json({ error: 'setup-failed', message });
      }
    });
  });

  /**
   * POST /api/auth/login
   * Authenticate and create a session.
   */
  router.post('/auth/login', async (req, res) => {
    const handle = startAuthSpan('login', 'local', { 'auth.method': 'password' });
    const { withContext } = handle;

    await withContext(async () => {
      try {
        const { username, password } = req.body as { username?: string; password?: string };

        if (!username || !password) {
          endAuthSpan(handle, false, 'invalid-credentials');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({ error: 'missing-credentials', message: 'Username and password required' });
          return;
        }

        const token = await authManager.login(username, password);

        // Set engine DEK for encrypted config access
        const session = authManager.validateSession(token);
        if (session) {
          setEngineDEK(session.dek);
        }

        // Set secure session cookie
        res.cookie('agentx_session', token, {
          httpOnly: true,
          secure: useSecureCookies(req),
          sameSite: 'lax', // lax needed for same-origin page navigations
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
          path: '/',
        });

        endAuthSpan(handle, true);
        res.json({ ok: true, username, token });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Authentication failed';
        endAuthSpan(handle, false, 'invalid-credentials');
        metricsRegistry.incrementCounter('auth_failures_total', {});
        res.status(401).json({ error: 'invalid-credentials', message });
      }
    });
  });

  /**
   * POST /api/auth/logout
   * Destroy the current session.
   */
  router.post('/auth/logout', (req, res) => {
    const handle = startAuthSpan('logout');
    try {
      const token = getToken(req);
      if (token) {
        authManager.logout(token);
        // Clear developer-mode + dev-verified flags for this token (§10.2).
        clearDevFlagsForToken(token);
        handle.span.setAttribute('auth.had_session', true);
      } else {
        handle.span.setAttribute('auth.had_session', false);
      }
      res.clearCookie('agentx_session', { path: '/' });
      endAuthSpan(handle, true);
      res.json({ ok: true });
    } catch (e: unknown) {
      endAuthSpan(handle, false, e instanceof Error ? e.message : 'logout-failed');
      res.status(500).json({ error: 'logout-failed', message: 'Logout failed' });
    }
  });

  /**
   * POST /api/auth/change-password
   * Change the root user's password.
   */
  router.post('/auth/change-password', async (req, res) => {
    const handle = startAuthSpan('change_password', 'local', { 'auth.method': 'password' });
    const { withContext } = handle;

    await withContext(async () => {
      const token = getToken(req);
      if (!token || !authManager.isAuthenticated(token)) {
        endAuthSpan(handle, false, 'unauthorized');
        metricsRegistry.incrementCounter('auth_failures_total', {});
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      try {
        const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

        if (!currentPassword || !newPassword) {
          endAuthSpan(handle, false, 'invalid-credentials');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({ error: 'missing-passwords', message: 'Current and new password required' });
          return;
        }

        if (newPassword.length < 8) {
          endAuthSpan(handle, false, 'invalid-credentials');
          metricsRegistry.incrementCounter('auth_failures_total', {});
          res.status(400).json({ error: 'invalid-password', message: 'New password must be at least 8 characters' });
          return;
        }

        await authManager.changePassword(currentPassword, newPassword);

        // Clear all sessions — user must re-login
        res.clearCookie('agentx_session', { path: '/' });

        endAuthSpan(handle, true);
        res.json({ ok: true });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Password change failed';
        endAuthSpan(handle, false, 'change-failed');
        metricsRegistry.incrementCounter('auth_failures_total', {});
        res.status(400).json({ error: 'change-failed', message });
      }
    });
  });

  return router;
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Validate WebSocket upgrade requests. Pre-setup allows loopback only; otherwise requires session cookie.
 */
export function validateWebSocketConnection(req: IncomingMessage): boolean {
  const handle = startAuthSpan('session_validate');
  try {
    if (!authManager.hasRootUser()) {
      handle.span.setAttribute('auth.setup_complete', false);
      const allowed = isLoopbackAddress(req.socket.remoteAddress);
      endAuthSpan(handle, allowed, allowed ? undefined : 'loopback-only-pre-setup');
      return allowed;
    }
    handle.span.setAttribute('auth.setup_complete', true);
    const token = extractSessionTokenFromCookie(req.headers.cookie);
    if (!token) {
      endAuthSpan(handle, false, 'missing-token');
      return false;
    }
    const valid = authManager.isAuthenticated(token);
    endAuthSpan(handle, valid, valid ? undefined : 'invalid-token');
    return valid;
  } catch (e: unknown) {
    endAuthSpan(handle, false, e instanceof Error ? e.message : 'session-validate-failed');
    return false;
  }
}

/** Voice WS accepts cookie auth, Bearer header, or ?token= query param (Electron fallback). */
export function validateVoiceWebSocketConnection(req: IncomingMessage): boolean {
  const handle = startAuthSpan('session_validate');
  try {
    if (!authManager.hasRootUser()) {
      handle.span.setAttribute('auth.setup_complete', false);
      const allowed = isLoopbackAddress(req.socket.remoteAddress);
      endAuthSpan(handle, allowed, allowed ? undefined : 'loopback-only-pre-setup');
      return allowed;
    }
    handle.span.setAttribute('auth.setup_complete', true);

    const cookieToken = extractSessionTokenFromCookie(req.headers.cookie);
    if (cookieToken && authManager.isAuthenticated(cookieToken)) {
      handle.span.setAttribute('auth.token_source', 'cookie');
      endAuthSpan(handle, true);
      return true;
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7);
      if (authManager.isAuthenticated(bearer)) {
        handle.span.setAttribute('auth.token_source', 'bearer');
        endAuthSpan(handle, true);
        return true;
      }
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken && authManager.isAuthenticated(queryToken)) {
      handle.span.setAttribute('auth.token_source', 'query');
      endAuthSpan(handle, true);
      return true;
    }

    endAuthSpan(handle, false, 'no-valid-token');
    return false;
  } catch (e: unknown) {
    endAuthSpan(handle, false, e instanceof Error ? e.message : 'session-validate-failed');
    return false;
  }
}
