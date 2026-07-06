import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VoiceConfig } from '@agentx/shared';
export const DEFAULT_FILLER_LINES = [
  'Got it.',
  'One moment.',
  'Checking that now.',
  'Still working on it.',
  'Running a tool.',
  'Almost there.',
  'Let me look into that.',
  'Working on your request.',
];

export interface FillerCacheOptions {
  dataDir: string;
  config: VoiceConfig;
}

export class FillerCache {
  private readonly cacheDir: string;
  private readonly config: VoiceConfig;

  constructor(options: FillerCacheOptions) {
    this.cacheDir = join(options.dataDir, 'voice', 'cache', 'fillers');
    this.config = options.config;
  }

  cacheKey(phrase: string, voiceId: string): string {
    return createHash('sha256').update(`${voiceId}:${phrase}`).digest('hex').slice(0, 16);
  }

  async getCachedPath(phrase: string): Promise<string | null> {
    const voiceId = this.config.tts?.voiceId ?? 'kokoro-af';
    const path = join(this.cacheDir, `${this.cacheKey(phrase, voiceId)}.wav`);
    try {
      await stat(path);
      return path;
    } catch {
      return null;
    }
  }

  async store(phrase: string, wavBytes: Buffer): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true });
    const voiceId = this.config.tts?.voiceId ?? 'kokoro-af';
    const path = join(this.cacheDir, `${this.cacheKey(phrase, voiceId)}.wav`);
    await writeFile(path, wavBytes);
    return path;
  }

  async invalidateForVoice(_voiceId: string): Promise<void> {
    try {
      const files = await readdir(this.cacheDir);
      for (const file of files) {
        if (!file.endsWith('.wav')) continue;
        await rm(join(this.cacheDir, file), { force: true });
      }
    } catch {
      // cache dir may not exist
    }
  }

  listPhrasesToWarm(): string[] {
    return DEFAULT_FILLER_LINES;
  }

  async readCached(phrase: string): Promise<Buffer | null> {
    const path = await this.getCachedPath(phrase);
    if (!path) return null;
    return readFile(path);
  }
}
