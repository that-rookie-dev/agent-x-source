import { describe, it, expect } from 'vitest';
import {
  formatMarkdownDateGroupLabel,
  groupMarkdownDocumentsByDay,
  localDayKeyFromIso,
} from '../src/markdown/markdown-list-groups';
import type { MarkdownDocumentRecord } from '../src/api';

function doc(id: string, createdAt: string): MarkdownDocumentRecord {
  return {
    id,
    sessionId: 's1',
    title: id,
    excerpt: '',
    filePath: `markdown/${id}/content.md`,
    contentFormat: 'markdown',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('markdown-list-groups', () => {
  const now = new Date(2026, 6, 11, 14, 30); // 11 July 2026 local

  it('labels today and yesterday', () => {
    const todayKey = localDayKeyFromIso(now.toISOString());
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDayKeyFromIso(yesterday.toISOString());

    expect(formatMarkdownDateGroupLabel(todayKey, now)).toBe('TODAY');
    expect(formatMarkdownDateGroupLabel(yesterdayKey, now)).toBe('YESTERDAY');
  });

  it('formats older dates with weekday and ordinal', () => {
    const key = '2026-07-09';
    expect(formatMarkdownDateGroupLabel(key, now)).toBe('Thursday, 9th July 2026');
  });

  it('groups documents by day newest first', () => {
    const today = new Date(2026, 6, 11, 10, 0);
    const yesterday = new Date(2026, 6, 10, 9, 0);
    const older = new Date(2026, 6, 9, 8, 0);

    const groups = groupMarkdownDocumentsByDay(
      [
        doc('a', today.toISOString()),
        doc('b', yesterday.toISOString()),
        doc('c', older.toISOString()),
        doc('d', today.toISOString()),
      ],
      now,
    );

    expect(groups.map((g) => g.label)).toEqual([
      'TODAY',
      'YESTERDAY',
      'Thursday, 9th July 2026',
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'd']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['c']);
  });
});
