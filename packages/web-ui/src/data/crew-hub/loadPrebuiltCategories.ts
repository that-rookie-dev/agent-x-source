import type { PrebuiltCategory, PrebuiltCrew } from '../../components/crew/CrewHubDialog';
import { PREBUILT_CATEGORY_INDEX, type PrebuiltCrewData } from './prebuilt-crews-index';
import type { CrewSearchIndexEntry } from './search-index';

const categoryModules = import.meta.glob<{ PREBUILT_CREWS: PrebuiltCrewData[] }>('./categories/*.ts');

let cached: PrebuiltCategory[] | null = null;
let inflight: Promise<PrebuiltCategory[]> | null = null;
const crewCache = new Map<string, PrebuiltCrew[]>();

let searchIndex: CrewSearchIndexEntry[] | null = null;
let searchIndexInflight: Promise<CrewSearchIndexEntry[]> | null = null;

export type CrewSearchHit = Omit<CrewSearchIndexEntry, 'searchText'>;

async function loadCategoryCrews(categoryId: string): Promise<PrebuiltCrew[]> {
  const hit = crewCache.get(categoryId);
  if (hit) return hit;

  const loader = categoryModules[`./categories/${categoryId}.ts`];
  if (!loader) {
    throw new Error(`Unknown crew hub category: ${categoryId}`);
  }
  const mod = await loader();
  crewCache.set(categoryId, mod.PREBUILT_CREWS);
  return mod.PREBUILT_CREWS;
}

/** Lightweight search catalog (no system prompts). */
export function loadCrewSearchIndex(): Promise<CrewSearchIndexEntry[]> {
  if (searchIndex) return Promise.resolve(searchIndex);
  if (searchIndexInflight) return searchIndexInflight;

  searchIndexInflight = import('./search-index').then((mod) => {
    searchIndex = mod.CREW_SEARCH_INDEX;
    return searchIndex;
  }).finally(() => {
    searchIndexInflight = null;
  });

  return searchIndexInflight;
}

export function searchCrewHub(query: string): CrewSearchHit[] {
  if (!searchIndex) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: CrewSearchHit[] = [];
  for (const entry of searchIndex) {
    if (entry.searchText.includes(q)) {
      const { searchText: _omit, ...hit } = entry;
      hits.push(hit);
    }
  }
  return hits;
}

export async function resolveHubCrew(categoryId: string, callsign: string): Promise<PrebuiltCrew | undefined> {
  const crews = await loadCategoryCrews(categoryId);
  return crews.find((crew) => crew.callsign === callsign);
}

/** Warm search index and an initial sector in the background. */
export function prefetchHubCatalog(categoryId?: string): void {
  void loadCrewSearchIndex();
  const id = categoryId ?? PREBUILT_CATEGORY_INDEX[0]?.id;
  if (id) void loadCategoryCrews(id);
}

/** Lazy-load the Crew Hub catalog (split per-sector chunks). */
export function loadPrebuiltCategories(): Promise<PrebuiltCategory[]> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = import('./category-icons').then(async ({ getCategoryIcon }) => {
    const categories = await Promise.all(
      PREBUILT_CATEGORY_INDEX.map(async (entry) => ({
        id: entry.id,
        label: entry.label,
        icon: getCategoryIcon(entry.iconId),
        crews: await loadCategoryCrews(entry.id),
      })),
    );
    cached = categories;
    return categories;
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Load hub sector list quickly (metadata only, no crew payloads). */
export async function loadPrebuiltCategoryIndex(): Promise<PrebuiltCategory[]> {
  const { getCategoryIcon } = await import('./category-icons');
  return PREBUILT_CATEGORY_INDEX.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: getCategoryIcon(entry.iconId),
    crews: crewCache.get(entry.id) ?? [],
  }));
}

/** Load crews for a single sector (cached). */
export async function ensureCategoryCrews(
  categories: PrebuiltCategory[],
  categoryIndex: number,
): Promise<PrebuiltCategory[]> {
  const entry = categories[categoryIndex];
  if (!entry || entry.crews.length > 0) return categories;

  const crews = await loadCategoryCrews(entry.id);
  const next = categories.map((cat, idx) => (idx === categoryIndex ? { ...cat, crews } : cat));
  if (cached) {
    cached = next;
  }
  return next;
}
