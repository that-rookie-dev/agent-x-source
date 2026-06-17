import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getLogger } from '@agentx/shared';
import { getConfigDir } from '../config/paths.js';

const logger = getLogger();

// ── Types ──

export interface CloudSession {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  prompt?: string;
  result?: string;
  error?: string;
  workerUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CloudWorkerConfig {
  endpoint: string;
  apiKey?: string;
  maxRetries?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface CloudAuthToken {
  token: string;
  expiresAt: number;
  refreshToken?: string;
}

// ── Cloud Auth ──

export class CloudAuth {
  private tokenPath: string;
  private token: CloudAuthToken | null = null;

  constructor() {
    this.tokenPath = join(getConfigDir(), 'cloud-auth.json');
    this.load();
  }

  isAuthenticated(): boolean {
    return this.token !== null && Date.now() < this.token.expiresAt;
  }

  getToken(): string | null {
    if (!this.isAuthenticated()) return null;
    return this.token!.token;
  }

  async login(apiUrl: string, apiKey?: string): Promise<boolean> {
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) return false;
      const data = (await res.json()) as CloudAuthToken;
      this.token = data;
      this.save();
      return true;
    } catch (e) {
      logger.error('CLOUD_AUTH_FAILED', e);
      return false;
    }
  }

  async register(apiUrl: string, email?: string): Promise<boolean> {
    try {
      const res = await fetch(`${apiUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) return false;
      const data = (await res.json()) as CloudAuthToken;
      this.token = data;
      this.save();
      return true;
    } catch (e) {
      logger.error('CLOUD_REGISTER_FAILED', e);
      return false;
    }
  }

  logout(): void {
    this.token = null;
    if (existsSync(this.tokenPath)) {
      try { writeFileSync(this.tokenPath, '{}', 'utf-8'); } catch { /* ignore */ }
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.tokenPath)) return;
      const raw = readFileSync(this.tokenPath, 'utf-8');
      this.token = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      const dir = dirname(this.tokenPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.tokenPath, JSON.stringify(this.token), 'utf-8');
    } catch (e) {
      logger.error('CLOUD_AUTH_SAVE_FAILED', e);
    }
  }
}

// ── Cloud Handoff ──

export class CloudHandoff {
  private config: CloudWorkerConfig;
  private auth: CloudAuth;
  private sessions: Map<string, CloudSession> = new Map();
  private reportPath: string;

  constructor(config: CloudWorkerConfig, auth?: CloudAuth) {
    this.config = {
      pollIntervalMs: 2000,
      maxRetries: 3,
      timeoutMs: 300000,
      ...config,
    };
    this.auth = auth ?? new CloudAuth();
    this.reportPath = join(getConfigDir(), 'cloud-sessions.json');
    this.loadSessions();
  }

  getAuth(): CloudAuth {
    return this.auth;
  }

  // ── Session Management ──

  getSessions(): CloudSession[] {
    return [...this.sessions.values()];
  }

  getSession(id: string): CloudSession | undefined {
    return this.sessions.get(id);
  }

  async listRemoteSessions(): Promise<CloudSession[]> {
    const token = this.auth.getToken();
    if (!token) throw new Error('Not authenticated to cloud');

    try {
      const res = await fetch(`${this.config.endpoint}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to list sessions: ${res.statusText}`);
      const sessions = (await res.json()) as CloudSession[];
      for (const s of sessions) {
        this.sessions.set(s.id, s);
      }
      this.saveSessions();
      return sessions;
    } catch (e) {
      logger.error('CLOUD_LIST_SESSIONS_FAILED', e);
      throw e;
    }
  }

  // ── Teleport (send session to cloud) ──

  async teleport(prompt: string, options?: {
    timeout?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CloudSession> {
    const token = this.auth.getToken();
    if (!token) throw new Error('Not authenticated to cloud. Run `agentx cloud login` first.');

    const session: CloudSession = {
      id: `cloud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      prompt,
      metadata: options?.metadata,
    };

    this.sessions.set(session.id, session);
    this.saveSessions();

    try {
      const res = await fetch(`${this.config.endpoint}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: session.id,
          prompt,
          timeout: options?.timeout ?? this.config.timeoutMs,
          metadata: options?.metadata,
        }),
      });

      if (!res.ok) {
        session.status = 'failed';
        session.error = `Cloud API error: ${res.statusText}`;
        this.saveSessions();
        return session;
      }

      const cloudSession = (await res.json()) as CloudSession;
      session.status = 'running';
      session.workerUrl = cloudSession.workerUrl;
      session.updatedAt = Date.now();
      this.sessions.set(session.id, session);
      this.saveSessions();

      // Poll for completion
      await this.pollSession(session.id);

      return this.sessions.get(session.id)!;
    } catch (e) {
      session.status = 'failed';
      session.error = (e as Error).message;
      this.saveSessions();
      return session;
    }
  }

  // ── Resume from cloud ──

  async resumeFromCloud(sessionId: string): Promise<CloudSession> {
    const token = this.auth.getToken();
    if (!token) throw new Error('Not authenticated to cloud');

    try {
      const res = await fetch(`${this.config.endpoint}/api/sessions/${sessionId}/resume`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Failed to resume session: ${res.statusText}`);
      const session = (await res.json()) as CloudSession;
      this.sessions.set(session.id, session);
      this.saveSessions();

      // Poll if still running
      if (session.status === 'running' || session.status === 'pending') {
        await this.pollSession(session.id);
      }

      return this.sessions.get(session.id)!;
    } catch (e) {
      logger.error('CLOUD_RESUME_FAILED', e);
      throw e;
    }
  }

  // ── Cancel session ──

  async cancelSession(sessionId: string): Promise<boolean> {
    const token = this.auth.getToken();
    if (!token) return false;

    try {
      const res = await fetch(`${this.config.endpoint}/api/sessions/${sessionId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'cancelled';
          session.updatedAt = Date.now();
          this.saveSessions();
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Private ──

  private async pollSession(sessionId: string): Promise<void> {
    const token = this.auth.getToken();
    if (!token) return;

    const startTime = Date.now();
    const timeout = this.config.timeoutMs ?? 300000;

    while (Date.now() - startTime < timeout) {
      try {
        const res = await fetch(`${this.config.endpoint}/api/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          await this.delay(this.config.pollIntervalMs ?? 2000);
          continue;
        }

        const remote = (await res.json()) as CloudSession;
        const local = this.sessions.get(sessionId);
        if (local) {
          local.status = remote.status;
          local.result = remote.result;
          local.error = remote.error;
          local.updatedAt = Date.now();
          if (remote.status === 'completed' || remote.status === 'failed' || remote.status === 'cancelled') {
            local.completedAt = remote.completedAt ?? Date.now();
          }
          this.saveSessions();
        }

        if (remote.status === 'completed' || remote.status === 'failed' || remote.status === 'cancelled') {
          return;
        }
      } catch {
        // Network error — retry
      }

      await this.delay(this.config.pollIntervalMs ?? 2000);
    }

    // Timeout
    const local = this.sessions.get(sessionId);
    if (local && local.status === 'running') {
      local.status = 'failed';
      local.error = 'Cloud session timed out';
      this.saveSessions();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private loadSessions(): void {
    try {
      if (!existsSync(this.reportPath)) return;
      const raw = readFileSync(this.reportPath, 'utf-8');
      const sessions = JSON.parse(raw) as CloudSession[];
      for (const s of sessions) {
        this.sessions.set(s.id, s);
      }
    } catch { /* ignore */ }
  }

  private saveSessions(): void {
    try {
      const dir = dirname(this.reportPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.reportPath, JSON.stringify([...this.sessions.values()], null, 2), 'utf-8');
    } catch (e) {
      logger.error('CLOUD_SESSIONS_SAVE_FAILED', e);
    }
  }
}

// ── Cloud Worker (runs on server) ──

export async function runCloudWorker(
  sessionId: string,
  prompt: string,
  apiUrl: string,
  apiKey: string,
): Promise<void> {
  logger.info('CLOUD_WORKER_START', JSON.stringify({ sessionId }));

  try {
    // Run the prompt via the engine
    const { Agent } = await import('../agent/Agent.js');
    const { ConfigManager } = await import('../config/ConfigManager.js');

    const config = new ConfigManager().load();
    const eng = (globalThis as any).__agentx_engine__;
    const scopePath = eng?.sessionManager?.getActiveSession?.()?.scopePath || '';
    const agent = new Agent({ config, sessionId, scopePath });

    const result = await agent.sendMessage(prompt);

    // Report result back to cloud API
    const res = await fetch(`${apiUrl}/api/sessions/${sessionId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        result: result.content,
        status: 'completed',
        completedAt: Date.now(),
      }),
    });

    if (!res.ok) {
      logger.error('CLOUD_WORKER_REPORT_FAILED', JSON.stringify({ sessionId, status: res.statusText }));
    }

    logger.info('CLOUD_WORKER_COMPLETE', JSON.stringify({ sessionId }));
  } catch (e) {
    logger.error('CLOUD_WORKER_ERROR', JSON.stringify({ sessionId, error: (e as Error).message }));

    // Report failure
    try {
      await fetch(`${apiUrl}/api/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          error: (e as Error).message,
          status: 'failed',
          completedAt: Date.now(),
        }),
      });
    } catch { /* ignore */ }
  }
}
