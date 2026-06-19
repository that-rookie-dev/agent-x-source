/**
 * Web-API Authentication Middleware & Routes
 * 
 * Provides:
 * - Express middleware for session validation
 * - Auth endpoints (setup, login, logout, status)
 * - Rate limiting on login attempts
 * - Secure cookie configuration
 */

import type { Request, Response, NextFunction, Router } from 'express';
import express from 'express';
import { authManager } from '@agentx/shared';
import type { AuthSession } from '@agentx/shared';
import { setEngineDEK, getEngine } from './engine.js';

// Simple in-memory rate limiter for login attempts
interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  blockedUntil: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 60 * 1000; // 1 minute window for counting

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return (forwarded.split(',')[0] ?? '').trim();
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;

  const now = Date.now();
  if (entry.blockedUntil > now) return true;

  // Reset if window has passed
  if (now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }

  return entry.attempts >= MAX_ATTEMPTS;
}

function recordAttempt(ip: string, success: boolean): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (success) {
    loginAttempts.delete(ip);
    return;
  }

  if (!entry || now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
  } else {
    entry.attempts++;
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
    }
  }
}

/**
 * Extract session token from cookie or Authorization header.
 */
function getToken(req: Request): string | undefined {
  // Check cookie first
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.match(/agentx_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  // Check Authorization header
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  // Check query parameter (for SSE EventSource which can't set custom headers)
  const tokenParam = req.query.token as string | undefined;
  if (tokenParam) return tokenParam;

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
      (req as any).agentxSession = session as AuthSession;
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
    '/api/agent/vitals',
    '/api/auth/setup',
    '/api/auth/login',
    '/api/auth/status',
    '/api/auth/check',
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
    res.json(state);
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
        secure: false, // Set to true in production with HTTPS
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
    const ip = getClientIp(req);

    if (isRateLimited(ip)) {
      res.status(429).json({
        error: 'rate-limited',
        message: 'Too many failed attempts. Please try again in 15 minutes.',
      });
      return;
    }

    try {
      const { username, password } = req.body as { username?: string; password?: string };

      if (!username || !password) {
        recordAttempt(ip, false);
        res.status(400).json({ error: 'missing-credentials', message: 'Username and password required' });
        return;
      }

      const token = await authManager.login(username, password);
      recordAttempt(ip, true);

      // Set engine DEK for encrypted config access
      const session = authManager.validateSession(token);
      if (session) {
        setEngineDEK(session.dek);
      }

      // Set secure session cookie
      res.cookie('agentx_session', token, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax', // lax needed for same-origin page navigations
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });

      res.json({ ok: true, username, token });
    } catch (e: unknown) {
      recordAttempt(ip, false);
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
