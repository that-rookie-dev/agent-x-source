import type { CrewVoiceSessionInfo } from '../../api';
import { groupByPersistedListDay } from '../../markdown/markdown-list-groups';

export interface CallSessionDayGroup {
  dayKey: string;
  label: string;
  items: CrewVoiceSessionInfo[];
}

function callTimestamp(row: CrewVoiceSessionInfo): number {
  const iso = row.updatedAt ?? row.createdAt;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Newest calls first (by updatedAt, then createdAt). */
export function sortCallsLatestFirst(rows: CrewVoiceSessionInfo[]): CrewVoiceSessionInfo[] {
  return [...rows].sort((a, b) => callTimestamp(b) - callTimestamp(a));
}

/**
 * Group call history by persisted list-day fields.
 * Day key/label are written at session create — not derived here.
 */
export function groupCallSessionsByDay(
  items: CrewVoiceSessionInfo[],
): CallSessionDayGroup[] {
  return groupByPersistedListDay(sortCallsLatestFirst(items));
}
