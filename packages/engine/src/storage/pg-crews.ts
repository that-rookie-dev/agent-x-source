import { buildCrewSearchText } from '@agentx/shared';
import type { Crew, CrewCreateInput } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the crew CRUD helpers. Mirrors the relevant private
 * state/methods of PostgresStorageAdapter so the extracted functions can
 * operate without `this`.
 */
export interface CrewContext {
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

export function listCrews(ctx: CrewContext): Crew[] {
  return ctx.cache.crews;
}

export function getCrew(ctx: CrewContext, id: string): Crew | undefined {
  return ctx.cache.crews.find((c) => c.id === id);
}

export function getDefaultCrew(ctx: CrewContext): Crew | undefined {
  return ctx.cache.crews.find((c) => c.isDefault);
}

export function createCrew(ctx: CrewContext, input: CrewCreateInput): Crew {
  const now = new Date().toISOString();
  const searchText = input.searchText ?? buildCrewSearchText({
    name: input.name,
    title: input.title,
    callsign: input.callsign,
    description: input.description,
    tone: input.emotion,
    expertise: input.expertise,
    traits: input.traits,
    tools: input.tools,
    tags: input.tags,
    systemPrompt: input.systemPrompt,
  });
  const crew: Crew = {
    id: input.id,
    name: input.name,
    title: input.title,
    callsign: input.callsign || input.name.replace(/\s+/g, '').toLowerCase(),
    systemPrompt: input.systemPrompt ?? '',
    description: input.description,
    emotion: input.emotion,
    source: input.source ?? (input.catalogId ? 'hub' : 'custom'),
    catalogId: input.catalogId,
    searchText,
    suggestable: input.suggestable ?? true,
    isDefault: input.isDefault ?? false,
    enabled: input.enabled ?? true,
    expertise: input.expertise,
    traits: input.traits,
    toolPreferences: input.toolPreferences,
    tools: input.tools,
    tags: input.tags,
    permissions: input.permissions,
    model: input.model,
    protocol: input.protocol,
    quotas: input.quotas,
    color: input.color,
    icon: input.icon,
    createdAt: now,
    updatedAt: now,
  };
  const existingIdx = ctx.cache.crews.findIndex((c) => c.id === crew.id);
  if (existingIdx >= 0) ctx.cache.crews[existingIdx] = crew;
  else ctx.cache.crews.push(crew);
  ctx.write(
    `INSERT INTO crews (id, name, title, description, system_prompt, expertise, traits, tool_preferences, enabled_tools, disabled_tools, is_default, metadata, source, catalog_id, search_text, suggestable, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       system_prompt = EXCLUDED.system_prompt,
       expertise = EXCLUDED.expertise,
       traits = EXCLUDED.traits,
       tool_preferences = EXCLUDED.tool_preferences,
       enabled_tools = EXCLUDED.enabled_tools,
       disabled_tools = EXCLUDED.disabled_tools,
       is_default = EXCLUDED.is_default,
       metadata = EXCLUDED.metadata,
       source = EXCLUDED.source,
       catalog_id = EXCLUDED.catalog_id,
       search_text = EXCLUDED.search_text,
       suggestable = EXCLUDED.suggestable,
       updated_at = EXCLUDED.updated_at`,
    [
      crew.id,
      crew.name,
      crew.title || null,
      crew.description || '',
      crew.systemPrompt,
      crew.expertise?.join(',') ?? null,
      crew.traits?.join(',') ?? null,
      crew.toolPreferences?.enabled?.join(',') ?? null,
      crew.toolPreferences?.enabled?.join(',') ?? null,
      crew.toolPreferences?.disabled?.join(',') ?? null,
      crew.isDefault ? 1 : 0,
      JSON.stringify(crew),
      crew.source ?? 'custom',
      crew.catalogId ?? null,
      searchText,
      crew.suggestable !== false,
      now,
      now,
    ]
  );
  return crew;
}

export function updateCrew(ctx: CrewContext, id: string, updates: Partial<Crew>): Crew | null {
  const idx = ctx.cache.crews.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const crew = { ...ctx.cache.crews[idx]!, ...updates, updatedAt: new Date().toISOString() };
  crew.searchText = crew.searchText ?? buildCrewSearchText({
    name: crew.name,
    title: crew.title,
    callsign: crew.callsign,
    description: crew.description,
    tone: crew.emotion,
    expertise: crew.expertise,
    traits: crew.traits,
    tools: crew.tools,
    tags: crew.tags,
    systemPrompt: crew.systemPrompt,
  });
  ctx.cache.crews[idx] = crew;
  ctx.write(
    `UPDATE crews SET name=$1, title=$2, description=$3, system_prompt=$4, expertise=$5, traits=$6, tool_preferences=$7, enabled_tools=$8, disabled_tools=$9, is_default=$10, metadata=$11, source=$12, catalog_id=$13, search_text=$14, suggestable=$15, updated_at=$16
     WHERE id=$17`,
    [
      crew.name,
      crew.title || null,
      crew.description || '',
      crew.systemPrompt,
      crew.expertise?.join(',') ?? null,
      crew.traits?.join(',') ?? null,
      crew.toolPreferences?.enabled?.join(',') ?? null,
      crew.toolPreferences?.enabled?.join(',') ?? null,
      crew.toolPreferences?.disabled?.join(',') ?? null,
      crew.isDefault ? 1 : 0,
      JSON.stringify(crew),
      crew.source ?? 'custom',
      crew.catalogId ?? null,
      crew.searchText,
      crew.suggestable !== false,
      crew.updatedAt,
      id,
    ]
  );
  return crew;
}

export function deleteCrew(ctx: CrewContext, id: string): void {
  const idx = ctx.cache.crews.findIndex((c) => c.id === id);
  if (idx >= 0) ctx.cache.crews.splice(idx, 1);
  ctx.write('DELETE FROM crews WHERE id = $1', [id]);
}
