import { generateId, type Capability, type CapabilityMeta, type SkillCapability, type ToolCapability } from '@agentx/shared';
import type { CapabilityStore } from './interfaces.js';
import { slugName } from './json.js';

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export class CapabilityMerger {
  constructor(private store: CapabilityStore) {}

  async findOverlapping(minScore = 0.55): Promise<Array<[string, string]>> {
    const caps = [
      ...(await this.store.getCapabilities('registered', undefined, 200, 0)),
      ...(await this.store.getCapabilities('in-trial', undefined, 80, 0)),
    ];
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const left = caps[i]!;
        const right = caps[j]!;
        if (left.kind !== right.kind) continue;
        const score = jaccard(
          tokens(`${left.name} ${left.description}`),
          tokens(`${right.name} ${right.description}`),
        );
        if (score >= minScore) pairs.push([left.id, right.id]);
      }
    }
    return pairs;
  }

  async proposeMerge(id1: string, id2: string): Promise<CapabilityMeta> {
    const a = await this.require(id1);
    const b = await this.require(id2);
    if (a.kind !== b.kind) {
      throw new Error('Cannot merge capabilities of different kinds');
    }
    const now = Date.now();
    const name = slugName(`${a.name}-merged`);
    const description = `${a.description} Combined with ${b.name}: ${b.description}`.slice(0, 500);
    const base = {
      id: generateId('cap'),
      name,
      description,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      sourceSessionId: '',
      version: 1,
      origin: 'observed' as const,
      status: 'proposed' as const,
      useCount: 0,
      trialCount: 0,
      generatedBy: 'merger',
      alternatives: [`Merged from ${a.name} + ${b.name}`],
      mergedFrom: [a.id, b.id],
    };
    let merged: Capability;
    if (a.kind === 'tool' && b.kind === 'tool') {
      merged = {
        ...base,
        kind: 'tool',
        language: a.language,
        sourceCode: a.sourceCode,
        entryPoint: a.entryPoint,
        inputSchema: { ...asObject(b.inputSchema), ...asObject(a.inputSchema) },
        outputSchema: { ...asObject(b.outputSchema), ...asObject(a.outputSchema) },
        dependencies: [...new Set([...a.dependencies, ...b.dependencies])],
        sideEffects: [...new Set([...a.sideEffects, ...b.sideEffects])],
        approvedSideEffects: [...new Set([...a.approvedSideEffects, ...b.approvedSideEffects])],
        sandboxResult: null,
        originalSourceCode: a.sourceCode,
      };
    } else if (a.kind === 'skill' && b.kind === 'skill') {
      merged = {
        ...base,
        kind: 'skill',
        promptTemplate: `${a.promptTemplate}\n\n---\n\n${b.promptTemplate}`,
        triggerPattern: joinTriggers(a.triggerPattern, b.triggerPattern),
        exampleCalls: [...a.exampleCalls, ...b.exampleCalls],
      } satisfies SkillCapability;
    } else {
      throw new Error('Unsupported merge kinds');
    }
    await this.store.insertCapability(merged);
    return merged;
  }

  async executeMerge(id1: string, id2: string, mergedId: string): Promise<void> {
    await this.require(mergedId);
    await this.store.updateCapabilityStatus(mergedId, 'registered');
    await this.store.updateCapabilityStatus(id1, 'archived');
    await this.store.updateCapabilityStatus(id2, 'archived');
    await this.store.insertAuditEvent({
      id: generateId('cae'),
      capabilityId: mergedId,
      event: 'merged',
      timestamp: Date.now(),
      actor: 'system',
      details: { sources: [id1, id2] },
    });
  }

  private async require(id: string): Promise<Capability> {
    const cap = await this.store.getCapability(id);
    if (!cap) throw new Error(`Capability not found: ${id}`);
    return cap;
  }
}

function asObject(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value && typeof value === 'object' ? value : {};
}

function joinTriggers(a: string, b: string): string {
  if (a === b) return a;
  return `(?:${a})|(?:${b})`;
}

export type { ToolCapability };
