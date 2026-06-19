import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';
import type { AgentPersonaConfig } from '@agentx/shared';

interface EvolutionEntry {
  date: string;
  change: string;
  trigger: string;
}

interface IdentityOverlay {
  personality: string;
  traits: string[];
  communicationStyle: string;
  interactionCount: number;
  evolutionLog: EvolutionEntry[];
}

export interface MergedIdentity {
  name: string;
  description: string;
  communicationStyle: string;
  decisionMaking: string;
  domainContext: string;
  traits: string[];
  interactionCount: number;
  evolutionLog: string;
}

const DEFAULT_OVERLAY: IdentityOverlay = {
  personality: '',
  traits: [],
  communicationStyle: '',
  interactionCount: 0,
  evolutionLog: [],
};

export class IdentityManager {
  private overlay: IdentityOverlay;
  private filePath: string;

  constructor(crewId = 'default') {
    const dir = join(getSecretSauceDir(), 'crews', crewId);
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'identity.json');
    this.overlay = this.load();
  }

  private load(): IdentityOverlay {
    if (existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        return {
          personality: raw.personality ?? '',
          traits: Array.isArray(raw.traits) ? raw.traits : [],
          communicationStyle: raw.communicationStyle ?? '',
          interactionCount: raw.interactionCount ?? 0,
          evolutionLog: Array.isArray(raw.evolutionLog) ? raw.evolutionLog : [],
        };
      } catch {
        return { ...DEFAULT_OVERLAY };
      }
    }
    return { ...DEFAULT_OVERLAY };
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.overlay, null, 2));
  }

  /** Seed (or re-seed) with persona config on Agent init. */
  seedFromPersona(persona: AgentPersonaConfig | null): void {
    if (!persona) return;
    const evolved: IdentityOverlay = {
      ...this.overlay,
      personality: this.overlay.personality || persona.description,
      traits: this.overlay.traits.length > 0 ? this.overlay.traits : [...persona.traits],
      communicationStyle: this.overlay.communicationStyle || persona.communicationStyle,
    };
    this.overlay = evolved;
    this.save();
  }

  /** Merge persona config (base) with runtime evolution (overlay). */
  getMergedIdentity(persona: AgentPersonaConfig | null): MergedIdentity {
    const base = {
      name: persona?.name ?? 'Agent-X',
      description: persona?.description ?? '',
      communicationStyle: persona?.communicationStyle ?? 'direct',
      decisionMaking: persona?.decisionMaking ?? 'balanced',
      domainContext: persona?.domainContext ?? '',
      traits: persona?.traits ?? [],
    };

    const merged: MergedIdentity = {
      name: base.name,
      description: this.overlay.personality || base.description,
      communicationStyle: this.overlay.communicationStyle || base.communicationStyle,
      decisionMaking: base.decisionMaking,
      domainContext: base.domainContext,
      traits: this.overlay.traits.length > 0 ? this.overlay.traits : base.traits,
      interactionCount: this.overlay.interactionCount,
      evolutionLog: this.formatEvolutionLog(),
    };

    return merged;
  }

  private formatEvolutionLog(): string {
    const recent = this.overlay.evolutionLog.slice(-5);
    if (recent.length === 0) return '';
    const entries = recent.map((e) => `  - ${e.change} (${e.date.split('T')[0]})`);
    return `Recent evolution:\n${entries.join('\n')}`;
  }

  recordInteraction(): void {
    this.overlay.interactionCount++;
    this.save();
  }

  evolveTrait(oldTrait: string, newTrait: string, trigger: string): void {
    const idx = this.overlay.traits.indexOf(oldTrait);
    if (idx >= 0) {
      this.overlay.traits[idx] = newTrait;
    } else {
      this.overlay.traits.push(newTrait);
    }
    this.overlay.evolutionLog.push({
      date: new Date().toISOString(),
      change: `Trait evolved: "${oldTrait}" → "${newTrait}"`,
      trigger,
    });
    if (this.overlay.evolutionLog.length > 50) {
      this.overlay.evolutionLog = this.overlay.evolutionLog.slice(-50);
    }
    this.save();
  }

  updateCommunicationStyle(style: string, trigger: string): void {
    if (this.overlay.communicationStyle !== style) {
      this.overlay.evolutionLog.push({
        date: new Date().toISOString(),
        change: `Style: "${this.overlay.communicationStyle || 'default'}" → "${style}"`,
        trigger,
      });
      this.overlay.communicationStyle = style;
      this.save();
    }
  }

  getEvolutionLog(): EvolutionEntry[] {
    return [...this.overlay.evolutionLog];
  }

  getInteractionCount(): number {
    return this.overlay.interactionCount;
  }
}
