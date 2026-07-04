import { describe, it, expect } from 'vitest';
import { requiresExecutionIntent } from '../src/agent/plan-mode-utils.js';

describe('requiresExecutionIntent', () => {
  it('returns false for informational TTS/STT recommendation question', () => {
    const msg =
      'which is the best local model to convert text-to-speech and speech-to-text with low latency and less RAM usage?';
    expect(requiresExecutionIntent(msg)).toBe(false);
  });

  it('returns true for explicit edit/delete requests', () => {
    expect(requiresExecutionIntent('delete the config file')).toBe(true);
    expect(requiresExecutionIntent('edit main.ts line 42')).toBe(true);
  });

  it('returns false for create/build requests (allowed in plan mode)', () => {
    expect(requiresExecutionIntent('build a REST API for user authentication')).toBe(false);
  });
});
