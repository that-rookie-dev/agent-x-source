import { SoulManager } from './SoulManager.js';
import { ProfileManager } from './ProfileManager.js';
import { MemoryManager } from './MemoryManager.js';
import { DiaryManager } from './DiaryManager.js';

export interface SecretSauceContext {
  soul: string;
  profile: string;
  memories: string;
  diary: string;
  full: string;
}

/**
 * Orchestrates all Secret Sauce components to build context for LLM calls.
 */
export class SecretSauceManager {
  readonly soul: SoulManager;
  readonly profile: ProfileManager;
  readonly memories: MemoryManager;
  readonly diary: DiaryManager;

  constructor() {
    this.soul = new SoulManager();
    this.profile = new ProfileManager();
    this.memories = new MemoryManager();
    this.diary = new DiaryManager();
  }

  /**
   * Builds the full system prompt context from all Secret Sauce sources.
   */
  buildSystemContext(tokenBudget = 4000): SecretSauceContext {
    const soulCtx = this.soul.buildContext();
    const profilePrompt = this.profile.getSystemPrompt();
    const profileCtx = `[PROFILE]\n${profilePrompt}\n[/PROFILE]`;

    // Allocate remaining budget to memories and diary
    const usedTokens = Math.ceil((soulCtx.length + profileCtx.length) / 4);
    const remainingBudget = Math.max(500, tokenBudget - usedTokens);
    const memBudget = Math.floor(remainingBudget * 0.6);

    const memoriesCtx = this.memories.buildContext(memBudget);
    const diaryCtx = this.diary.buildContext();

    const full = [soulCtx, profileCtx, memoriesCtx, diaryCtx]
      .filter((s) => s.length > 0)
      .join('\n\n');

    return {
      soul: soulCtx,
      profile: profileCtx,
      memories: memoriesCtx,
      diary: diaryCtx,
      full,
    };
  }

  /**
   * Record a new memory from the current interaction.
   */
  recordMemory(content: string, category: string): void {
    this.memories.addMemory(content, category);
  }

  /**
   * End-of-day diary entry creation.
   */
  recordDiary(summary: string, sessionsCount: number, highlights: string[], insights: string[]): void {
    this.diary.addEntry(summary, sessionsCount, highlights, insights);
  }

  /**
   * Get the currently active profile's system prompt.
   */
  getActiveSystemPrompt(): string {
    return this.profile.getSystemPrompt();
  }

  /**
   * Switch the active profile by ID.
   */
  switchProfile(profileId: string): boolean {
    return this.profile.switch(profileId) !== null;
  }
}

export { ProfileManager } from './ProfileManager.js';
export { SoulManager } from './SoulManager.js';
export { MemoryManager } from './MemoryManager.js';
export { DiaryManager } from './DiaryManager.js';
