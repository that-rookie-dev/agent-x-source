import type { Capability } from '@agentx/shared';
import type { CapabilityStore } from './interfaces.js';
import { UsageTracker } from './UsageTracker.js';

const UNUSED_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export class AutoDeprecator {
  constructor(
    private store: CapabilityStore,
    private usage: UsageTracker,
    private excludeIds: Set<string> = new Set(),
    private minAgeMs = RECENT_MS,
  ) {}

  async evaluateAll(): Promise<{ toDeprecate: string[]; toArchive: string[] }> {
    const toDeprecate: string[] = [];
    const toArchive: string[] = [];
    const registered = await this.store.getCapabilities('registered', undefined, 400, 0);
    const trial = await this.store.getCapabilities('in-trial', undefined, 200, 0);
    const now = Date.now();

    for (const cap of [...registered, ...trial]) {
      if (this.excludeIds.has(cap.id)) continue;
      const report = await this.usage.getUsageReport(cap.id);
      if (report.useCount >= 10 && report.successRate < 0.3) {
        toDeprecate.push(cap.id);
        continue;
      }
      if (now - cap.createdAt < this.minAgeMs) continue;
      if (cap.useCount === 0 && now - cap.createdAt >= UNUSED_MS) {
        toArchive.push(cap.id);
      }
    }
    return { toDeprecate, toArchive };
  }

  async deprecate(id: string, reason: string): Promise<void> {
    const cap = await this.store.getCapability(id);
    if (!cap) return;
    const status = cap.status === 'in-trial' ? 'trial-failed' : 'disabled';
    await this.store.updateCapabilityStatus(id, status);
    await this.store.insertAuditEvent({
      id: `cae_dep_${id}_${Date.now()}`,
      capabilityId: id,
      event: 'deprecated',
      timestamp: Date.now(),
      actor: 'system',
      details: { reason, status },
    });
  }

  async sweep(): Promise<{ deprecated: string[]; archived: string[] }> {
    const { toDeprecate, toArchive } = await this.evaluateAll();
    for (const id of toDeprecate) {
      await this.deprecate(id, 'successRate < 0.3 after 10+ uses');
    }
    const archived: string[] = [];
    for (const id of toArchive) {
      await this.store.updateCapabilityStatus(id, 'archived');
      await this.store.insertAuditEvent({
        id: `cae_arch_${id}_${Date.now()}`,
        capabilityId: id,
        event: 'archived',
        timestamp: Date.now(),
        actor: 'system',
        details: { reason: 'unused-30-days' },
      });
      archived.push(id);
    }
    return { deprecated: toDeprecate, archived };
  }
}

export type { Capability };
