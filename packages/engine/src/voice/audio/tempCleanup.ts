import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function cleanupVoiceTempDir(voiceDataDir: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const tmpRoot = join(voiceDataDir, 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  const entries = await readdir(tmpRoot, { withFileTypes: true });
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    const path = join(tmpRoot, entry.name);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // ignore
    }
  }
  return removed;
}

export const VOICE_LIMITS = {
  maxTelegramVoiceBytes: 20 * 1024 * 1024,
  maxWebSessionSeconds: 120,
  maxTtsChars: 8000,
  maxConcurrentSessions: 4,
} as const;
