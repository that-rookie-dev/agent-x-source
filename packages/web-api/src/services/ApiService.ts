import { getEngine, awaitEngineStorageReady } from '../engine.js';
import type { EngineState } from '../engine.js';
import { MemoryService, getPerfTracker, getSubAgentServiceInstance } from '@agentx/engine';
import type { SubAgentService, SubAgentRecord } from '@agentx/engine';
import type { Agent, ConfigManager, SessionManager, CrewManager, IJobQueue, ChannelStatus } from '@agentx/engine';
import type { AgentXConfig } from '@agentx/shared';
import { getLogger, VERSION } from '@agentx/shared';

export interface AgentMetrics {
  turnsTotal: number;
  toolLatencyAvg: number;
  toolLatencyP95: number;
  toolLatencyCount: number;
  queueDepth: number;
  memoryCacheHitRate: number;
}

/**
 * ApiContext is passed to every route module factory.
 * Routes should use this instead of importing getEngine() directly.
 */
export interface ApiContext {
  api: ApiService;
}

/**
 * ApiService exposes the engine services to the web API route modules.
 * It is created once in index.ts and wired into each express.Router factory.
 */
export class ApiService {
  private memoryService: MemoryService | null = null;

  /** Access the raw engine state. Prefer the typed helpers below. */
  getEngine(): EngineState {
    return getEngine();
  }

  /** Wait for the active storage backend to connect and migrate. */
  awaitStorageReady(): Promise<void> {
    return awaitEngineStorageReady();
  }

  /** Return the current UI agent, or null if not created yet. */
  getAgent(): Agent | null {
    return this.getEngine().agent;
  }

  /** Return the engine config manager. */
  getConfigManager(): ConfigManager {
    return this.getEngine().configManager;
  }

  /** Return the session manager. */
  getSessionManager(): SessionManager {
    return this.getEngine().sessionManager;
  }

  /** Return the crew manager. */
  getCrewManager(): CrewManager {
    return this.getEngine().crewManager;
  }

  /** Return the durable job queue. */
  getJobQueue(): IJobQueue {
    return this.getEngine().jobQueue;
  }

  /** Return the global sub-agent registry. */
  getSubAgentService(): SubAgentService {
    return getSubAgentServiceInstance();
  }

  /** Return the memory service (lazily initialized from the engine pg pool). */
  getMemoryService(): MemoryService | null {
    const eng = this.getEngine();
    const pool = eng.pgPool;
    if (!pool) return null;
    if (!this.memoryService) {
      this.memoryService = new MemoryService({ pool, cache: eng.serviceContext?.cache });
      if (process.env['AGENTX_VAULT_KEY']) {
        try {
          const key = Buffer.from(process.env['AGENTX_VAULT_KEY'], 'base64');
          this.memoryService.setVault(key);
        } catch (e) {
          getLogger().error('API_SERVICE', `Failed to initialize secure vault: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    return this.memoryService;
  }

  /** Return the current memory cache hit rate, or 0 if not initialized. */
  getMemoryCacheHitRate(): number {
    try {
      const ms = this.getMemoryService();
      if (!ms) return 0;
      return ms.getCacheService().getHitRate();
    } catch {
      return 0;
    }
  }

  /** Return runtime metrics for the /metrics endpoint. */
  getAgentMetrics(): AgentMetrics {
    try {
      const eng = this.getEngine();
      const turnStats = getPerfTracker().getStats();
      const toolStats = getPerfTracker().getToolLatencyStats();
      return {
        turnsTotal: turnStats.totalTurns,
        toolLatencyAvg: toolStats.avgLatencyMs / 1000,
        toolLatencyP95: toolStats.p95LatencyMs / 1000,
        toolLatencyCount: toolStats.totalTools,
        queueDepth: typeof eng.jobQueue?.getQueueDepth === 'function' ? eng.jobQueue.getQueueDepth() : 0,
        memoryCacheHitRate: this.getMemoryCacheHitRate(),
      };
    } catch (e) {
      getLogger().warn('API_SERVICE', `Agent metrics failed: ${e instanceof Error ? e.message : String(e)}`);
      return {
        turnsTotal: 0,
        toolLatencyAvg: 0,
        toolLatencyP95: 0,
        toolLatencyCount: 0,
        queueDepth: 0,
        memoryCacheHitRate: 0,
      };
    }
  }

  /** Return a loaded config, or null if it cannot be read. */
  loadConfig(): AgentXConfig | null {
    try {
      return this.getConfigManager().load();
    } catch {
      return null;
    }
  }

  /** Helper: require the UI agent and return it, or throw a 503-style response. */
  requireAgent(res: { status: (_code: number) => { json: (_body: unknown) => void } }): Agent | null {
    const agent = this.getAgent();
    if (!agent) {
      res.status(503).json({ error: 'Agent not initialized' });
      return null;
    }
    return agent;
  }

  /** Helper: require a session by id and return it, or throw a 404-style response. */
  requireSession(
    sessionId: string,
    res: { status: (_code: number) => { json: (_body: unknown) => void } },
  ): import('@agentx/shared').Session | null {
    const session = this.getSessionManager().getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return null;
    }
    return session;
  }

  /** Return readiness checks for the storage backend, cache, memory service, and channel service. */
  getReadiness(): {
    ready: boolean;
    checks: { storage: boolean; memory: boolean; cache: boolean; channels: boolean };
  } {
    try {
      const eng = this.getEngine();
      const storageConnected = eng.storageDeferred ? false : eng.storageAdapter?.isConnected() ?? false;
      const memoryInitialized = this.getMemoryService() !== null;
      const cache = eng.serviceContext?.cache;
      const cacheConnected = typeof cache?.isConnected === 'function' ? cache.isConnected() : true;
      const channelStatuses = eng.serviceContext?.channelService?.getStatus() ?? [];
      const channelsConnected =
        channelStatuses.length === 0 || channelStatuses.every((s: ChannelStatus) => s.connected);
      const ready = storageConnected && memoryInitialized && cacheConnected && channelsConnected;
      return {
        ready,
        checks: {
          storage: storageConnected,
          memory: memoryInitialized,
          cache: cacheConnected,
          channels: channelsConnected,
        },
      };
    } catch (e) {
      getLogger().warn('API_SERVICE', `Readiness check failed: ${e instanceof Error ? e.message : String(e)}`);
      return {
        ready: false,
        checks: { storage: false, memory: false, cache: false, channels: false },
      };
    }
  }

  /** Return a system status snapshot for /api/status. */
  getStatus(): {
    version: string;
    uptime: number;
    nodeVersion: string;
    platform: string;
    memoryUsage: NodeJS.MemoryUsage;
    activeSessions: number;
    channelStatus: { connected: boolean; channels: ChannelStatus[] };
    dbStatus: { connected: boolean; deferred: boolean };
  } {
    try {
      const eng = this.getEngine();
      const sessions = eng.sessionManager.listSessions(9999);
      const channels = eng.serviceContext?.channelService?.getStatus() ?? [];
      const channelsConnected = channels.length === 0 || channels.every((s: ChannelStatus) => s.connected);
      return {
        version: VERSION,
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        activeSessions: sessions.length,
        channelStatus: { connected: channelsConnected, channels },
        dbStatus: { connected: eng.storageAdapter?.isConnected() ?? false, deferred: eng.storageDeferred },
      };
    } catch (e) {
      getLogger().warn('API_SERVICE', `Status check failed: ${e instanceof Error ? e.message : String(e)}`);
      return {
        version: VERSION,
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        activeSessions: 0,
        channelStatus: { connected: false, channels: [] },
        dbStatus: { connected: false, deferred: false },
      };
    }
  }

  /** Stop engine services and disconnect storage as part of graceful shutdown. */
  async stop(): Promise<void> {
    try {
      const eng = this.getEngine();
      try { await eng.serviceContext?.channelService?.stop(); } catch { /* ignore */ }
      try { await eng.jobQueue?.stop(); } catch { /* ignore */ }
      try { await eng.storageAdapter?.disconnect(); } catch { /* ignore */ }
      try { await (eng.serviceContext?.cache as { disconnect?: () => Promise<void> } | undefined)?.disconnect?.(); } catch { /* ignore */ }
    } catch {
      // Engine may not have fully initialized; nothing to stop.
    }
  }
}

/** Singleton-ish accessor for the bootstrap file. */
export function createApiService(): ApiService {
  return new ApiService();
}
