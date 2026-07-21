import { describe, expect, it } from 'vitest';
import {
  MENTION_TOKEN_SPLIT_RE,
  formatFileMentionToken,
  formatFolderMentionToken,
  formatCrewMentionToken,
  parseFileMentionToken,
  parseFolderMentionToken,
  parseCrewMentionToken,
  isCompleteMentionToken,
  findActiveMentionQuery,
} from '../src/chat/mention-tokens';

describe('mention tokens — bracket delimiters', () => {
  it('keeps trailing ? outside a file chip token', () => {
    const tok = formatFileMentionToken('docs/FILE_NAME.EXT');
    expect(tok).toBe('@file[docs%2FFILE_NAME.EXT]');
    const text = `Explain me what is this ${tok}?`;
    const parts = text.split(MENTION_TOKEN_SPLIT_RE).filter(Boolean);
    expect(parts).toEqual([
      'Explain me what is this ',
      '@file[docs%2FFILE_NAME.EXT]',
      '?',
    ]);
    const parsed = parseFileMentionToken(tok);
    expect(parsed).toEqual({ relativePath: 'docs/FILE_NAME.EXT', name: 'FILE_NAME.EXT' });
    expect(parsed!.name.endsWith('?')).toBe(false);
  });

  it('keeps trailing punctuation outside folder and crew tokens', () => {
    const folder = formatFolderMentionToken('bills');
    const crew = formatCrewMentionToken('alice', 'Alice');
    const text = `Ask ${crew} about ${folder}!`;
    const parts = text.split(MENTION_TOKEN_SPLIT_RE).filter(Boolean);
    expect(parts.at(-1)).toBe('!');
    expect(parseFolderMentionToken(folder)?.relativePath).toBe('bills');
    expect(parseCrewMentionToken(crew)).toEqual({ callsign: 'alice', name: 'Alice' });
  });

  it('treats closed bracket tokens as complete', () => {
    expect(isCompleteMentionToken('@file[a%2Fb.txt]')).toBe(true);
    expect(isCompleteMentionToken('@folder[.]')).toBe(true);
    expect(isCompleteMentionToken('@crew[alice:Alice]')).toBe(true);
    expect(isCompleteMentionToken('@file[incomplete')).toBe(false);
  });

  it('does not reopen mention menu after a closed file token + ?', () => {
    const tok = formatFileMentionToken('a.txt');
    expect(findActiveMentionQuery(`see ${tok}?`)).toBeNull();
  });

  it('still parses legacy colon tokens without absorbing ? into the path when split', () => {
    const text = 'see @file:docs/a.txt?';
    const parts = text.split(MENTION_TOKEN_SPLIT_RE).filter(Boolean);
    expect(parts).toContain('@file:docs/a.txt');
    expect(parts.at(-1)).toBe('?');
    expect(parseFileMentionToken('@file:docs/a.txt')).toEqual({
      relativePath: 'docs/a.txt',
      name: 'a.txt',
    });
  });
});
