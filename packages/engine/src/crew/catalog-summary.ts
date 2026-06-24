import type { CatalogEntry, CatalogSummary } from '@agentx/shared';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared';

export function catalogEntryToSummary(entry: CatalogEntry): CatalogSummary {
  return {
    id: entry.id,
    callsign: entry.callsign,
    name: entry.name,
    title: entry.title,
    categoryId: entry.categoryId,
    categoryLabel: entry.categoryLabel,
    description: entry.description,
    expertise: entry.expertise,
    traits: entry.traits,
    tone: entry.tone,
    tools: entry.tools,
    requiresMedicalDisclaimer: crewRequiresMedicalDisclaimer({
      categoryId: entry.categoryId,
      requiresMedicalDisclaimer: entry.requiresMedicalDisclaimer,
      catalogId: entry.id,
    }),
  };
}
