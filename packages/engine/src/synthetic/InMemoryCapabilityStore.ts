import { generateId, type Capability, type CapabilityAuditEvent, type CapabilityKind, type CapabilityMeta, type CapabilityOrigin, type CapabilityStatus, type CapabilityTestCase, type CapabilityUsageRecord, type GraduationGate, type GraduationGateName, type ObservedPattern } from '@agentx/shared';
import { CapabilityStoreError } from './errors.js';
import type { CapabilityStore, ObservationQuery } from './interfaces.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCapabilityStore implements CapabilityStore {
  private capabilities = new Map<string, Capability>();
  private observations = new Map<string, ObservedPattern>();
  private audits: CapabilityAuditEvent[] = [];
  private gates = new Map<string, GraduationGate[]>();
  private usage: CapabilityUsageRecord[] = [];
  private testCases = new Map<string, CapabilityTestCase[]>();
  toolAggregates: Array<{ toolName: string; frequency: number; lastAt: number }> = [];

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async insertCapability(cap: Capability): Promise<void> {
    if ([...this.capabilities.values()].some((c) => c.name === cap.name && c.status !== 'archived' && c.id !== cap.id)) {
      throw new CapabilityStoreError(`Capability name already exists: ${cap.name}`);
    }
    this.capabilities.set(cap.id, clone(cap));
  }

  async updateCapabilityStatus(id: string, status: CapabilityStatus): Promise<void> {
    const cap = this.capabilities.get(id);
    if (!cap) return;
    this.capabilities.set(id, { ...cap, status, updatedAt: Date.now() } as Capability);
  }

  async updateCapability(id: string, updates: Partial<CapabilityMeta> & Record<string, unknown>): Promise<void> {
    const cap = this.capabilities.get(id);
    if (!cap) return;
    this.capabilities.set(id, { ...cap, ...updates, updatedAt: Date.now() } as Capability);
  }

  async deleteCapability(id: string): Promise<void> {
    await this.updateCapabilityStatus(id, 'archived');
  }

  async getCapability(id: string): Promise<Capability | null> {
    const cap = this.capabilities.get(id);
    return cap ? clone(cap) : null;
  }

  async getCapabilities(status?: CapabilityStatus, kind?: CapabilityKind, limit = 100, offset = 0): Promise<Capability[]> {
    let rows = [...this.capabilities.values()];
    if (status) rows = rows.filter((c) => c.status === status);
    if (kind) rows = rows.filter((c) => c.kind === kind);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice(offset, offset + limit).map(clone);
  }

  async findCapabilityByName(name: string): Promise<Capability | null> {
    const cap = [...this.capabilities.values()].find((c) => c.name === name && c.status !== 'archived')
      ?? [...this.capabilities.values()].find((c) => c.name === name);
    return cap ? clone(cap) : null;
  }

  async searchCapabilities(query: string): Promise<Capability[]> {
    const q = query.toLowerCase();
    return [...this.capabilities.values()]
      .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
      .map(clone);
  }

  async listByOrigin(origin: CapabilityOrigin, limit = 100, offset = 0): Promise<Capability[]> {
    return [...this.capabilities.values()]
      .filter((c) => c.origin === origin)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(offset, offset + limit)
      .map(clone);
  }

  async insertObservation(pattern: ObservedPattern): Promise<void> {
    const existing = [...this.observations.values()].find((p) => p.pattern === pattern.pattern);
    if (existing) {
      this.observations.set(existing.id, {
        ...existing,
        frequency: existing.frequency + 1,
        lastObservedAt: Date.now(),
        confidence: Math.max(existing.confidence, pattern.confidence),
        context: pattern.context || existing.context,
        rejectedCount: pattern.rejectedCount ?? existing.rejectedCount ?? 0,
      });
      return;
    }
    this.observations.set(pattern.id, clone(pattern));
  }

  async updateObservation(id: string, updates: Partial<ObservedPattern>): Promise<void> {
    const existing = this.observations.get(id);
    if (!existing) return;
    this.observations.set(id, { ...existing, ...updates });
  }

  async getObservations(minConfidence = 0, query: ObservationQuery = {}): Promise<ObservedPattern[]> {
    const minFreq = query.minFrequency ?? 0;
    return [...this.observations.values()]
      .filter((p) => p.confidence >= (query.minConfidence ?? minConfidence))
      .filter((p) => p.frequency >= minFreq)
      .filter((p) => query.includeIgnored ? true : !p.ignored)
      .sort((a, b) => b.confidence - a.confidence)
      .map(clone);
  }

  async getObservation(id: string): Promise<ObservedPattern | null> {
    const p = this.observations.get(id);
    return p ? clone(p) : null;
  }

  async insertAuditEvent(event: CapabilityAuditEvent): Promise<void> {
    this.audits.push({ ...event, id: event.id || generateId('cae') });
  }

  async getAuditEvents(capabilityId: string): Promise<CapabilityAuditEvent[]> {
    return this.audits.filter((e) => e.capabilityId === capabilityId).sort((a, b) => a.timestamp - b.timestamp);
  }

  async getRecentAuditEvents(limit = 20): Promise<CapabilityAuditEvent[]> {
    return [...this.audits].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async incrementUseCount(capabilityId: string): Promise<void> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return;
    this.capabilities.set(capabilityId, { ...cap, useCount: cap.useCount + 1, updatedAt: Date.now() } as Capability);
  }

  async recordUsage(record: CapabilityUsageRecord): Promise<void> {
    this.usage.push(clone(record));
    await this.incrementUseCount(record.capabilityId);
  }

  async getUsage(capabilityId: string, limit = 50): Promise<CapabilityUsageRecord[]> {
    return this.usage.filter((u) => u.capabilityId === capabilityId).slice(0, limit);
  }

  async getMostUsedTools(limit = 10): Promise<Capability[]> {
    return [...this.capabilities.values()]
      .filter((c) => c.kind === 'tool' && c.status === 'registered')
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit)
      .map(clone);
  }

  async upsertGates(capabilityId: string, gates: GraduationGate[]): Promise<void> {
    const existing = this.gates.get(capabilityId) ?? [];
    const byGate = new Map(existing.map((g) => [g.gate, g]));
    for (const gate of gates) byGate.set(gate.gate, gate);
    this.gates.set(capabilityId, [...byGate.values()]);
  }

  async getGates(capabilityId: string): Promise<GraduationGate[]> {
    return clone(this.gates.get(capabilityId) ?? []);
  }

  async updateGate(capabilityId: string, gate: GraduationGateName, patch: Partial<GraduationGate>): Promise<void> {
    const existing = (await this.getGates(capabilityId)).find((g) => g.gate === gate);
    await this.upsertGates(capabilityId, [{
      gate,
      status: patch.status ?? existing?.status ?? 'pending',
      passedAt: patch.passedAt !== undefined ? patch.passedAt : (existing?.passedAt ?? null),
      passedBy: patch.passedBy !== undefined ? patch.passedBy : (existing?.passedBy ?? null),
      notes: patch.notes ?? existing?.notes ?? '',
    }]);
  }

  async getStats(): Promise<{ total: number; byStatus: Record<string, number>; byKind: Record<string, number> }> {
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const cap of this.capabilities.values()) {
      byStatus[cap.status] = (byStatus[cap.status] ?? 0) + 1;
      byKind[cap.kind] = (byKind[cap.kind] ?? 0) + 1;
    }
    return { total: this.capabilities.size, byStatus, byKind };
  }

  async listToolExecutionAggregates(minCount = 3): Promise<Array<{ toolName: string; frequency: number; lastAt: number }>> {
    return this.toolAggregates.filter((r) => r.frequency >= minCount);
  }

  async insertTestCase(testCase: CapabilityTestCase): Promise<void> {
    const list = this.testCases.get(testCase.capabilityId) ?? [];
    list.push(clone(testCase));
    this.testCases.set(testCase.capabilityId, list);
  }

  async listTestCases(capabilityId: string): Promise<CapabilityTestCase[]> {
    return (this.testCases.get(capabilityId) ?? []).map(clone);
  }

  async getTestCase(capabilityId: string, caseId: string): Promise<CapabilityTestCase | null> {
    const found = (this.testCases.get(capabilityId) ?? []).find((c) => c.id === caseId);
    return found ? clone(found) : null;
  }

  async updateTestCase(capabilityId: string, caseId: string, updates: Partial<CapabilityTestCase>): Promise<void> {
    const list = this.testCases.get(capabilityId) ?? [];
    const idx = list.findIndex((c) => c.id === caseId);
    if (idx >= 0) {
      list[idx] = { ...clone(list[idx]), ...updates } as CapabilityTestCase;
      this.testCases.set(capabilityId, list);
    }
  }

  async deleteTestCase(capabilityId: string, caseId: string): Promise<void> {
    const list = (this.testCases.get(capabilityId) ?? []).filter((c) => c.id !== caseId);
    this.testCases.set(capabilityId, list);
  }

  async countAuditEvents(event: string, sinceMs: number, sessionId?: string): Promise<number> {
    return this.audits.filter((a) => {
      if (a.event !== event || a.timestamp < sinceMs) return false;
      if (!sessionId) return true;
      return a.details?.['sessionId'] === sessionId;
    }).length;
  }
}
