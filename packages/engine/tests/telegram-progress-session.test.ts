import { describe, it, expect } from 'vitest';
import {
  formatProgressLoaderFrame,
  formatProgressStatusText,
  formatProgressToolLabel,
  isQuietProgressTool,
  PROGRESS_LOADER_FRAMES,
} from '../src/telegram/TelegramProgressSession.js';

describe('TelegramProgressSession helpers', () => {
  it('treats read-only tools as quiet', () => {
    expect(isQuietProgressTool('file_read')).toBe(true);
    expect(isQuietProgressTool('web_search')).toBe(true);
    expect(isQuietProgressTool('shell')).toBe(false);
    expect(isQuietProgressTool('file_write')).toBe(false);
  });

  it('formats tool labels', () => {
    expect(formatProgressToolLabel('shell')).toBe('Shell command');
    expect(formatProgressToolLabel('some_custom_tool')).toBe('some custom tool');
  });

  it('cycles loader frames: one dot up to four, then back to one', () => {
    expect(formatProgressLoaderFrame(0)).toBe('⏳.');
    expect(formatProgressLoaderFrame(1)).toBe('⏳..');
    expect(formatProgressLoaderFrame(2)).toBe('⏳...');
    expect(formatProgressLoaderFrame(3)).toBe('⏳....');
    expect(formatProgressLoaderFrame(PROGRESS_LOADER_FRAMES.length)).toBe('⏳.');
    expect(formatProgressLoaderFrame(-1)).toBe('⏳....');
  });

  it('always shows the hourglass with at least one dot', () => {
    for (let i = 0; i < 12; i += 1) {
      const frame = formatProgressLoaderFrame(i);
      expect(frame.startsWith('⏳')).toBe(true);
      const dots = frame.length - 1;
      expect(dots).toBeGreaterThanOrEqual(1);
      expect(dots).toBeLessThanOrEqual(4);
    }
  });

  it('formats idle status as loader-only text', () => {
    expect(formatProgressStatusText(null, 5, 2)).toBe('⏳...');
    expect(formatProgressStatusText(null, 5, 2)).not.toContain('Thinking');
    expect(formatProgressStatusText(null, 5, 2)).not.toContain('Got it');
  });

  it('formats status text with activity and elapsed time', () => {
    expect(formatProgressStatusText('Running tests', 12, 1)).toBe('⏳.. Running tests (12s)');
    expect(formatProgressStatusText('Running tests', 12, 1)).toContain('Running tests');
    expect(formatProgressStatusText('Running tests', 12, 1)).toContain('(12s)');
  });
});
