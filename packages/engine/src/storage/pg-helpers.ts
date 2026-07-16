import type { PoolConfig } from 'pg';
import type {
  StorableSession,
  StorableMessage,
  StorableTokenLog,
} from '@agentx/shared';
import type { SessionEvent, Crew, AgentPersonaConfig } from '@agentx/shared';

export function getEnvValue(name: string): string | undefined {
  return process.env[name] ?? process.env[`AGENTX_${name}`];
}

export function getEnvInt(name: string, value: number | null | undefined, defaultValue: number): number {
  const env = getEnvValue(name);
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return value ?? defaultValue;
}

export function getEnvBool(name: string, value: boolean | undefined, defaultValue: boolean): boolean {
  const env = getEnvValue(name);
  if (env !== undefined) return env === 'true' || env === '1';
  return value ?? defaultValue;
}

export interface CacheState {
  sessions: Map<string, StorableSession>;
  childSessions: Map<string, Array<Record<string, unknown>>>;
  messages: Map<string, StorableMessage[]>;
  parts: Map<string, Array<Record<string, unknown>>>;
  crews: Crew[];
  persona: AgentPersonaConfig | null;
  checkpoints: Map<string, Array<{ id: string; session_id: string; label: string; messages: string; created_at: string }>>;
  crewStates: Map<string, Array<Record<string, unknown>>>;
  sessionEvents: Map<string, SessionEvent[]>;
  tokenLogs: Map<string, StorableTokenLog[]>;
  crewFeedback: Map<string, Array<Record<string, unknown>>>;
  turnFeedback: Map<string, Array<Record<string, unknown>>>;
  resumeState: Map<string, Record<string, unknown>>;
  permissionRules: Map<string, Array<Record<string, unknown>>>;
  taskSnapshots: Map<string, Record<string, unknown>>;
}

export interface PostgresConfig extends PoolConfig {
  connectionString?: string;
  max?: number;
  connectionTimeoutMillis?: number;
  application_name?: string;
  autoMigrate?: boolean;
  /** When true (default), only load session metadata at connect; messages load on demand. */
  lazyHydrate?: boolean;
  /** Optional progress lines for setup wizards and first-connect provisioning. */
  onProgress?: (line: string) => void;
}
