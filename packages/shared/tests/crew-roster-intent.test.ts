import { describe, expect, it } from 'vitest';
import {
  explicitCrewRequest,
  isWorkforceOrSpecialistNeed,
} from '../src/utils/crew-roster-intent.js';

describe('isWorkforceOrSpecialistNeed', () => {
  it('matches skilled person / workforce phrasing', () => {
    expect(isWorkforceOrSpecialistNeed('I need a skilled person for our marketing launch')).toBe(true);
    expect(isWorkforceOrSpecialistNeed('looking for an expert in tax planning')).toBe(true);
    expect(isWorkforceOrSpecialistNeed('we need to hire a backend engineer')).toBe(true);
    expect(isWorkforceOrSpecialistNeed('who can help with payroll compliance')).toBe(true);
  });

  it('does not match generic task-only messages', () => {
    expect(isWorkforceOrSpecialistNeed('fix this docker compose file')).toBe(false);
    expect(isWorkforceOrSpecialistNeed('thanks!')).toBe(false);
  });
});

describe('explicitCrewRequest', () => {
  it('matches skill-based crew member requests', () => {
    expect(explicitCrewRequest('I want crew members who have AWS skills')).toBe(true);
    expect(explicitCrewRequest('list crew with kubernetes experience')).toBe(true);
    expect(explicitCrewRequest('suggest some crew for tax planning')).toBe(true);
  });

  it('matches workforce requests without saying crew', () => {
    expect(explicitCrewRequest('I need a skilled person for tax planning')).toBe(true);
    expect(explicitCrewRequest('help me find a specialist for AWS migrations')).toBe(true);
  });

  it('does not match generic task-only messages', () => {
    expect(explicitCrewRequest('fix this docker compose file')).toBe(false);
  });
});
