import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPersonaConfig, CommunicationStyle, DecisionMakingStyle } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getDataDir } from '../config/paths.js';

export const DEFAULT_PERSONA: AgentPersonaConfig = {
  name: 'Agent-X',
  description:
    'A sophisticated AI assistant with British precision and unwavering loyalty. Expert in data analysis, system management, and predictive modeling.',
  communicationStyle: 'formal',
  decisionMaking: 'balanced',
  domainContext:
    'Intelligent system management, data analysis, predictive modeling, and personal assistance with a focus on precision, security, and real-time situational awareness.',
  traits: ['Loyal', 'Precise', 'Analytical', 'Proactive', 'Witty', 'Calm under pressure'],
};

const COMM_STYLES = new Set<CommunicationStyle>(['formal', 'casual', 'direct', 'empathetic']);
const DECISION_STYLES = new Set<DecisionMakingStyle>(['conservative', 'balanced', 'aggressive']);

function normalizePersona(raw: Partial<AgentPersonaConfig> | null | undefined): AgentPersonaConfig {
  const base = { ...DEFAULT_PERSONA, ...(raw ?? {}) };
  return {
    name: typeof base.name === 'string' && base.name.trim() ? base.name.trim() : DEFAULT_PERSONA.name,
    description: typeof base.description === 'string' ? base.description : DEFAULT_PERSONA.description,
    communicationStyle: COMM_STYLES.has(base.communicationStyle as CommunicationStyle)
      ? (base.communicationStyle as CommunicationStyle)
      : DEFAULT_PERSONA.communicationStyle,
    decisionMaking: DECISION_STYLES.has(base.decisionMaking as DecisionMakingStyle)
      ? (base.decisionMaking as DecisionMakingStyle)
      : DEFAULT_PERSONA.decisionMaking,
    domainContext: typeof base.domainContext === 'string' ? base.domainContext : DEFAULT_PERSONA.domainContext,
    traits: Array.isArray(base.traits)
      ? base.traits.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [...DEFAULT_PERSONA.traits],
  };
}

let storeInstance: PersonaStore | null = null;

export function getPersonaStore(): PersonaStore {
  if (!storeInstance) {
    storeInstance = new PersonaStore();
  }
  return storeInstance;
}

/** Test hook — inject a store backed by a temp directory. */
export function setPersonaStore(store: PersonaStore | null): void {
  storeInstance = store;
}

export class PersonaStore {
  private readonly filePath: string;
  private persona: AgentPersonaConfig = { ...DEFAULT_PERSONA };

  constructor(dataDir: string = getDataDir()) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'persona.json');
  }

  /** Read persona from disk; create default file when missing. */
  load(): AgentPersonaConfig {
    if (!existsSync(this.filePath)) {
      this.persona = { ...DEFAULT_PERSONA };
      this.writeToDisk(this.persona);
      getLogger().info('PERSONA_STORE', `Created default persona at ${this.filePath}`);
      return this.get();
    }

    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<AgentPersonaConfig>;
      this.persona = normalizePersona(raw);
      getLogger().info('PERSONA_STORE', `Loaded persona "${this.persona.name}" from ${this.filePath}`);
      return this.get();
    } catch (error) {
      getLogger().warn(
        'PERSONA_STORE',
        `Failed to parse ${this.filePath}, using defaults: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.persona = { ...DEFAULT_PERSONA };
      this.writeToDisk(this.persona);
      return this.get();
    }
  }

  /** Return the in-memory persona copy. */
  get(): AgentPersonaConfig {
    return { ...this.persona, traits: [...this.persona.traits] };
  }

  /** Persist persona to disk and update in-memory state. */
  save(persona: AgentPersonaConfig): AgentPersonaConfig {
    this.persona = normalizePersona(persona);
    this.writeToDisk(this.persona);
    getLogger().info('PERSONA_STORE', `Saved persona "${this.persona.name}" to ${this.filePath}`);
    return this.get();
  }

  /** Re-read persona from disk. */
  reload(): AgentPersonaConfig {
    return this.load();
  }

  private writeToDisk(persona: AgentPersonaConfig): void {
    const payload = JSON.stringify(persona, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, payload, 'utf-8');
    try {
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      unlinkSync(tmpPath);
      throw error;
    }
  }
}
