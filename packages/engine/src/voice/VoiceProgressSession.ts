export type VoiceProgressStage =
  | 'ack'
  | 'thinking'
  | 'tool'
  | 'crew'
  | 'waiting'
  | 'final';

export interface VoiceProgressSessionOptions {
  enabled?: boolean;
  speakToolProgress?: boolean;
  onSpeak?: (text: string, stage: VoiceProgressStage) => Promise<void>;
  throttleMs?: number;
  /** Skip the instant "Got it." ack (greetings, mic checks, light chat). */
  skipInitialAck?: boolean;
  /** When ack is skipped, delay heartbeat fillers until the agent runs this long. */
  delayedProgressMs?: number;
}

export class VoiceProgressSession {
  private readonly enabled: boolean;
  private readonly speakToolProgress: boolean;
  private readonly onSpeak?: (text: string, stage: VoiceProgressStage) => Promise<void>;
  private readonly throttleMs: number;
  private readonly skipInitialAck: boolean;
  private readonly delayedProgressMs: number;
  private lastSpokenAt = 0;
  private lastLine = '';
  private readonly turnStartedAt = Date.now();

  constructor(options: VoiceProgressSessionOptions = {}) {
    this.enabled = options.enabled !== false;
    this.speakToolProgress = options.speakToolProgress !== false;
    this.onSpeak = options.onSpeak;
    this.throttleMs = options.throttleMs ?? 2500;
    this.skipInitialAck = options.skipInitialAck === true;
    this.delayedProgressMs = options.delayedProgressMs ?? 8000;
  }

  async handleEngineEvent(event: { type?: string; stage?: string; tool?: string }): Promise<void> {
    if (!this.enabled || !this.onSpeak) return;
    const type = event.type ?? '';
    let line: string | null = null;
    let stage: VoiceProgressStage = 'thinking';

    if (type === 'loading_start') {
      if (this.skipInitialAck) return;
      line = 'Got it.';
      stage = 'ack';
    } else if (type === 'tool_start' && this.speakToolProgress) {
      const tool = event.tool ?? 'tool';
      line = `Running ${tool.replace(/_/g, ' ')}.`;
      stage = 'tool';
    } else if (type === 'crew_activity') {
      line = 'Coordinating with the crew.';
      stage = 'crew';
    } else if (type === 'heartbeat') {
      if (this.skipInitialAck && Date.now() - this.turnStartedAt < this.delayedProgressMs) return;
      line = 'Still working on it.';
      stage = 'waiting';
    }

    if (!line) return;
    await this.speak(line, stage);
  }

  async speak(line: string, stage: VoiceProgressStage = 'thinking'): Promise<void> {
    if (!this.enabled || !this.onSpeak) return;
    const now = Date.now();
    if (line === this.lastLine && now - this.lastSpokenAt < this.throttleMs) return;
    if (now - this.lastSpokenAt < this.throttleMs && stage !== 'ack') return;
    this.lastLine = line;
    this.lastSpokenAt = now;
    await this.onSpeak(line, stage);
  }

  reset(): void {
    this.lastLine = '';
    this.lastSpokenAt = 0;
  }
}
