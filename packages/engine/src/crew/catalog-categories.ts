import type { CatalogCategorySummary } from '@agentx/shared';
import { loadCatalogManifest } from './catalog-manifest.js';

export function mergeCategoryIconIds(
  rows: Array<{ id: string; label: string; crewCount: number }>,
): CatalogCategorySummary[] {
  const manifest = loadCatalogManifest();
  const iconById = new Map(
    (manifest?.categories ?? []).map((c) => [c.id, c.iconId]),
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    iconId: iconById.get(row.id),
    crewCount: row.crewCount,
  }));
}
