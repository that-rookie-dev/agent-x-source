import { describe, expect, it } from 'vitest';
import { detectPlacesSearchRequest, mentionsGoogleMapsProvider } from '../src/integrations/places-intent.js';

describe('places-intent', () => {
  it('detects restaurant search queries', () => {
    expect(detectPlacesSearchRequest('best stake restaurants in bengaluru')).toBe(true);
    expect(detectPlacesSearchRequest('top hotels near me')).toBe(true);
  });

  it('does not flag stock or finance queries', () => {
    expect(detectPlacesSearchRequest('performance trending of ARM stocks')).toBe(false);
  });

  it('detects explicit Google Maps mentions', () => {
    expect(mentionsGoogleMapsProvider('can you check with google map mcp?')).toBe(true);
  });
});
