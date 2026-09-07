import { generateId, type CapabilityMeta, type CapabilityUsageRecord, type CapabilityUsageReport } from '@agentx/shared';
import type { CapabilityStore } from './interfaces.js';

export class UsageTracker {
  constructor(private store: CapabilityStore) {}

  async recordInvocation(
    capabilityId: string,
    success: boolean,
    executionTimeMs: number,
    sessionId?: string,
    crewId?: string,
  ): Promise<void> {
    const record: CapabilityUsageRecord = {
      id: generateId('use'),
      capabilityId,
      sessionId,
      crewId,
      success,
      createdAt: Date.now(),
      executionTimeMs,
    };
    await this.store.recordUsage(record);
  }

  async recordUserFeedback(capabilityId: string, positive: boolean): Promise<void> {
    await this.store.recordUsage({
      id: generateId('use'),
      capabilityId,
      success: positive,
      createdAt: Date.now(),
      positiveFeedback: positive,
    });
  }

  async getUsageReport(capabilityId: string): Promise<CapabilityUsageReport> {
    const usage = await this.store.getUsage(capabilityId, 500);
    const cap = await this.store.getCapability(capabilityId);
    const success = usage.filter((u) => u.success).length;
    const timed = usage.filter((u) => typeof u.executionTimeMs === 'number');
    const avg = timed.length
      ? timed.reduce((sum, u) => sum + (u.executionTimeMs ?? 0), 0) / timed.length
      : 0;
    const sessions = new Set(usage.map((u) => u.sessionId).filter(Boolean));
    const perDayMap = new Map<string, { count: number; success: number }>();
    for (const row of usage) {
      const day = new Date(row.createdAt).toISOString().slice(0, 10);
      const cur = perDayMap.get(day) ?? { count: 0, success: 0 };
      cur.count += 1;
      if (row.success) cur.success += 1;
      perDayMap.set(day, cur);
    }
    return {
      capabilityId,
      useCount: cap?.useCount ?? usage.length,
      successRate: usage.length ? success / usage.length : 1,
      avgExecutionTimeMs: avg,
      sessionCount: sessions.size,
      positiveCount: usage.filter((u) => u.positiveFeedback).length,
      crewCount: new Set(usage.map((u) => u.crewId).filter(Boolean)).size,
      userSatisfaction: usage.length
        ? usage.filter((u) => u.positiveFeedback || u.success).length / usage.length
        : 1,
      perDay: [...perDayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => ({ day, ...v })),
    };
  }

  async getTopTools(limit = 10): Promise<CapabilityMeta[]> {
    return this.store.getMostUsedTools(limit);
  }

  async getUnderperformingTools(minFailRate = 0.3): Promise<CapabilityMeta[]> {
    const tools = await this.store.getCapabilities('registered', 'tool', 200, 0);
    const out: CapabilityMeta[] = [];
    for (const cap of tools) {
      const report = await this.getUsageReport(cap.id);
      if (report.useCount >= 10 && (1 - report.successRate) >= minFailRate) {
        out.push(cap);
      }
    }
    return out;
  }
}
