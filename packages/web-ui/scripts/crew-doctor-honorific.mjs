/** Shared Dr. honorific rules for crew-hub generator (keep in sync with shared/doctorate-honorific.ts). */

export const DOCTORATE_TITLE_RE =
  /\b(scientist|physicist|biologist|chemist|epidemiologist|immunologist|neuroscientist|geneticist|pharmacologist|toxicologist|microbiologist|botanist|zoologist|geologist|astronomer|theorist|researcher)\b/i;

export const DOCTORATE_EXPERTISE_MARKERS = new Set([
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

export const SCIENCE_HUB_CATEGORY_IDS = new Set([
  'theoretical-physical-sciences',
  'applied-engineering-sciences',
  'space-science-astronomy',
  'biological-life-sciences',
  'chemistry-materials-science',
  'environmental-earth-sciences',
  'forensic-science-investigation',
  'agricultural-science-research',
]);

export function applyDrHonorificToName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return trimmed;
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  return `Dr. ${trimmed}`;
}

export function applyDrCallsignPrefix(callsign) {
  const base = String(callsign ?? '').trim().replace(/^dr_/, '');
  if (!base) return callsign;
  return base.startsWith('dr_') ? base : `dr_${base}`;
}

export function crewQualifiesForDrHonorific(input) {
  if (input.honorsDoctorate) return true;
  if (input.medicalCategory || input.requiresMedicalDisclaimer) return true;
  const scienceCategory = input.scienceCategory
    ?? (input.categoryId && SCIENCE_HUB_CATEGORY_IDS.has(input.categoryId));
  if (!scienceCategory) return false;
  const title = String(input.title ?? '');
  if (!DOCTORATE_TITLE_RE.test(title)) return false;
  const expertise = input.expertise ?? [];
  const markerHits = expertise.filter((e) => DOCTORATE_EXPERTISE_MARKERS.has(e)).length;
  return markerHits >= 1;
}

export function applyDrHonorificIfQualified(crew, flags) {
  if (!crewQualifiesForDrHonorific({ ...flags, title: crew.title, expertise: crew.expertise })) {
    return { ...crew, honorsDoctorate: false };
  }
  const name = applyDrHonorificToName(crew.name);
  const callsign = applyDrCallsignPrefix(crew.callsign);
  const systemPrompt = crew.systemPrompt?.replace(
    new RegExp(`You are ${crew.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    `You are ${name}`,
  ) ?? crew.systemPrompt;
  return { ...crew, name, callsign, systemPrompt, honorsDoctorate: true };
}
