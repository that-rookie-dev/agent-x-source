import { generateId, getLogger } from '@agentx/shared';

export interface EmotionEntry {
  id: string;
  sessionId: string | null;
  source: 'user_message' | 'task_outcome' | 'system_event';
  mood: string;
  intensity: number;
  trigger: string | null;
  valence: number;
  createdAt: string;
}

export interface EmotionalState {
  currentMood: string;
  moodIntensity: number;
  moodSince: string | null;
  baselineMood: string;
  emotionalRange: string;       // JSON array of { mood, count }
  moodDecayRate: number;
}

const SENTIMENT_PATTERNS: Array<{ regex: RegExp; mood: string; valence: number; intensity: number }> = [
  { regex: /\b(great|awesome|amazing|perfect|love|excellent|brilliant|fantastic|wonderful)\b/i, mood: 'enthusiastic', valence: 0.7, intensity: 0.7 },
  { regex: /\b(thank you|thanks|appreciate|grateful|helped a lot)\b/i, mood: 'grateful', valence: 0.8, intensity: 0.6 },
  { regex: /\b(broken|error|fails|doesn'?t work|bug|crash|not working|issue)\b/i, mood: 'frustrated', valence: -0.5, intensity: 0.7 },
  { regex: /\b(stuck|confused|unsure|don'?t know|help me|how do I|lost)\b/i, mood: 'anxious', valence: -0.3, intensity: 0.5 },
  { regex: /\b(whatever|fine|ok|meh|sure|alright)\b/i, mood: 'indifferent', valence: -0.1, intensity: 0.3 },
  { regex: /\b(hurry|quick|fast|ASAP|urgent|now|immediately)\b/i, mood: 'impatient', valence: -0.4, intensity: 0.6 },
  { regex: /\b(wow|cool|nice|sweet|damn|whoa|impressive)\b/i, mood: 'impressed', valence: 0.6, intensity: 0.5 },
  { regex: /\b(funny|lol|haha|lmao|hilarious|joke)\b/i, mood: 'playful', valence: 0.4, intensity: 0.4 },
  { regex: /!{2,}/, mood: 'excited', valence: 0.5, intensity: 0.5 },
  { regex: /\?{2,}/, mood: 'curious', valence: 0.1, intensity: 0.3 },
];

export class EmotionEngine {
  private db: any;
  private moodDecayInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: any) {
    this.db = db;
  }

  /** Initialize emotional state on first run. */
  initState(): void {
    try {
      const existing = this.db.prepare('SELECT id FROM agent_emotional_state WHERE id = 1').get();
      if (!existing) {
        this.db.prepare(`INSERT INTO agent_emotional_state (id) VALUES (1)`).run();
      }
    } catch { /* table may not exist yet */ }
  }

  /** Process a user message and return emotional insights. */
  processUserMessage(sessionId: string, message: string): { mood: string; intensity: number; valence: number } {
    const sentiment = this.detectSentiment(message);

    try {
      this.db.prepare(`
        INSERT INTO agent_emotions (id, session_id, source, mood, intensity, trigger, valence)
        VALUES (?, ?, 'user_message', ?, ?, ?, ?)
      `).run(generateId(), sessionId, sentiment.mood, sentiment.intensity, message.slice(0, 200), sentiment.valence);
    } catch { getLogger().warn('EMOTION_ENGINE', 'operation failed (non-critical)'); }

    this.updateCurrentMood(sentiment);
    return sentiment;
  }

  /** Process task outcome (success/failure) and update emotional state. */
  processTaskOutcome(sessionId: string, outcome: 'success' | 'failure', taskDescription?: string): void {
    const mood = outcome === 'success' ? 'confident' : 'careful';
    const valence = outcome === 'success' ? 0.5 : -0.3;
    const intensity = outcome === 'success' ? 0.3 : 0.5;

    try {
      this.db.prepare(`
        INSERT INTO agent_emotions (id, session_id, source, mood, intensity, trigger, valence)
        VALUES (?, ?, 'task_outcome', ?, ?, ?, ?)
      `).run(generateId(), sessionId, mood, intensity, taskDescription?.slice(0, 200) || null, valence);
    } catch { getLogger().warn('EMOTION_ENGINE', 'operation failed (non-critical)'); }

    this.updateCurrentMood({ mood, intensity, valence });
  }

  /** Get tone directive for system prompt. */
  getToneDirective(): string {
    const state = this.getCurrentState();
    if (!state) return '';

    // Map current mood to a tone directive
    const directives: Record<string, string> = {
      frustrated: '[TONE] User seems frustrated. Be direct, avoid lengthy explanations, and focus on resolving the issue immediately. Acknowledge the frustration briefly.',
      anxious: '[TONE] User seems uncertain or anxious. Be supportive, offer clear guidance, and provide reassurance. Break complex tasks into smaller steps.',
      impatient: '[TONE] User wants speed. Skip pleasantries. Get straight to the solution. Be efficient and results-focused.',
      enthusiastic: '[TONE] User is engaged and enthusiastic. Match their energy. Be thorough, proactive, and suggest optimizations.',
      grateful: '[TONE] User is appreciative. Be warm and professional. Continue the quality that earned the gratitude.',
      impressed: '[TONE] User is impressed with the results. Maintain the high standard. Confidence is well-placed.',
      playful: '[TONE] User is in a playful mood. Feel free to be slightly witty, but stay professional and on-task.',
      indifferent: '[TONE] User seems neutral. Be efficient and focused. No need for extra fluff.',
      confident: '[TONE] Task completed successfully. Confidence is high. Continue with proven approaches.',
      careful: '[TONE] Previous task had issues. Be more thorough, double-check outputs, and verify before proceeding.',
    };

    return directives[state.currentMood] || '';
  }

  /** Get the user's current emotional valence for risk adjustment. */
  getUserValence(): number {
    const state = this.getCurrentState();
    if (!state) return 0;

    // Check recent emotions for valence trend
    try {
      const rows = this.db.prepare(
        `SELECT valence FROM agent_emotions WHERE source = 'user_message' ORDER BY created_at DESC LIMIT 5`
      ).all() as Array<{ valence: number }>;
      if (rows.length === 0) return 0;
      return rows.reduce((sum, r) => sum + r.valence, 0) / rows.length;
    } catch { return 0; }
  }

  /** Decay mood toward baseline. Called periodically. */
  decayMood(): void {
    const state = this.getCurrentState();
    if (!state) return;

    const newIntensity = state.moodIntensity * (1 - state.moodDecayRate);
    if (newIntensity < 0.1) {
      try {
        this.db.prepare(`UPDATE agent_emotional_state SET current_mood = ?, mood_intensity = 0.5, updated_at = datetime('now') WHERE id = 1`)
          .run(state.baselineMood);
      } catch { getLogger().warn('EMOTION_ENGINE', 'operation failed (non-critical)'); }
    } else {
      try {
        this.db.prepare(`UPDATE agent_emotional_state SET mood_intensity = ?, updated_at = datetime('now') WHERE id = 1`)
          .run(newIntensity);
      } catch { getLogger().warn('EMOTION_ENGINE', 'operation failed (non-critical)'); }
    }
  }

  /** Start periodic mood decay. */
  startDecayLoop(intervalMs = 5 * 60 * 1000): void {
    this.stopDecayLoop();
    this.moodDecayInterval = setInterval(() => this.decayMood(), intervalMs);
  }

  /** Stop periodic mood decay. */
  stopDecayLoop(): void {
    if (this.moodDecayInterval) {
      clearInterval(this.moodDecayInterval);
      this.moodDecayInterval = null;
    }
  }

  private detectSentiment(message: string): { mood: string; intensity: number; valence: number } {
    for (const pattern of SENTIMENT_PATTERNS) {
      if (pattern.regex.test(message)) {
        return { mood: pattern.mood, intensity: pattern.intensity, valence: pattern.valence };
      }
    }
    return { mood: 'neutral', intensity: 0.3, valence: 0 };
  }

  private updateCurrentMood(sentiment: { mood: string; intensity: number; valence: number }): void {
    try {
      this.db.prepare(`
        UPDATE agent_emotional_state
        SET current_mood = ?, mood_intensity = ?, mood_since = datetime('now'), updated_at = datetime('now')
        WHERE id = 1
      `).run(sentiment.mood, sentiment.intensity);
    } catch { getLogger().warn('EMOTION_ENGINE', 'operation failed (non-critical)'); }
  }

  getCurrentState(): EmotionalState | null {
    try {
      const row = this.db.prepare(
        `SELECT current_mood as "currentMood", mood_intensity as "moodIntensity", mood_since as "moodSince",
                baseline_mood as "baselineMood", emotional_range as "emotionalRange", mood_decay_rate as "moodDecayRate"
         FROM agent_emotional_state WHERE id = 1`
      ).get() as EmotionalState | undefined;
      return row ?? null;
    } catch { return null; }
  }
}
