import { SoulManager } from './SoulManager.js';
import { CrewManager } from './CrewManager.js';
import { MemoryManager } from './MemoryManager.js';
import { DiaryManager } from './DiaryManager.js';
import { IdentityManager } from './IdentityManager.js';
import { SecretSauceSummarizer } from './SecretSauceSummarizer.js';

export interface SecretSauceContext {
  soul: string;
  crew: string;
  memories: string;
  diary: string;
  full: string;
}

/** Maps emotion to a tone directive for the LLM. */


/**
 * Orchestrates all Secret Sauce components to build context for LLM calls.
 * Crew-scoped: memories, diary, and identity are isolated per crew.
 */
export class SecretSauceManager {
  readonly soul: SoulManager;
  readonly crew: CrewManager;
  readonly memories: MemoryManager;
  readonly diary: DiaryManager;
  readonly identity: IdentityManager;
  readonly summarizer: SecretSauceSummarizer;

  constructor() {
    this.soul = new SoulManager();
    this.crew = new CrewManager();

    const scopeId = 'default';

    MemoryManager.migrateIfNeeded(scopeId);

    this.memories = new MemoryManager(scopeId);
    this.diary = new DiaryManager(scopeId);
    this.identity = new IdentityManager(scopeId);
    this.summarizer = new SecretSauceSummarizer();
  }

  buildSystemContext(): SecretSauceContext {
    const multiCrewCtx = this.crew.getMultiCrewSystemPrompt();
    const soulCtx = this.soul.buildContext();
    const identityCtx = this.identity.buildContext();
    const full = [multiCrewCtx, soulCtx, identityCtx].filter(Boolean).join('\n\n');
    return { soul: soulCtx, crew: multiCrewCtx, memories: '', diary: '', full };
  }

  recordMemory(content: string, category: string): void {
    this.memories.addMemory(content, category);
  }

  recordDiary(summary: string, sessionsCount: number, highlights: string[], insights: string[]): void {
    this.diary.addEntry(summary, sessionsCount, highlights, insights);
  }
}

export { CrewManager } from './CrewManager.js';
export { SoulManager } from './SoulManager.js';
export { MemoryManager } from './MemoryManager.js';
export { DiaryManager } from './DiaryManager.js';
export { IdentityManager } from './IdentityManager.js';
export { SecretSauceSummarizer } from './SecretSauceSummarizer.js';
export { MemoryExtractor } from './MemoryExtractor.js';
