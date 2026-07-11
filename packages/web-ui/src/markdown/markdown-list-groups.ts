import type { MarkdownDocumentRecord } from '../api';

function ordinalDay(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function localDayKeyFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localDayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatMarkdownDateGroupLabel(dayKey: string, now = new Date()): string {
  const todayKey = localDayKeyFromDate(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKeyFromDate(yesterday);

  if (dayKey === todayKey) return 'TODAY';
  if (dayKey === yesterdayKey) return 'YESTERDAY';

  const [yStr, mStr, dStr] = dayKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  return `${weekday}, ${ordinalDay(d)} ${month} ${y}`;
}

export interface MarkdownDocumentDayGroup {
  dayKey: string;
  label: string;
  items: MarkdownDocumentRecord[];
}

/** Group markdown documents by local calendar day (newest day first). */
export function groupMarkdownDocumentsByDay(
  items: MarkdownDocumentRecord[],
  now = new Date(),
): MarkdownDocumentDayGroup[] {
  const byDay = new Map<string, MarkdownDocumentRecord[]>();
  for (const item of items) {
    const key = localDayKeyFromIso(item.createdAt);
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
