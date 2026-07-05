import { describe, it, expect } from 'vitest';
import {
  formatProgressStatusText,
  formatProgressToolLabel,
  isQuietProgressTool,
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

  it('formats status text with activity and elapsed time', () => {
    expect(formatProgressStatusText('Running tests', 12)).toContain('Running tests');
    expect(formatProgressStatusText('Running tests', 12)).toContain('(12s)');
    expect(formatProgressStatusText(null, 5)).toContain('Thinking…');
    expect(formatProgressStatusText(null, 5)).toContain('(5s)');
  });
});
