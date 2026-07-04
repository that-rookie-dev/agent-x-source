import { describe, expect, it } from 'vitest';
import { outputLooksSignedIn } from '../src/components/integrations/package-sign-in-status';

describe('outputLooksSignedIn', () => {
  it('detects JSON loggedIn responses from booking_status', () => {
    expect(outputLooksSignedIn('{"loggedIn":true}')).toBe(true);
    expect(outputLooksSignedIn('{"logged_in": true, "provider": "booking.com"}')).toBe(true);
  });

  it('detects plain-text signed-in messages', () => {
    expect(outputLooksSignedIn('User is logged in to Booking.com')).toBe(true);
  });

  it('rejects not-connected output', () => {
    expect(outputLooksSignedIn('not connected')).toBe(false);
    expect(outputLooksSignedIn('{"loggedIn":false}')).toBe(false);
  });
});
