import { describe, expect, it } from 'vitest';
import {
  decideCallDivider,
  encodeCallDividerContent,
  isCallDividerContent,
  parseCallDivider,
  takeCallDividerForPersist,
  resetCallDividerClock,
} from '../src/utils/call-transcript-divider.js';

describe('call-transcript-divider', () => {
  it('writes daytime for the first turn', () => {
    const d = decideCallDivider(null, Date.parse('2026-07-20T10:00:00'));
    expect(d?.variant).toBe('daytime');
    expect(d?.label).toMatch(/Jul/);
  });

  it('writes time after a long same-day gap', () => {
    const a = Date.parse('2026-07-20T10:00:00');
    const b = Date.parse('2026-07-20T10:20:00');
    expect(decideCallDivider(a, b)?.variant).toBe('time');
  });

  it('skips divider for a short gap', () => {
    const a = Date.parse('2026-07-20T10:00:00');
    const b = Date.parse('2026-07-20T10:02:00');
    expect(decideCallDivider(a, b)).toBeNull();
  });

  it('round-trips encoded content', () => {
    const meta = { variant: 'duration' as const, label: 'Call time · 01:02' };
    const content = encodeCallDividerContent(meta);
    expect(isCallDividerContent(content)).toBe(true);
    expect(parseCallDivider(content)).toEqual(meta);
  });

  it('advances persist clock per voice session', () => {
    const sid = 'voice:test-divider-session';
    resetCallDividerClock(sid);
    const first = takeCallDividerForPersist(sid, Date.parse('2026-07-20T10:00:00'));
    const second = takeCallDividerForPersist(sid, Date.parse('2026-07-20T10:01:00'));
    expect(first?.variant).toBe('daytime');
    expect(second).toBeNull();
    resetCallDividerClock(sid);
  });
});
