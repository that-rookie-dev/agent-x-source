/** Stable list-section day key + frozen absolute label (persisted at write time). */

export interface ListDayDivider {
  /** Local calendar day `YYYY-MM-DD`. */
  dayKey: string;
  /** Absolute label, e.g. `Sunday, 20th July 2026` — never TODAY/YESTERDAY. */
  dayLabel: string;
}

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

export function listDayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function listDayKeyFromIso(iso: string): string {
  return listDayKeyFromDate(new Date(iso));
}

/** Absolute weekday + ordinal month label for a `YYYY-MM-DD` key. */
export function formatListDayLabel(dayKey: string): string {
  const [yStr, mStr, dStr] = dayKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayKey;
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, ${ordinalDay(d)} ${month} ${y}`;
}

/** Build the day divider fields to persist on a list row at create time. */
export function buildListDayDivider(at: Date | string | number = new Date()): ListDayDivider {
  const date = at instanceof Date ? at : new Date(at);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const dayKey = listDayKeyFromDate(safe);
  return { dayKey, dayLabel: formatListDayLabel(dayKey) };
}
