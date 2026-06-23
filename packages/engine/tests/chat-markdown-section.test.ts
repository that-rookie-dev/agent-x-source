import { describe, it, expect } from 'vitest';
import { createChatMarkdownSection } from '../src/secret-sauce/prompt-assembly/sections.js';

describe('createChatMarkdownSection', () => {
  it('exports static chat markdown instructions', async () => {
    const section = createChatMarkdownSection();
    const loaded = await section.load();
    expect(loaded).toContain('[CHAT_MARKDOWN]');
    expect(loaded).toContain('GitHub-Flavored Markdown');
    expect(loaded).toContain('TOOL FILE CONTENT');
    expect(loaded).toContain('file_write');
    expect(loaded).toContain('Do NOT wrap source code');
    expect(section.render(loaded)).toBe(loaded);
  });

  it('does not diff between reconciliations', () => {
    const section = createChatMarkdownSection();
    expect(section.diff('a', 'b')).toBeNull();
  });
});
