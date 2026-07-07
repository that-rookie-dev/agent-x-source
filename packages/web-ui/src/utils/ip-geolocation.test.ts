import { describe, expect, it } from 'vitest';
import { timezonesLikelyMismatch } from './ip-geolocation.js';

describe('timezonesLikelyMismatch', () => {
  it('returns false for matching timezones', () => {
    expect(timezonesLikelyMismatch('Asia/Kolkata', 'Asia/Kolkata')).toBe(false);
  });

  it('returns true for clearly different timezones', () => {
    expect(timezonesLikelyMismatch('Asia/Kolkata', 'America/New_York')).toBe(true);
  });
});
