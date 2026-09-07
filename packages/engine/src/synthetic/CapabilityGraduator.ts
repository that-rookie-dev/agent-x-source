import type { Capability, GraduationGate, GraduationGateName, GraduationProposal, SkillCapability, ToolCapability } from '@agentx/shared';
import { CapabilityGraduationError, CapabilityNotFoundError } from './errors.js';
import type { CapabilityGraduator, CapabilityStore } from './interfaces.js';

const TOOL_GATES: GraduationGateName[] = ['sandbox', 'trial', 'user-approval'];
const SKILL_GATES: GraduationGateName[] = ['sandbox', 'user-approval'];

function emptyGate(gate: GraduationGateName, status: GraduationGate['status'] = 'pending'): GraduationGate {
  return { gate, status, passedAt: null, passedBy: null, notes: '' };
}

export class DefaultCapabilityGraduator implements CapabilityGraduator {
  constructor(private store: CapabilityStore) {}

  async seedGates(capability: Capability): Promise<void> {
    if (capability.kind === 'knowledge') {
      await this.store.upsertGates(capability.id, [
        { ...emptyGate('sandbox', 'skipped'), notes: 'Knowledge items do not execute' },
        { ...emptyGate('user-approval', 'pending') },
      ]);
      return;
    }
    if (capability.kind === 'skill') {
      await this.store.upsertGates(capability.id, [
        { ...emptyGate('sandbox', 'skipped'), notes: 'Prompt-recipe skills skip sandbox execution' },
        emptyGate('user-approval'),
      ]);
      return;
    }
    if (capability.kind === 'tool') {
      await this.store.upsertGates(capability.id, TOOL_GATES.map((g) => emptyGate(g)));
    }
  }

  async getProposal(capabilityId: string): Promise<GraduationProposal | null> {
    const cap = await this.store.getCapability(capabilityId);
    if (!cap || (cap.kind !== 'tool' && cap.kind !== 'skill' && cap.kind !== 'knowledge')) return null;
    const observations = await this.store.getObservations();
    const pattern = observations.find((o) => o.pattern === cap.userPrompt || o.pattern.includes(cap.name)) ?? {
      id: cap.id,
      pattern: cap.userPrompt || cap.description,
      frequency: 1,
      firstObservedAt: cap.createdAt,
      lastObservedAt: cap.updatedAt,
      context: cap.description,
      confidence: 1,
      origin: cap.origin === 'user-prompt' ? 'user-prompt' as const : 'autonomous' as const,
    };
    return {
      pattern,
      proposedCapability: cap,
      generatedBy: cap.generatedBy ?? 'system',
      confidence: pattern.confidence,
      alternatives: cap.alternatives ?? [],
    };
  }

  async getGates(capabilityId: string): Promise<GraduationGate[]> {
    return this.store.getGates(capabilityId);
  }

  async passGate(capabilityId: string, gate: string, actor: string, notes?: string): Promise<void> {
    const name = this.requireGate(gate);
    const existing = (await this.store.getGates(capabilityId)).find((g) => g.gate === name);
    if (existing?.status === 'skipped' || existing?.status === 'passed') return;
    const next = await this.getNextGate(capabilityId);
    if (next && next.gate !== name && next.status === 'pending') {
      throw new CapabilityGraduationError(`Must pass ${next.gate} before ${name}`);
    }
    await this.store.updateGate(capabilityId, name, {
      status: 'passed',
      passedAt: Date.now(),
      passedBy: actor,
      notes: notes ?? '',
    });
  }

  async failGate(capabilityId: string, gate: string, actor: string, reason: string): Promise<void> {
    const name = this.requireGate(gate);
    await this.store.updateGate(capabilityId, name, {
      status: 'failed',
      passedAt: Date.now(),
      passedBy: actor,
      notes: reason,
    });
    const cap = await this.store.getCapability(capabilityId);
    if (cap?.userPrompt) {
      const observations = await this.store.getObservations(0, { includeIgnored: true });
      const match = observations.find((o) => o.pattern === cap.userPrompt || o.pattern.includes(cap.name));
      if (match) {
        await this.store.updateObservation(match.id, {
          acknowledged: false,
          confidence: Math.max(0.2, match.confidence * 0.8),
        });
      }
    }
  }

  async getNextGate(capabilityId: string): Promise<GraduationGate | null> {
    const cap = await this.store.getCapability(capabilityId);
    if (!cap) throw new CapabilityNotFoundError(capabilityId);
    const gates = await this.store.getGates(capabilityId);
    const order = cap.kind === 'tool' ? TOOL_GATES : SKILL_GATES;
    for (const name of order) {
      const gate = gates.find((g) => g.gate === name);
      if (!gate) return emptyGate(name);
      if (gate.status === 'pending') return gate;
      if (gate.status === 'failed') return gate;
    }
    return null;
  }

  isTrialExpired(capability: Capability, trialDurationMs: number, trialMaxUses: number): boolean {
    if (capability.status !== 'in-trial') return false;
    if (trialMaxUses > 0 && capability.trialCount >= trialMaxUses) return true;
    if (trialDurationMs > 0 && Date.now() - capability.createdAt >= trialDurationMs) return true;
    return false;
  }

  async isEligibleForPromotion(capabilityId: string): Promise<boolean> {
    const next = await this.getNextGate(capabilityId);
    return next === null;
  }

  private requireGate(gate: string): GraduationGateName {
    if (gate === 'sandbox' || gate === 'trial' || gate === 'user-approval') return gate;
    throw new CapabilityGraduationError(`Unknown gate: ${gate}`);
  }
}

export type { SkillCapability, ToolCapability };
