import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogManifest } from '@agentx/shared';
import { buildCrewSearchText, hubCatalogIdFromCallsign } from '@agentx/shared';

import { getDataDir } from '../config/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_PATHS = [
  join(__dirname, 'data/crew-catalog.manifest.json'),
  join(__dirname, '../data/crew-catalog.manifest.json'),
  join(__dirname, '../../data/crew-catalog.manifest.json'),
  ...(typeof process !== 'undefined' && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ? [join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'web-api/data/crew-catalog.manifest.json')]
    : []),
  join(process.cwd(), 'packages/engine/data/crew-catalog.manifest.json'),
  join(process.cwd(), 'packages/web-api/dist/data/crew-catalog.manifest.json'),
  join(process.cwd(), 'data/crew-catalog.manifest.json'),
  join(getDataDir(), 'crew-catalog.manifest.json'),
];

export function loadCatalogManifest(): CatalogManifest | null {
  for (const path of MANIFEST_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as CatalogManifest;
    } catch {
      continue;
    }
  }
  return null;
}

export function buildManifestFromCategories(
  categories: Array<{
    id: string;
    label: string;
    iconId?: string;
    crews: Array<{
      name: string;
      title: string;
      callsign: string;
      description: string;
      systemPrompt: string;
      tone: string;
      expertise: string[];
      traits: string[];
      tools?: string[];
      tags?: string[];
    }>;
  }>,
  revision = 1,
): CatalogManifest {
  const manifestCategories = categories.map((c) => ({
    id: c.id,
    label: c.label,
    iconId: c.iconId,
  }));

  const crews = categories.flatMap((category) =>
    category.crews.map((crew) => ({
      id: hubCatalogIdFromCallsign(crew.callsign),
      categoryId: category.id,
      categoryLabel: category.label,
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      description: crew.description,
      systemPrompt: crew.systemPrompt,
      tone: crew.tone,
      expertise: crew.expertise,
      traits: crew.traits,
      tools: crew.tools,
      tags: crew.tags,
      searchText: buildCrewSearchText({
        name: crew.name,
        title: crew.title,
        callsign: crew.callsign,
        description: crew.description,
        tone: crew.tone,
        expertise: crew.expertise,
        traits: crew.traits,
        tools: crew.tools,
        tags: crew.tags,
        systemPrompt: crew.systemPrompt,
      }),
    })),
  );

  return { revision, categories: manifestCategories, crews };
}
