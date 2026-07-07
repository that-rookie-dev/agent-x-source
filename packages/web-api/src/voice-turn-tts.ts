/** Sentence boundaries for incremental voice TTS. */
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])(?:\s+|$)/;
const MAX_CLAUSE_CHARS = 220;

export function splitSpeakUnits(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sentences = trimmed.split(SENTENCE_BOUNDARY_RE).map((s) => s.trim()).filter(Boolean);
  const units: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CLAUSE_CHARS) {
      units.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > MAX_CLAUSE_CHARS) {
      const slice = rest.slice(0, MAX_CLAUSE_CHARS);
      const breakAt = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf(' '));
      const cut = breakAt > 40 ? breakAt : MAX_CLAUSE_CHARS;
      units.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) units.push(rest);
  }
  return units;
}

/** Pull fully-terminated speak units from a streaming buffer. */
export function drainSpeakUnits(buffer: string): { units: string[]; remainder: string } {
  if (!buffer.trim()) return { units: [], remainder: buffer };
  const units: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = SENTENCE_BOUNDARY_RE.exec(rest);
    if (!match || match.index === undefined) break;
    const end = match.index + match[0].length;
    const piece = rest.slice(0, end).trim();
    rest = rest.slice(end);
    if (piece) units.push(piece);
  }
  if (rest.length >= MAX_CLAUSE_CHARS) {
    const slice = rest.slice(0, MAX_CLAUSE_CHARS);
    const breakAt = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf(' '));
    const cut = breakAt > 40 ? breakAt : MAX_CLAUSE_CHARS;
    units.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  return { units, remainder: rest };
}

export interface VoiceTurnTimings {
  sttMs: number;
  thinkingMs: number;
  ttsMs: number;
  totalMs: number;
  firstAudioMs: number;
}

/** Incrementally speaks completed sentence units as agent text streams in. */
export class VoiceStreamSpeakPipeline {
  private buffer = '';
  private chain: Promise<void> = Promise.resolve();
  private hadStreamed = false;

  constructor(private readonly speakUnit: (text: string) => Promise<void>) {}

  get streamed(): boolean {
    return this.hadStreamed;
  }

  feed(delta: string): void {
    if (!delta) return;
    this.hadStreamed = true;
    this.buffer += delta;
    const { units, remainder } = drainSpeakUnits(this.buffer);
    this.buffer = remainder;
    for (const unit of units) {
      this.enqueue(unit);
    }
  }

  private enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.chain = this.chain.then(() => this.speakUnit(trimmed));
  }

  async flush(fullNormalized?: string): Promise<void> {
    if (this.hadStreamed) {
      const tail = this.buffer.trim();
      if (tail) this.enqueue(tail);
      this.buffer = '';
      await this.chain;
      return;
    }
    if (fullNormalized?.trim()) {
      await this.speakUnit(fullNormalized.trim());
    }
  }
}

export class VoiceTurnTimingTracker {
  private readonly startedAt = Date.now();
  private sttMs = 0;
  private thinkingMs = 0;
  private ttsMs = 0;
  private firstAudioMs = 0;
  private agentStartedAt = 0;
  private firstAudioAt = 0;

  markSttDone(): void {
    this.sttMs = Date.now() - this.startedAt;
  }

  markAgentStarted(): void {
    this.agentStartedAt = Date.now();
  }

  markFirstAudio(): void {
    if (this.firstAudioAt) return;
    this.firstAudioAt = Date.now();
    if (this.agentStartedAt) {
      this.thinkingMs = this.firstAudioAt - this.agentStartedAt;
    }
    this.firstAudioMs = this.firstAudioAt - this.startedAt;
  }

  addTtsMs(ms: number): void {
    this.ttsMs += ms;
  }

  snapshot(): VoiceTurnTimings {
    const totalMs = Date.now() - this.startedAt;
    const thinkingMs = this.thinkingMs
      || (this.agentStartedAt && !this.firstAudioAt ? Date.now() - this.agentStartedAt : 0);
    return {
      sttMs: this.sttMs,
      thinkingMs,
      ttsMs: this.ttsMs,
      totalMs,
      firstAudioMs: this.firstAudioMs,
    };
  }
}
