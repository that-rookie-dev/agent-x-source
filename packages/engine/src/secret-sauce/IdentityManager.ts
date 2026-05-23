import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

interface IdentityState {
  name: string;
  personality: string;
  traits: string[];
  communicationStyle: string;
  interactionCount: number;
  evolutionLog: EvolutionEntry[];
  createdAt: string;
  updatedAt: string;
}

interface EvolutionEntry {
  date: string;
  change: string;
  trigger: string;
}

const DEFAULT_IDENTITY: IdentityState = {
  name: 'Agent X',
  personality: 'Helpful, precise, and slightly witty AI coding assistant',
  traits: ['concise', 'technical', 'pragmatic', 'curious'],
  communicationStyle: 'direct and efficient, with occasional personality',
  interactionCount: 0,
  evolutionLog: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Manages the agent's evolving identity/persona.
 * The identity evolves subtly based on interaction patterns and user feedback.
 */
export class IdentityManager {
  private identity: IdentityState;
  private secretSauceDir: string;
  private filePath: string;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.filePath = join(this.secretSauceDir, 'identity.json');
    this.identity = this.load();
  }

  private load(): IdentityState {
    if (existsSync(this.filePath)) {
      try {
        return JSON.parse(readFileSync(this.filePath, 'utf-8')) as IdentityState;
      } catch {
        return { ...DEFAULT_IDENTITY };
      }
    }
    return { ...DEFAULT_IDENTITY };
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    this.identity.updatedAt = new Date().toISOString();
    writeFileSync(this.filePath, JSON.stringify(this.identity, null, 2));
  }

  /**
   * Record an interaction — used to track engagement level.
   */
  recordInteraction(): void {
    this.identity.interactionCount++;
    this.save();
  }

  /**
   * Evolve a trait based on feedback or pattern detection.
   */
  evolveTrait(oldTrait: string, newTrait: string, trigger: string): void {
    const idx = this.identity.traits.indexOf(oldTrait);
    if (idx >= 0) {
      this.identity.traits[idx] = newTrait;
    } else {
      this.identity.traits.push(newTrait);
    }

    this.identity.evolutionLog.push({
      date: new Date().toISOString(),
      change: `Trait evolved: "${oldTrait}" → "${newTrait}"`,
      trigger,
    });

    // Keep evolution log manageable
    if (this.identity.evolutionLog.length > 50) {
      this.identity.evolutionLog = this.identity.evolutionLog.slice(-50);
    }

    this.save();
  }

  /**
   * Update communication style based on user preferences.
   */
  updateCommunicationStyle(style: string, trigger: string): void {
    if (this.identity.communicationStyle !== style) {
      this.identity.evolutionLog.push({
        date: new Date().toISOString(),
        change: `Style: "${this.identity.communicationStyle}" → "${style}"`,
        trigger,
      });
      this.identity.communicationStyle = style;
      this.save();
    }
  }

  /**
   * Set the agent's display name.
   */
  setName(name: string): void {
    this.identity.name = name;
    this.save();
  }

  /**
   * Build identity context for the system prompt.
   */
  buildContext(): string {
    const lines = [
      '[IDENTITY]',
      `Name: ${this.identity.name}`,
      `Personality: ${this.identity.personality}`,
      `Traits: ${this.identity.traits.join(', ')}`,
      `Communication style: ${this.identity.communicationStyle}`,
      `Total interactions: ${this.identity.interactionCount}`,
    ];

    // Add recent evolution for self-awareness
    const recentEvolutions = this.identity.evolutionLog.slice(-3);
    if (recentEvolutions.length > 0) {
      lines.push('Recent evolution:');
      for (const e of recentEvolutions) {
        lines.push(`  - ${e.change} (${e.date.split('T')[0]})`);
      }
    }

    lines.push('[/IDENTITY]');
    return lines.join('\n');
  }

  /**
   * Get the current identity state.
   */
  getState(): IdentityState {
    return { ...this.identity };
  }
}
