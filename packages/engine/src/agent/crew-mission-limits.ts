import type { Crew, CrewResourceQuota } from '@agentx/shared';
import type { CrewMember } from './CrewOrchestrator.js';
import { MAX_MISSION_WORKERS } from './crew-mission-registry.js';

export function capMissionMembers(members: CrewMember[]): CrewMember[] {
  return members.slice(0, MAX_MISSION_WORKERS);
}

export function checkCrewElapsedQuota(crew: Crew, elapsedMs: number): string | null {
  const max = crew.quotas?.maxCpuTimeMs;
  if (max != null && elapsedMs > max) {
    return `${crew.name} exceeded CPU time quota (${max}ms)`;
  }
  return null;
}

export function checkCrewQuota(member: CrewMember, elapsedMs: number): string | null {
  const quota = member.crew.quotas;
  if (!quota) return null;

  if (quota.maxCpuTimeMs != null && member.cpuTimeMs + elapsedMs > quota.maxCpuTimeMs) {
    return `${member.crew.name} exceeded CPU time quota (${quota.maxCpuTimeMs}ms)`;
  }
  if (quota.maxTokensPerTurn != null && member.tokensUsedThisSession > quota.maxTokensPerTurn) {
    return `${member.crew.name} exceeded per-turn token quota (${quota.maxTokensPerTurn})`;
  }
  return null;
}

export function applyQuotaDefaults(crew: Crew): CrewResourceQuota {
  return {
    maxCpuTimeMs: crew.quotas?.maxCpuTimeMs ?? 600_000,
    maxTokensPerTurn: crew.quotas?.maxTokensPerTurn ?? 32_000,
    maxTokensPerSession: crew.quotas?.maxTokensPerSession,
    maxMemoryBytes: crew.quotas?.maxMemoryBytes,
  };
}
