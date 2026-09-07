import { VALID_CAPABILITY_TRANSITIONS, type CapabilityStatus } from '@agentx/shared';
import { CapabilityGraduationError } from './errors.js';

export function assertValidTransition(from: CapabilityStatus, to: CapabilityStatus): void {
  const allowed = VALID_CAPABILITY_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new CapabilityGraduationError(`Invalid capability transition ${from} → ${to}`);
  }
}

export function canTransition(from: CapabilityStatus, to: CapabilityStatus): boolean {
  return (VALID_CAPABILITY_TRANSITIONS[from] ?? []).includes(to);
}
