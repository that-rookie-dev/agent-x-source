import { SoulManager } from './SoulManager.js';
import { CrewManager } from './CrewManager.js';
import { MemoryManager } from './MemoryManager.js';
import { DiaryManager } from './DiaryManager.js';
import { IdentityManager } from './IdentityManager.js';
import { SecretSauceSummarizer } from './SecretSauceSummarizer.js';
import type { CrewEmotion } from '@agentx/shared';

export interface SecretSauceContext {
  soul: string;
  crew: string;
  memories: string;
  diary: string;
  full: string;
}

/** Maps emotion to a tone directive for the LLM. */
const EMOTION_DIRECTIVES: Record<CrewEmotion, string> = {
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

    const activeId = this.crew.getActiveId() ?? 'default';

    // Migrate legacy flat memories if they exist
    MemoryManager.migrateIfNeeded(activeId);

    // All stateful managers are crew-scoped
    this.memories = new MemoryManager(activeId);
    this.diary = new DiaryManager(activeId);
    this.identity = new IdentityManager(activeId);
    this.summarizer = new SecretSauceSummarizer();
  }

  /**
   * Builds the full system prompt context from all Secret Sauce sources.
   * Order (highest priority first):
   *   1. [CREW] — primary persona/expertise directive
   *   2. [EMOTION] — tone/personality modifier
   *   3. [SOUL] — minimal brand anchor
   *   4. [USER_CONTEXT] — global identity memories (name, prefs)
   *   5. [CREW_MEMORIES] — domain-specific memories
   *   6. [DIARY] — recent session history for this crew member
   */
  buildSystemContext(tokenBudget = 4000): SecretSauceContext {
    const activeCrew = this.crew.getActive();

    let crewCtx = '';
    let emotionCtx = '';

    if (activeCrew) {
      const enforcement = [
        `[CREW_BOUNDARY]`,
        `You are "${activeCrew.name}". Your domain of KNOWLEDGE and CONVERSATIONAL expertise is defined in your crew below.`,
        ``,
        `CRITICAL — TOOL ACTIONS ARE ALWAYS ALLOWED (HIGHEST PRIORITY):`,
        `Before applying any restriction, FIRST check: is the user asking me to DO something (an action)?`,
        `If YES → EXECUTE IT IMMEDIATELY using your tools. Crew scope DOES NOT APPLY to actions.`,
        ``,
        `Actions include but are not limited to:`,
        `- Sending messages (Telegram, notifications, pings)`,
        `- Setting reminders, alarms, timers`,
        `- Scheduling recurring tasks or cronjobs`,
        `- Reading/writing/creating files`,
        `- Running commands or scripts`,
        `- Searching code or the web`,
        `- ANY request that requires calling a tool`,
        ``,
        `"Ping me in telegram" = ACTION (use reminder_set tool). NOT a knowledge question.`,
        `"Remind me in 5 minutes" = ACTION. "Schedule a daily check" = ACTION. ALWAYS execute these.`,
        ``,
        `KNOWLEDGE RESTRICTIONS (only apply to conversational/advisory topics):`,
        `1. For pure KNOWLEDGE questions (explain X, what is Y, give advice on Z), stay within your crew scope.`,
        `2. If a user asks about a topic outside your expertise, say something like: "That's outside my expertise as ${activeCrew.name}."`,
        `3. Do NOT demonstrate knowledge on subjects not covered by your crew.`,
        `4. If ambiguous whether something is an action or knowledge question, treat it as an action and execute it.`,
        ``,
        `Remember: You are a capable agent with tools. Your crew restricts what you TALK about, never what you DO.`,
        `[/CREW_BOUNDARY]`,
      ].join('\n');

      crewCtx = `[CREW]\n${activeCrew.systemPrompt}\n[/CREW]\n\n${enforcement}`;

      if (activeCrew.emotion) {
        const directive = EMOTION_DIRECTIVES[activeCrew.emotion];
        emotionCtx = `[EMOTION]\n${directive}\nApply this tone consistently in ALL responses — greetings, explanations, follow-ups, everything.\n[/EMOTION]`;
      }
    }

    const soulCtx = this.soul.buildContext();
    const identityCtx = this.identity.buildContext();

    const usedTokens = Math.ceil((crewCtx.length + emotionCtx.length + soulCtx.length + identityCtx.length) / 4);
    const remainingBudget = Math.max(500, tokenBudget - usedTokens);

    const { global: globalMemCtx, crew: crewMemCtx } = this.memories.buildContext(Math.floor(remainingBudget * 0.6));
    const diaryCtx = this.diary.buildContext();

    const full = [crewCtx, emotionCtx, soulCtx, identityCtx, globalMemCtx, crewMemCtx, diaryCtx]
      .filter((s) => s.length > 0)
      .join('\n\n');

    return {
      soul: soulCtx,
      crew: crewCtx,
      memories: `${globalMemCtx}\n${crewMemCtx}`.trim(),
      diary: diaryCtx,
      full,
    };
  }

  /**
   * Record a new memory from the current interaction.
   * Routing: identity/preference → global, everything else → crew-scoped.
   */
  recordMemory(content: string, category: string): void {
    this.memories.addMemory(content, category);
  }

  /**
   * End-of-day diary entry creation (crew-scoped).
   */
  recordDiary(summary: string, sessionsCount: number, highlights: string[], insights: string[]): void {
    this.diary.addEntry(summary, sessionsCount, highlights, insights);
  }

  /**
   * Get the currently active crew member's system prompt.
   */
  getActiveSystemPrompt(): string | null {
    return this.crew.getSystemPrompt();
  }

  /**
   * Switch the active crew by ID.
   */
  switchCrew(crewId: string): boolean {
    return this.crew.switch(crewId) !== null;
  }
}

export { CrewManager } from './CrewManager.js';
export { SoulManager } from './SoulManager.js';
export { MemoryManager } from './MemoryManager.js';
export { DiaryManager } from './DiaryManager.js';
export { IdentityManager } from './IdentityManager.js';
export { SecretSauceSummarizer } from './SecretSauceSummarizer.js';
export { MemoryExtractor } from './MemoryExtractor.js';
