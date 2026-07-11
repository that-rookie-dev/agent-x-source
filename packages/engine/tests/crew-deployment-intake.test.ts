import { describe, expect, it } from 'vitest';
import { needsCrewDeploymentIntake } from '../src/crew/crew-deployment-intake.js';

describe('crew deployment intake', () => {
  it('asks intake before broad travel itinerary drafts', () => {
    expect(needsCrewDeploymentIntake('Plan a trip itinerary for me and my family to europe this winter')).toBe(true);
  });

  it('does not ask intake when travel details are specific enough', () => {
    expect(needsCrewDeploymentIntake('Plan a 10 day mid-range itinerary for my family to Paris')).toBe(false);
  });

  it('respects explicit deferral to the specialist', () => {
    expect(needsCrewDeploymentIntake('Plan a trip itinerary for my family to Europe, you decide')).toBe(false);
  });
});
