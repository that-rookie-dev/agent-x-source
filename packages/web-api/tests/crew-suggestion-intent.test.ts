import { describe, expect, it } from 'vitest';
import { explicitCrewRequest } from '@agentx/shared';

describe('explicitCrewRequest (shared)', () => {
  it('matches skill-based crew member requests', () => {
    expect(explicitCrewRequest('I want crew members who have AWS skills')).toBe(true);
    expect(explicitCrewRequest('list crew with kubernetes experience')).toBe(true);
    expect(explicitCrewRequest('suggest some crew for tax planning')).toBe(true);
  });

  it('matches workforce phrasing without the word crew', () => {
    expect(explicitCrewRequest('I need a skilled person for our launch')).toBe(true);
  });

  it('does not match generic task-only messages', () => {
    expect(explicitCrewRequest('fix this docker compose file')).toBe(false);
  });
});
