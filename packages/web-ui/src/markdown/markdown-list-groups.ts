import type { MarkdownDocumentRecord } from '../api';

export interface MarkdownDocumentDayGroup {
  dayKey: string;
  label: string;
  items: MarkdownDocumentRecord[];
}

type ListDayFields = {
  listDayKey?: string | null;
  listDayLabel?: string | null;
};

/**
 * Group already-sorted newest-first rows by persisted `listDayKey`.
 * Labels come from the DB (`listDayLabel`) — no calendar recomputation.
 */
export function groupByPersistedListDay<T extends ListDayFields>(
  items: T[],
): Array<{ dayKey: string; label: string; items: T[] }> {
  const groups: Array<{ dayKey: string; label: string; items: T[] }> = [];
  for (const item of items) {
    const dayKey = (item.listDayKey ?? '').trim();
    if (!dayKey) {
      const last = groups[groups.length - 1];
      if (last && last.dayKey === '') {
        last.items.push(item);
      } else {
        groups.push({ dayKey: '', label: '', items: [item] });
      }
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.items.push(item);
      continue;
    }
    groups.push({
      dayKey,
      label: (item.listDayLabel ?? dayKey).trim() || dayKey,
      items: [item],
    });
  }
  return groups;
}

/** Group markdown documents by persisted list-day fields (newest day first when list is DESC). */
export function groupMarkdownDocumentsByDay(
  items: MarkdownDocumentRecord[],
): MarkdownDocumentDayGroup[] {
  return groupByPersistedListDay(items);
}
