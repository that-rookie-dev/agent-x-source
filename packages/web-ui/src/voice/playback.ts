import { int16ToFloat32 } from './pcm.js';

export class StreamingPlayback {
  private context: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private readonly defaultSampleRate: number;
  private lastChunks: Array<{ pcm: Int16Array; sampleRate: number }> = [];

  constructor(defaultSampleRate = 24_000) {
    this.defaultSampleRate = defaultSampleRate;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
      this.nextStartTime = this.context.currentTime;
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context;
  }

  async enqueuePcm(pcm: Int16Array, sampleRate = this.defaultSampleRate): Promise<void> {
    this.lastChunks.push({ pcm, sampleRate });
    const ctx = await this.ensureContext();
    const floats = int16ToFloat32(pcm);
    const channel = new Float32Array(floats);
    const buffer = ctx.createBuffer(1, channel.length, sampleRate);
    buffer.copyToChannel(channel, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      this.scheduleIdleNotify();
    };
  }

  private onIdle: (() => void) | null = null;
  private notifyIdleScheduled = false;

  setOnIdle(handler: (() => void) | null): void {
    this.onIdle = handler;
  }

  private scheduleIdleNotify(): void {
    if (!this.onIdle || this.activeSources.length > 0 || this.notifyIdleScheduled) return;
    this.notifyIdleScheduled = true;
    window.setTimeout(() => {
      this.notifyIdleScheduled = false;
      if (this.activeSources.length === 0) {
        this.onIdle?.();
      }
    }, 0);
  }

  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    if (this.context) {
      this.nextStartTime = this.context.currentTime;
    }
    this.scheduleIdleNotify();
  }

  async replayLast(): Promise<void> {
    if (this.lastChunks.length === 0) return;
    this.stop();
    for (const chunk of this.lastChunks) {
      await this.enqueuePcm(chunk.pcm, chunk.sampleRate);
    }
  }

  clearHistory(): void {
    this.lastChunks = [];
  }

  get playing(): boolean {
    return this.activeSources.length > 0;
  }

  async close(): Promise<void> {
    this.stop();
    this.clearHistory();
    await this.context?.close();
    this.context = null;
    this.nextStartTime = 0;
  }
}

export function decodeBinaryAudioChunk(data: ArrayBuffer): Int16Array {
  return new Int16Array(data);
}
