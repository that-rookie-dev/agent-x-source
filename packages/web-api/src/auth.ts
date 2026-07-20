/**
 * Web-API Authentication Middleware & Routes
 *
 * Provides:
 * - Express middleware for session validation
 * - Auth endpoints (setup, login, logout, status)
 * - Secure cookie configuration
 */

import type { Request, Response, NextFunction, Router } from 'express';
import type { IncomingMessage } from 'node:http';
import express from 'express';
import { authManager } from '@agentx/shared';
import type { AuthSession } from '@agentx/shared';
import { setEngineDEK, getEngine } from './engine.js';

function useSecureCookies(req?: Request): boolean {
  if (process.env['AGENTX_SECURE_COOKIES'] === 'true') return true;
  if (process.env['AGENTX_SECURE_COOKIES'] === 'false') return false;
  return req?.secure === true;
}

const SSE_TOKEN_PATHS = new Set([
  '/api/chat/stream',
  '/api/logs/stream',
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
      // (getEngine() is lazily created by route handlers — middleware runs first)
      getEngine();
      setEngineDEK(session.dek);
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
  // Public paths that don't require authentication
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

  if (publicPaths.includes(req.path)) {
    // Still try to sync DEK for public paths (e.g., status check with valid cookie)
    syncDEKMiddleware(req, res, () => {});
    next();
    return;
  }

  // Static files and SPA fallback
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  const token = getToken(req);
  if (!token || !authManager.isAuthenticated(token)) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }

  // Sync DEK and attach session info
  syncDEKMiddleware(req, res, () => {});
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
    const hasRootUser = authManager.hasRootUser();
    res.json({ hasRootUser });
  });

  /**
   * GET /api/auth/status
   * Get current authentication state.
   */
  router.get('/auth/status', (req, res) => {
    const token = getToken(req);
    const state = authManager.getAuthState(token);
    // Expose session token for WebSocket auth (Electron may not attach cookies to WS upgrades).
    res.json({
      ...state,
      sessionToken: state.isAuthenticated && token ? token : undefined,
    });
  });

  /**
   * POST /api/auth/setup
   * Create the root user (one-time setup).
   */
  router.post('/auth/setup', async (req, res) => {
    try {
      if (authManager.hasRootUser()) {
        res.status(409).json({ error: 'already-configured', message: 'Root user already exists' });
        return;
      }

      const { username, password } = req.body as { username?: string; password?: string };

      if (!username || typeof username !== 'string' || username.length < 3) {
        res.status(400).json({ error: 'invalid-username', message: 'Username must be at least 3 characters' });
        return;
      }

      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'invalid-password', message: 'Password must be at least 8 characters' });
        return;
      }

      // Enforce password complexity
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

      if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
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

      res.json({ ok: true, username, token });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Setup failed';
      res.status(500).json({ error: 'setup-failed', message });
    }
  });

  /**
   * POST /api/auth/login
   * Authenticate and create a session.
   */
  router.post('/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };

      if (!username || !password) {
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

      res.json({ ok: true, username, token });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Authentication failed';
      res.status(401).json({ error: 'invalid-credentials', message });
    }
  });

  /**
   * POST /api/auth/logout
   * Destroy the current session.
   */
  router.post('/auth/logout', (req, res) => {
    const token = getToken(req);
    if (token) {
      authManager.logout(token);
    }
    res.clearCookie('agentx_session', { path: '/' });
    res.json({ ok: true });
  });

  /**
   * POST /api/auth/change-password
   * Change the root user's password.
   */
  router.post('/auth/change-password', async (req, res) => {
    const token = getToken(req);
    if (!token || !authManager.isAuthenticated(token)) {
      res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
      return;
    }

    try {
      const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'missing-passwords', message: 'Current and new password required' });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: 'invalid-password', message: 'New password must be at least 8 characters' });
        return;
      }

      await authManager.changePassword(currentPassword, newPassword);

      // Clear all sessions — user must re-login
      res.clearCookie('agentx_session', { path: '/' });

      res.json({ ok: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Password change failed';
      res.status(400).json({ error: 'change-failed', message });
    }
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
  if (!authManager.hasRootUser()) {
    return isLoopbackAddress(req.socket.remoteAddress);
  }
  const token = extractSessionTokenFromCookie(req.headers.cookie);
  if (!token) return false;
  return authManager.isAuthenticated(token);
}

/** Voice WS accepts cookie auth, Bearer header, or ?token= query param (Electron fallback). */
export function validateVoiceWebSocketConnection(req: IncomingMessage): boolean {
  if (!authManager.hasRootUser()) {
    return isLoopbackAddress(req.socket.remoteAddress);
  }
  const cookieToken = extractSessionTokenFromCookie(req.headers.cookie);
  if (cookieToken && authManager.isAuthenticated(cookieToken)) {
    return true;
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7);
    if (authManager.isAuthenticated(bearer)) return true;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const queryToken = url.searchParams.get('token');
  return Boolean(queryToken && authManager.isAuthenticated(queryToken));
}
