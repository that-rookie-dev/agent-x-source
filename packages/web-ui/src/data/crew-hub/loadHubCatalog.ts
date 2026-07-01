import { crewCatalog, crewSuggestions } from '../../api';
import type { CatalogEntry, CatalogSummary } from '../../api';
import type { PrebuiltCategory, PrebuiltCrew } from '../../components/crew/CrewHubDialog';
import { resolveCategoryIcon } from './category-icons';

export type HubSearchHit = {
  catalogId: string;
  categoryId: string;
  categoryLabel: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  name: string;
  title: string;
  callsign: string;
  description: string;
  tone: string;
  expertise: string[];
  traits: string[];
};

function summaryToPrebuilt(crew: CatalogSummary): PrebuiltCrew {
  return {
    catalogId: crew.id,
    categoryId: crew.categoryId,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    honorsDoctorate: crew.honorsDoctorate,
    name: crew.name,
    title: crew.title,
    callsign: crew.callsign,
    description: crew.description,
    systemPrompt: '',
    tone: crew.tone ?? 'professional',
    expertise: crew.expertise,
    traits: crew.traits,
    tools: crew.tools,
    tags: crew.tags,
  };
}

function entryToPrebuilt(entry: CatalogEntry): PrebuiltCrew {
  return {
    catalogId: entry.id,
    categoryId: entry.categoryId,
    requiresMedicalDisclaimer: entry.requiresMedicalDisclaimer,
    honorsDoctorate: entry.honorsDoctorate,
    name: entry.name,
    title: entry.title,
    callsign: entry.callsign,
    description: entry.description,
    systemPrompt: entry.systemPrompt,
    tone: entry.tone ?? 'professional',
    expertise: entry.expertise,
    traits: entry.traits,
    tools: entry.tools,
    tags: entry.tags,
  };
}

/** Load hub sector list from DB catalog (metadata only). */
export async function loadHubCategoryIndex(): Promise<PrebuiltCategory[]> {
  const { categories } = await crewCatalog.listCategories();
  return categories.map((c) => ({
    id: c.id,
    label: c.label,
    icon: resolveCategoryIcon(c.iconId, c.id),
    crews: [],
  }));
}

/** Load crews for one hub sector from DB catalog. */
export async function ensureHubCategoryCrews(
  categories: PrebuiltCategory[],
  categoryIndex: number,
): Promise<PrebuiltCategory[]> {
  const entry = categories[categoryIndex];
  if (!entry || entry.crews.length > 0) return categories;
  const { crews } = await crewCatalog.listByCategory(entry.id);
  const mapped = crews.map(summaryToPrebuilt);
  return categories.map((cat, idx) => (idx === categoryIndex ? { ...cat, crews: mapped } : cat));
}

/** FTS search across DB catalog. */
export async function searchHubCatalog(query: string): Promise<HubSearchHit[]> {
  const { crews } = await crewCatalog.search(query);
  return crews.map((crew) => ({
    catalogId: crew.id,
    categoryId: crew.categoryId,
    categoryLabel: crew.categoryLabel,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    honorsDoctorate: crew.honorsDoctorate,
    name: crew.name,
    title: crew.title,
    callsign: crew.callsign,
    description: crew.description,
    tone: crew.tone ?? 'professional',
    expertise: crew.expertise,
    traits: crew.traits,
  }));
}

/** Resolve full crew dossier from catalog id. */
export async function resolveHubCrewById(catalogId: string): Promise<PrebuiltCrew | undefined> {
  const { entry } = await crewSuggestions.getCatalogEntry(catalogId);
  return entryToPrebuilt(entry);
}

/** Warm category list and first sector in the background. */
export function prefetchHubCatalog(categoryId?: string): void {
  void loadHubCategoryIndex().then((categories) => {
    const id = categoryId ?? categories[0]?.id;
    if (id) void crewCatalog.listByCategory(id);
  });
}
