import { describe, expect, it } from 'vitest';
import { buildListDayDivider, formatListDayLabel, listDayKeyFromDate } from '../src/utils/list-day-divider.js';

describe('list-day-divider', () => {
  it('builds a stable day key and absolute label', () => {
    const d = new Date(2026, 6, 20, 15, 0, 0);
    const built = buildListDayDivider(d);
    expect(built.dayKey).toBe(listDayKeyFromDate(d));
    expect(built.dayLabel).toBe(formatListDayLabel(built.dayKey));
    expect(built.dayLabel).toMatch(/July 2026/);
    expect(built.dayLabel).not.toMatch(/TODAY|YESTERDAY/i);
  });
});
