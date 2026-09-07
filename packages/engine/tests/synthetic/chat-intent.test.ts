import { describe, it, expect } from 'vitest';
import { detectsCapabilityCreateIntent } from '../../src/synthetic/chat-intent.js';

describe('detectsCapabilityCreateIntent', () => {
  it('matches explicit reusable skill/tool asks', () => {
    expect(detectsCapabilityCreateIntent('Create a reusable skill for meeting notes')).toBe(true);
    expect(detectsCapabilityCreateIntent('Turn this into a tool I can reuse')).toBe(true);
    expect(detectsCapabilityCreateIntent('Remember this as a skill for later')).toBe(true);
  });

  it('ignores ordinary create-file requests', () => {
    expect(detectsCapabilityCreateIntent('create a file named notes.md')).toBe(false);
    expect(detectsCapabilityCreateIntent('make a commit')).toBe(false);
  });
});
