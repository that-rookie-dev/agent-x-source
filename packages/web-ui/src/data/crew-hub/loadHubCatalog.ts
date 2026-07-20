import { crewCatalog, crewSuggestions } from '../../api';
import type { CatalogEntry, CatalogSummary } from '../../api';
import type { PrebuiltCategory, PrebuiltCrew } from '../../components/crew/hub-types';
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

let categoryIndexPromise: Promise<PrebuiltCategory[]> | null = null;
const sectorPromises = new Map<string, Promise<PrebuiltCrew[]>>();

/** Load hub sector list from DB catalog (metadata only). Shared in-flight cache. */
export async function loadHubCategoryIndex(): Promise<PrebuiltCategory[]> {
  if (!categoryIndexPromise) {
    categoryIndexPromise = crewCatalog
      .listCategories()
      .then(({ categories }) =>
        categories.map((c) => ({
          id: c.id,
          label: c.label,
          icon: resolveCategoryIcon(c.iconId, c.id),
          crews: [] as PrebuiltCrew[],
        })),
      )
      .catch((err) => {
        categoryIndexPromise = null;
        throw err;
      });
  }
  return categoryIndexPromise;
}

async function loadSectorCrews(categoryId: string): Promise<PrebuiltCrew[]> {
  let pending = sectorPromises.get(categoryId);
  if (!pending) {
    pending = crewCatalog
      .listByCategory(categoryId)
      .then(({ crews }) => crews.map(summaryToPrebuilt))
      .catch((err) => {
        sectorPromises.delete(categoryId);
        throw err;
      });
    sectorPromises.set(categoryId, pending);
  }
  return pending;
}

/** Load crews for one hub sector from DB catalog. */
export async function ensureHubCategoryCrews(
  categories: PrebuiltCategory[],
  categoryIndex: number,
): Promise<PrebuiltCategory[]> {
  const entry = categories[categoryIndex];
  if (!entry || entry.crews.length > 0) return categories;
  const mapped = await loadSectorCrews(entry.id);
  return categories.map((cat, idx) => (idx === categoryIndex ? { ...cat, crews: mapped } : cat));
}

/**
 * Open-path helper: load category index and first sector in one coordinated flow
 * (avoids duplicate index + sector fetches from panel + prefetch).
 */
export async function loadHubOpenState(preferredCategoryId?: string): Promise<{
  categories: PrebuiltCategory[];
  activeIndex: number;
}> {
  const categories = await loadHubCategoryIndex();
  if (categories.length === 0) return { categories, activeIndex: 0 };
  const activeIndex = Math.max(
    0,
    preferredCategoryId ? categories.findIndex((c) => c.id === preferredCategoryId) : 0,
  );
  const idx = activeIndex >= 0 ? activeIndex : 0;
  const withCrews = await ensureHubCategoryCrews(categories, idx);
  return { categories: withCrews, activeIndex: idx };
}

/** FTS search across DB catalog. Optional AbortSignal cancels superseded typing. */
export async function searchHubCatalog(query: string, signal?: AbortSignal): Promise<HubSearchHit[]> {
  const { crews } = await crewCatalog.search(query, 40, signal);
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

/** Warm first sector using the shared cache (no second category-index fetch). */
export function prefetchHubCatalog(categoryId?: string): void {
  void loadHubCategoryIndex().then((categories) => {
    const id = categoryId ?? categories[0]?.id;
    if (id) void loadSectorCrews(id);
  });
}
