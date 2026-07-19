import type { CrewVoiceSessionInfo } from '../../api';
import {
  formatMarkdownDateGroupLabel,
  localDayKeyFromIso,
} from '../../markdown/markdown-list-groups';

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

/** Group call history by local calendar day (newest day / newest call first). */
export function groupCallSessionsByDay(
  items: CrewVoiceSessionInfo[],
  now = new Date(),
): CallSessionDayGroup[] {
  const sorted = sortCallsLatestFirst(items);
  const byDay = new Map<string, CrewVoiceSessionInfo[]>();
  for (const item of sorted) {
    const iso = item.updatedAt ?? item.createdAt ?? new Date(0).toISOString();
    const key = localDayKeyFromIso(iso);
    const bucket = byDay.get(key) ?? [];
    bucket.push(item);
    byDay.set(key, bucket);
  }

  return [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((dayKey) => ({
      dayKey,
      label: formatMarkdownDateGroupLabel(dayKey, now),
      items: byDay.get(dayKey)!,
    }));
}
