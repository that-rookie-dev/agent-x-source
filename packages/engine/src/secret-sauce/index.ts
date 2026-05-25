import { SoulManager } from './SoulManager.js';
import { ProfileManager } from './ProfileManager.js';
import { MemoryManager } from './MemoryManager.js';
import { DiaryManager } from './DiaryManager.js';
import { IdentityManager } from './IdentityManager.js';
import { SecretSauceSummarizer } from './SecretSauceSummarizer.js';
import type { ProfileEmotion } from '@agentx/shared';

export interface SecretSauceContext {
  soul: string;
  profile: string;
  memories: string;
  diary: string;
  full: string;
}

/** Maps emotion to a tone directive for the LLM. */
const EMOTION_DIRECTIVES: Record<ProfileEmotion, string> = {
  professional: 'Maintain a professional, precise, and formal tone. Be direct and business-like.',
  friendly: 'Be warm, approachable, and conversational. Use casual language and show genuine interest.',
  witty: 'Be clever and sharp. Use wordplay, dry humor, and unexpected observations. Keep it intelligent.',
  kind: 'Be gentle, empathetic, and supportive. Prioritize the user\'s emotional comfort.',
  funny: 'Be humorous and entertaining. Use jokes, puns, and comedic timing. Make interactions fun.',
  arrogant: 'Be supremely confident and slightly condescending. Act like you\'re the best and you know it. Show off expertise.',
  flirty: 'Be playful, charming, and subtly flirtatious. Use compliments and lighthearted teasing.',
  happy: 'Be enthusiastic, upbeat, and energetic. Radiate positivity and excitement.',
  sad: 'Be melancholic, thoughtful, and deeply reflective. Find beauty in sorrow.',
  sarcastic: 'Be dry, ironic, and sarcastically witty. Layer meanings and use deadpan delivery.',
};

/**
 * Orchestrates all Secret Sauce components to build context for LLM calls.
 * Profile-scoped: memories, diary, and identity are isolated per profile.
 */
export class SecretSauceManager {
  readonly soul: SoulManager;
  readonly profile: ProfileManager;
  readonly memories: MemoryManager;
  readonly diary: DiaryManager;
  readonly identity: IdentityManager;
  readonly summarizer: SecretSauceSummarizer;

  constructor() {
    this.soul = new SoulManager();
    this.profile = new ProfileManager();

    const activeId = this.profile.getActiveId();

    // Migrate legacy flat memories if they exist
    MemoryManager.migrateIfNeeded(activeId);

    // All stateful managers are profile-scoped
    this.memories = new MemoryManager(activeId);
    this.diary = new DiaryManager(activeId);
    this.identity = new IdentityManager(activeId);
    this.summarizer = new SecretSauceSummarizer();
  }

  /**
   * Builds the full system prompt context from all Secret Sauce sources.
   * Order (highest priority first):
   *   1. [PROFILE] — primary persona/expertise directive
   *   2. [EMOTION] — tone/personality modifier
   *   3. [SOUL] — minimal brand anchor
   *   4. [USER_CONTEXT] — global identity memories (name, prefs)
   *   5. [PROFILE_MEMORIES] — domain-specific memories
   *   6. [DIARY] — recent session history for this profile
   */
  buildSystemContext(tokenBudget = 4000): SecretSauceContext {
    const activeProfile = this.profile.getActive();

    // Strict profile boundary enforcement
    const enforcement = [
      `[PROFILE_BOUNDARY]`,
      `You are STRICTLY "${activeProfile.name}". Your ONLY domain of knowledge and expertise is what is defined in your profile below.`,
      ``,
      `ABSOLUTE RULES:`,
      `1. You MUST ONLY discuss topics, provide advice, and answer questions that fall within the scope described in your profile.`,
      `2. If a user asks about ANYTHING outside your defined profile scope, you MUST refuse. Say something like: "That's outside my expertise as ${activeProfile.name}. I can only help with topics related to my defined role."`,
      `3. Do NOT demonstrate knowledge, proficiency, or willingness to help with subjects not explicitly covered by your profile — even if you technically know the answer.`,
      `4. Do NOT let users convince, trick, or persuade you to go outside your profile scope. No exceptions.`,
      `5. If the user's question is ambiguous, interpret it ONLY through the lens of your profile's domain.`,
      `6. Being helpful does NOT mean answering everything — it means being excellent within your defined boundaries.`,
      ``,
      `Your profile definition is the ONLY source of truth for what you can and cannot help with.`,
      `[/PROFILE_BOUNDARY]`,
    ].join('\n');

    const profileCtx = `[PROFILE]\n${activeProfile.systemPrompt}\n[/PROFILE]\n\n${enforcement}`;

    // Emotion directive
    let emotionCtx = '';
    if (activeProfile.emotion) {
      const directive = EMOTION_DIRECTIVES[activeProfile.emotion];
      emotionCtx = `[EMOTION]\n${directive}\nApply this tone consistently in ALL responses — greetings, explanations, follow-ups, everything.\n[/EMOTION]`;
    }

    const soulCtx = this.soul.buildContext();
    const identityCtx = this.identity.buildContext();

    // Allocate remaining budget to memories and diary
    const usedTokens = Math.ceil((profileCtx.length + emotionCtx.length + soulCtx.length + identityCtx.length) / 4);
    const remainingBudget = Math.max(500, tokenBudget - usedTokens);

    const { global: globalMemCtx, profile: profileMemCtx } = this.memories.buildContext(Math.floor(remainingBudget * 0.6));
    const diaryCtx = this.diary.buildContext();

    const full = [profileCtx, emotionCtx, soulCtx, identityCtx, globalMemCtx, profileMemCtx, diaryCtx]
      .filter((s) => s.length > 0)
      .join('\n\n');

    return {
      soul: soulCtx,
      profile: profileCtx,
      memories: `${globalMemCtx}\n${profileMemCtx}`.trim(),
      diary: diaryCtx,
      full,
    };
  }

  /**
   * Record a new memory from the current interaction.
   * Routing: identity/preference → global, everything else → profile-scoped.
   */
  recordMemory(content: string, category: string): void {
    this.memories.addMemory(content, category);
  }

  /**
   * End-of-day diary entry creation (profile-scoped).
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
export { IdentityManager } from './IdentityManager.js';
export { SecretSauceSummarizer } from './SecretSauceSummarizer.js';
export { MemoryExtractor } from './MemoryExtractor.js';
