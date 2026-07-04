import { describe, expect, it } from 'vitest';
import { enhanceGoogleMapsToolOutput, placeIdMapUrl } from '../src/integrations/mcp/google-maps-output.js';

describe('enhanceGoogleMapsToolOutput', () => {
  it('formats place search with Google Maps links instead of coordinates', () => {
    const raw = JSON.stringify({
      places: [
        {
          name: "Miller's 46 Steak House",
          formatted_address: '46 Millers Rd, Bengaluru',
          location: { lat: 12.9915, lng: 77.5943 },
          place_id: 'ChIJh4b88UIWrjsRKglx-wZGnRw',
          rating: 4.4,
        },
      ],
    });

    const output = enhanceGoogleMapsToolOutput('maps_search_places', raw);
    expect(output).toContain('[Open in Google Maps]');
    expect(output).toContain(placeIdMapUrl('ChIJh4b88UIWrjsRKglx-wZGnRw'));
    expect(output).not.toContain('12.9915, 77.5943');
    expect(output).toContain('Do not show raw latitude/longitude');
  });

  it('leaves non-JSON output unchanged', () => {
    expect(enhanceGoogleMapsToolOutput('maps_search_places', 'Place search failed: ZERO_RESULTS')).toBe(
      'Place search failed: ZERO_RESULTS',
    );
  });
});
