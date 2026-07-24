import { describe, it, expect } from 'vitest';
import { groupMarkdownDocumentsByDay } from '../src/markdown/markdown-list-groups';
import type { MarkdownDocumentRecord } from '../src/api';

function doc(
  id: string,
  createdAt: string,
  listDayKey?: string | null,
  listDayLabel?: string | null,
): MarkdownDocumentRecord {
  return {
    id,
    sessionId: 's1',
    title: id,
    excerpt: '',
    filePath: `markdown/${id}/content.md`,
    contentFormat: 'markdown',
    createdAt,
    updatedAt: createdAt,
    listDayKey,
    listDayLabel,
  };
}

describe('markdown-list-groups', () => {
  it('groups by persisted list day fields without recomputing labels', () => {
    const groups = groupMarkdownDocumentsByDay([
      doc('a', '2026-07-11T10:00:00.000Z', '2026-07-11', 'Saturday, 11th July 2026'),
      doc('d', '2026-07-11T09:00:00.000Z', '2026-07-11', 'Saturday, 11th July 2026'),
      doc('b', '2026-07-10T09:00:00.000Z', '2026-07-10', 'Friday, 10th July 2026'),
      doc('c', '2026-07-09T08:00:00.000Z', '2026-07-09', 'Thursday, 9th July 2026'),
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      'Saturday, 11th July 2026',
      'Friday, 10th July 2026',
      'Thursday, 9th July 2026',
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'd']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['b']);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['c']);
  });

  it('keeps rows without persisted day fields ungrouped (no divider label)', () => {
    const groups = groupMarkdownDocumentsByDay([
      doc('legacy', '2026-07-01T10:00:00.000Z', null, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('');
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['legacy']);
  });
});
