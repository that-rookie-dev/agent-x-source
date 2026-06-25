import { isMedicalHubCategory } from './medical-hub.js';

export const DOCTORATE_TITLE_RE =
  /\b(scientist|physicist|biologist|chemist|epidemiologist|immunologist|neuroscientist|geneticist|pharmacologist|toxicologist|microbiologist|botanist|zoologist|geologist|astronomer|theorist|researcher)\b/i;

export const DOCTORATE_EXPERTISE_MARKERS: ReadonlySet<string> = new Set([
  'Scientific Method',
  'Literature Review',
  'Experimental Design',
  'Data Analysis',
  'Peer Review',
  'Lab Safety',
  'Reproducibility',
  'Hypothesis Testing',
  'Instrumentation',
  'Technical Writing',
  'Grant Writing',
  'Ethics Compliance',
]);

export const SCIENCE_HUB_CATEGORY_IDS: ReadonlySet<string> = new Set([
  'theoretical-physical-sciences',
  'applied-engineering-sciences',
  'space-science-astronomy',
  'biological-life-sciences',
  'chemistry-materials-science',
  'environmental-earth-sciences',
  'forensic-science-investigation',
  'agricultural-science-research',
]);

export interface DrHonorificInput {
  categoryId?: string | null;
  title?: string | null;
  expertise?: string[] | null;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  medicalCategory?: boolean;
  scienceCategory?: boolean;
}

export function isScienceHubCategory(categoryId?: string | null): boolean {
  return !!categoryId && SCIENCE_HUB_CATEGORY_IDS.has(categoryId);
}

export function crewQualifiesForDrHonorific(input: DrHonorificInput): boolean {
  if (input.honorsDoctorate) return true;
  if (input.medicalCategory || input.requiresMedicalDisclaimer) return true;

  const scienceCategory = input.scienceCategory ?? isScienceHubCategory(input.categoryId);
  if (!scienceCategory) return false;

  const title = input.title ?? '';
  if (!DOCTORATE_TITLE_RE.test(title)) return false;

  const markerHits = (input.expertise ?? []).filter((e) => DOCTORATE_EXPERTISE_MARKERS.has(e)).length;
  return markerHits >= 1;
}

export function applyDrHonorificToName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  return `Dr. ${trimmed}`;
}

export function applyDrCallsignPrefix(callsign: string): string {
  const base = callsign.trim().replace(/^dr_/, '');
  if (!base) return callsign;
  return base.startsWith('dr_') ? base : `dr_${base}`;
}

export function formatCrewDisplayName(name: string, input: DrHonorificInput): string {
  return crewQualifiesForDrHonorific(input) ? applyDrHonorificToName(name) : name;
}

export function formatCrewDisplayCallsign(callsign: string, input: DrHonorificInput): string {
  return crewQualifiesForDrHonorific(input) ? applyDrCallsignPrefix(callsign) : callsign;
}

export interface HostCrewIdentityInput {
  name: string;
  callsign: string;
  title?: string | null;
  categoryId?: string | null;
  expertise?: string[] | null;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  medicalCategory?: boolean;
  scienceCategory?: boolean;
}

export function drHonorificInputFromHostCrew(source: HostCrewIdentityInput): DrHonorificInput {
  return {
    categoryId: source.categoryId,
    title: source.title,
    expertise: source.expertise,
    requiresMedicalDisclaimer: source.requiresMedicalDisclaimer
      ?? isMedicalHubCategory(source.categoryId),
    honorsDoctorate: source.honorsDoctorate,
    medicalCategory: source.medicalCategory,
    scienceCategory: source.scienceCategory,
  };
}

/** Apply Dr. honorific to host crew name/callsign (idempotent). */
export function formatHostCrewIdentity(source: HostCrewIdentityInput): {
  name: string;
  callsign: string;
  honorsDoctorate: boolean;
} {
  const honorific = drHonorificInputFromHostCrew(source);
  return {
    name: formatCrewDisplayName(source.name, honorific),
    callsign: formatCrewDisplayCallsign(source.callsign, honorific),
    honorsDoctorate: crewQualifiesForDrHonorific(honorific),
  };
}
