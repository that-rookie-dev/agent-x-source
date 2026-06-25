import type { DrHonorificInput, HostCrewIdentityInput } from '@agentx/shared/browser';
import {
  formatHostCrewIdentity,
  isMedicalHubCategory,
} from '@agentx/shared/browser';

export type CrewDisplayInput = DrHonorificInput & {
  name: string;
  callsign: string;
};

export function crewCallsignsMatch(a: string, b: string): boolean {
  const norm = (c: string) => c.trim().toLowerCase().replace(/^dr_/, '');
  return norm(a) === norm(b);
}

export function crewDisplayFields(input: CrewDisplayInput): {
  displayName: string;
  displayCallsign: string;
  honorsDoctorate: boolean;
} {
  const formatted = formatHostCrewIdentity(input as HostCrewIdentityInput);
  return {
    displayName: formatted.name,
    displayCallsign: formatted.callsign,
    honorsDoctorate: formatted.honorsDoctorate,
  };
}

export function sessionHostCrewDisplay(session: {
  hostCrewName?: string | null;
  hostCrewCallsign?: string | null;
  hostCrewTitle?: string | null;
  hostCrewCategoryId?: string | null;
  title?: string | null;
  hostCrewExpertise?: string[] | null;
  hostCrewHonorsDoctorate?: boolean;
}): { displayName: string; displayCallsign: string } {
  const name = session.hostCrewName ?? session.title ?? 'Crew member';
  const callsign = session.hostCrewCallsign ?? '';
  const { displayName, displayCallsign } = crewDisplayFields({
    name,
    callsign,
    title: session.hostCrewTitle ?? undefined,
    categoryId: session.hostCrewCategoryId ?? undefined,
    expertise: session.hostCrewExpertise ?? undefined,
    requiresMedicalDisclaimer: isMedicalHubCategory(session.hostCrewCategoryId),
    honorsDoctorate: session.hostCrewHonorsDoctorate,
  });
  return { displayName, displayCallsign };
}
