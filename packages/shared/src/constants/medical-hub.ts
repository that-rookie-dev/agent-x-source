/** Shown for hub / roster crew in clinical & medical education categories only. */
export const MEDICAL_INFORMATIONAL_DISCLAIMER =
  'Informational only — not medical advice. AI and LLMs can be wrong. Do not use for diagnosis, treatment, or emergency decisions. Consult a licensed healthcare professional.';

import {
  MEDICAL_HUB_CATALOG_IDS_GENERATED,
  MEDICAL_HUB_CATEGORY_IDS_GENERATED,
} from './medical-hub.generated.js';

export const MEDICAL_HUB_CATEGORY_IDS: ReadonlySet<string> = new Set(MEDICAL_HUB_CATEGORY_IDS_GENERATED);

export const MEDICAL_HUB_CATALOG_IDS: ReadonlySet<string> = new Set(MEDICAL_HUB_CATALOG_IDS_GENERATED);

export function isMedicalHubCategory(categoryId?: string | null): boolean {
  return !!categoryId && MEDICAL_HUB_CATEGORY_IDS.has(categoryId);
}

export function isMedicalHubCatalogId(catalogId?: string | null): boolean {
  return !!catalogId && MEDICAL_HUB_CATALOG_IDS.has(catalogId);
}

export function crewRequiresMedicalDisclaimer(input: {
  categoryId?: string | null;
  requiresMedicalDisclaimer?: boolean;
  catalogId?: string | null;
  crewId?: string | null;
}): boolean {
  if (input.requiresMedicalDisclaimer) return true;
  if (isMedicalHubCategory(input.categoryId)) return true;
  if (isMedicalHubCatalogId(input.catalogId)) return true;
  if (input.crewId && isMedicalHubCatalogId(input.crewId)) return true;
  if (input.catalogId && isMedicalHubCatalogId(`hub-${input.catalogId}`)) return true;
  return false;
}
