import { describe, expect, it } from 'vitest';
import {
  formatClientSituationBlock,
  normalizeClientSituation,
  resolveClientTimezone,
} from '@agentx/shared';

describe('normalizeClientSituation', () => {
  it('accepts valid browser payload', () => {
    const situation = normalizeClientSituation({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
      latitude: 12.97,
      longitude: 77.59,
      accuracyMeters: 120,
    });
    expect(situation).toMatchObject({
      timezone: 'Asia/Kolkata',
      source: 'browser',
      latitude: 12.97,
      longitude: 77.59,
    });
  });

  it('rejects invalid payloads', () => {
    expect(normalizeClientSituation(null)).toBeNull();
    expect(normalizeClientSituation({ clientNow: 'bad', timezone: 'UTC', source: 'browser' })).toBeNull();
  });
});

describe('formatClientSituationBlock', () => {
  it('includes timezone and GPS coordinates', () => {
    const block = formatClientSituationBlock({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'desktop',
      latitude: 12.97,
      longitude: 77.59,
      locationMethod: 'gps',
      locationConfidence: 'high',
    });
    expect(block).toContain('[CLIENT_SITUATION]');
    expect(block).toContain('Asia/Kolkata');
    expect(block).toContain('12.97000, 77.59000');
    expect(block).toContain('device GPS');
    expect(block).not.toContain('locationMethod');
    expect(block).not.toContain('locationConfidence');
  });

  it('uses plain language when VPN suspected', () => {
    const block = formatClientSituationBlock({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
      locationMethod: 'timezone_only',
      locationConfidence: 'unknown',
      vpnSuspected: true,
    });
    expect(block).toContain('city is unknown');
    expect(block).not.toContain('Coordinates:');
    expect(block).not.toContain('vpnSuspected');
  });
});

describe('resolveClientTimezone', () => {
  it('prefers client situation timezone', () => {
    expect(resolveClientTimezone({ clientNow: '2026-07-06T14:00:00.000Z', timezone: 'Europe/London', source: 'browser' }, 'UTC')).toBe('Europe/London');
  });
});
