/**
 * Reusable rolling-window rate limiter middleware.
 * Tracks timestamps per-key (IP or sessionId) for precise sliding-window counting.
 * Uses env vars for configuration, same pattern as auth.ts login limiter.
 */

import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '@agentx/shared';

interface RateLimitEntry {
  timestamps: number[];
  blockedUntil: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export interface RateLimitOptions {
  /** Env var prefix for config (e.g. "CHAT" → AGENTX_CHAT_RATE_LIMIT_MAX) */
  prefix: string;
  /** Label for log messages */
  label: string;
  /** Key extractor from request */
  keyFn?: (req: Request) => string;
}

function getEnv(prefix: string, key: string, fallback: string): number {
  return parseInt(process.env[`AGENTX_${prefix}_RATE_LIMIT_${key}`] ?? fallback, 10);
}

/**
 * Create a rate limit middleware for a specific endpoint group.
 * Each group has its own store and env vars:
 *   AGENTX_{PREFIX}_RATE_LIMIT_MAX — max attempts in window
 *   AGENTX_{PREFIX}_RATE_LIMIT_BLOCK_MS — block duration in ms
 *   AGENTX_{PREFIX}_RATE_LIMIT_WINDOW_MS — sliding window in ms
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { prefix, label, keyFn } = options;

  const MAX = getEnv(prefix, 'MAX', '20');
  const BLOCK_MS = getEnv(prefix, 'BLOCK_MS', '60000');
  const WINDOW_MS = getEnv(prefix, 'WINDOW_MS', '10000');

  if (!stores.has(prefix)) {
    stores.set(prefix, new Map());
  }
  const store = stores.get(prefix)!;

  function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const ips = forwarded.split(',');
      return (ips[0] ?? '').trim() || req.socket.remoteAddress || 'unknown';
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function getKey(req: Request): string {
    return keyFn ? keyFn(req) : getClientIp(req);
  }

  function isLimited(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    const now = Date.now();
    if (entry.blockedUntil > now) return true;
    entry.timestamps = entry.timestamps.filter(ts => now - ts < WINDOW_MS);
    if (entry.timestamps.length === 0) {
      store.delete(key);
      return false;
    }
    return entry.timestamps.length >= MAX;
  }

  function record(key: string): void {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [], blockedUntil: 0 };
      store.set(key, entry);
    }
    entry.timestamps = entry.timestamps.filter(ts => now - ts < WINDOW_MS);
    entry.timestamps.push(now);
    if (entry.timestamps.length >= MAX) {
      entry.blockedUntil = now + BLOCK_MS;
      getLogger().warn('RATE_LIMIT', `[${label}] Key ${key.slice(0, 30)} blocked for ${BLOCK_MS / 1000}s`);
    }
  }

  function remaining(key: string): number {
    const entry = store.get(key);
    if (!entry) return MAX;
    if (entry.blockedUntil > Date.now()) return 0;
    const recent = entry.timestamps.filter(ts => Date.now() - ts < WINDOW_MS);
    return Math.max(0, MAX - recent.length);
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = getKey(req);
    if (isLimited(key)) {
      const retryAfter = Math.ceil(BLOCK_MS / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(MAX));
      res.set('X-RateLimit-Remaining', '0');
      res.status(429).json({
        status: 'error',
        code: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${retryAfter}s.`,
      });
      return;
    }
    record(key);
    res.set('X-RateLimit-Limit', String(MAX));
    res.set('X-RateLimit-Remaining', String(remaining(key)));
    next();
  };

  return { middleware, store };
}

export function startGlobalRateLimitCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [, store] of stores) {
      for (const [key, entry] of store.entries()) {
        if (entry.blockedUntil <= now) {
          entry.timestamps = entry.timestamps.filter(ts => now - ts < 60000);
          if (entry.timestamps.length === 0) {
            store.delete(key);
          }
        }
      }
    }
  }, 300000);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function stopGlobalRateLimitCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
