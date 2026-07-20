import type { Pool } from 'pg';
import type { CatalogEntry, CatalogManifest, Crew, SessionCrewPreferences } from '@agentx/shared';
import { buildCrewSearchText } from '@agentx/shared';
import { loadCatalogManifest } from './catalog-manifest.js';
import { buildPostgresHubTsQuery } from './fts-query.js';
import { catalogLikePattern, mergeCatalogSearchHits, searchManifestCatalog } from './catalog-search.js';
import { mergeCategoryIconIds } from './catalog-categories.js';
import { catalogEntryToSummary } from './catalog-summary.js';
import { markCatalogSeedProgress } from './catalog-seed-state.js';
import { dedupePgCatalogTitles, prunePgCatalogOrphans } from './catalog-prune.js';
import type { CrewCatalogStore } from './CrewSuggestionService.js';

// Schema is now managed by versioned SQL migrations (V003__crew_catalog_and_fts.sql).

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : raw.split(',').map((s) => s.trim()).filter(Boolean);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function catalogFromRow(row: Record<string, unknown>): CatalogEntry {
  return {
    id: row['id'] as string,
    callsign: row['callsign'] as string,
    name: row['name'] as string,
    title: (row['title'] as string) || '',
    categoryId: row['category_id'] as string,
    categoryLabel: (row['category_label'] as string) || '',
    description: (row['description'] as string) || '',
    systemPrompt: (row['system_prompt'] as string) || '',
    tone: (row['tone'] as string) || undefined,
    expertise: parseJsonArray(row['expertise']),
    traits: parseJsonArray(row['traits']),
    tools: parseJsonArray(row['tools']),
    tags: parseJsonArray(row['tags']),
    searchText: (row['search_text'] as string) || '',
    hubRevision: Number(row['hub_revision'] ?? 1),
    active: row['active'] !== false && row['active'] !== 0,
  };
}

function toTsQuery(query: string): string {
  return buildPostgresHubTsQuery(query);
}

export async function seedPgCatalog(
  pool: Pool,
  manifest: CatalogManifest,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const total = manifest.crews.length;
  const BATCH_SIZE = 40;
  const COLS_PER_ROW = 15;
  const report = (processed: number) => {
    onProgress?.(processed, total);
    markCatalogSeedProgress(processed, total);
  };
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');
    for (let offset = 0; offset < manifest.crews.length; offset += BATCH_SIZE) {
      const batch = manifest.crews.slice(offset, offset + BATCH_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      for (const crew of batch) {
        const placeholders = Array.from({ length: COLS_PER_ROW }, () => `$${paramIdx++}`).join(',');
        values.push(`(${placeholders})`);
        params.push(
          crew.id, crew.callsign, crew.name, crew.title, crew.categoryId, crew.categoryLabel,
          crew.description, crew.systemPrompt, crew.tone,
          JSON.stringify(crew.expertise), JSON.stringify(crew.traits),
          crew.tools ? JSON.stringify(crew.tools) : null,
          crew.tags ? JSON.stringify(crew.tags) : null,
          crew.searchText, manifest.revision,
        );
      }
      const result = await client.query(
        `INSERT INTO crew_catalog (
          id, callsign, name, title, category_id, category_label, description,
          system_prompt, tone, expertise, traits, tools, tags, search_text, hub_revision
        ) VALUES ${values.join(',')}
        ON CONFLICT(id) DO UPDATE SET
          callsign=EXCLUDED.callsign, name=EXCLUDED.name, title=EXCLUDED.title,
          category_id=EXCLUDED.category_id, category_label=EXCLUDED.category_label,
          description=EXCLUDED.description, system_prompt=EXCLUDED.system_prompt,
          tone=EXCLUDED.tone, expertise=EXCLUDED.expertise, traits=EXCLUDED.traits,
          tools=EXCLUDED.tools, tags=EXCLUDED.tags, search_text=EXCLUDED.search_text,
          hub_revision=EXCLUDED.hub_revision, active=TRUE, updated_at=NOW()
        RETURNING (xmax = 0) AS inserted`,
        params,
      );
      for (const row of result.rows) {
        if (row['inserted'] === true) inserted += 1;
        else updated += 1;
      }
      processed += batch.length;
      report(processed);
    }
    await client.query(
      `INSERT INTO app_metadata (key, value) VALUES ('crew_catalog_revision', $1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [String(manifest.revision)],
    );
    await prunePgCatalogOrphans(client, manifest);
    await dedupePgCatalogTitles(client, manifest);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    const batchHint = total > 0
      ? ` (failed near crew ${Math.min(processed + 1, total)}/${total})`
      : '';
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Crew Hub catalog seed failed${batchHint}: ${message}`);
  } finally {
    client.release();
  }
  return { inserted, updated };
}

export async function syncPgCrewSearchText(pool: Pool, crewId: string, searchText: string): Promise<void> {
  await pool.query(`UPDATE crews SET search_text = $1, updated_at = NOW() WHERE id = $2`, [searchText, crewId]);
}

export async function backfillPgCrewSearchColumns(
  pool: Pool,
  crewFromRow: (row: Record<string, unknown>) => Crew,
): Promise<void> {
  const result = await pool.query(`SELECT * FROM crews`);
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const crew = crewFromRow(row);
    const searchText = crew.searchText || buildCrewSearchText({
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
    const source = crew.source ?? (crew.catalogId ? 'hub' : 'custom');
    await pool.query(
      `UPDATE crews SET source=$1, catalog_id=COALESCE(catalog_id, $2), search_text=$3,
       suggestable=COALESCE(suggestable, TRUE), updated_at=NOW() WHERE id=$4`,
      [source, crew.catalogId ?? null, searchText, crew.id],
    );
  }
}

export function createPgCrewCatalogStore(
  pool: Pool,
  crewFromRow: (row: Record<string, unknown>) => Crew,
  flushPendingWrites?: () => Promise<void>,
): CrewCatalogStore {
  return {
    async getCatalogRevision(): Promise<number> {
      const res = await pool.query(`SELECT value FROM app_metadata WHERE key='crew_catalog_revision'`);
      const val = res.rows[0]?.['value'] as string | undefined;
      return val ? parseInt(val, 10) || 0 : 0;
    },

    async getCatalogCount(): Promise<number> {
      const res = await pool.query(`SELECT COUNT(*)::int as c FROM crew_catalog`);
      return (res.rows[0]?.['c'] as number) ?? 0;
    },

    seedCatalog(manifest: CatalogManifest, onProgress?: (processed: number, total: number) => void) {
      return seedPgCatalog(pool, manifest, onProgress);
    },

    async ensureCatalogSeeded(): Promise<void> {
      const count = await pool.query(`SELECT COUNT(*)::int as c FROM crew_catalog`);
      if ((count.rows[0]?.['c'] as number) > 0) return;
      const manifest = loadCatalogManifest();
      if (manifest) await seedPgCatalog(pool, manifest);
    },

    async searchCatalog(query: string, limit: number) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      let ftsHits: Array<CatalogEntry & { ftsRank: number }> = [];
      const tsq = toTsQuery(trimmed);
      if (tsq) {
        try {
          const res = await pool.query(
            `SELECT *, ts_rank_cd(search_tsv, to_tsquery('english', $1)) as fts_rank
             FROM crew_catalog
             WHERE active = TRUE AND search_tsv @@ to_tsquery('english', $1)
             ORDER BY fts_rank DESC
             LIMIT $2`,
            [tsq, limit],
          );
          ftsHits = (res.rows as Array<Record<string, unknown>>).map((row) => ({
            ...catalogFromRow(row),
            ftsRank: Number(row['fts_rank']) || 0,
          }));
        } catch {
          ftsHits = [];
        }
      }

      const like = catalogLikePattern(trimmed);
      const likeRes = await pool.query(
        `SELECT * FROM crew_catalog WHERE active = TRUE AND search_text ILIKE $1 LIMIT $2`,
        [like, limit],
      );
      const likeHits = (likeRes.rows as Array<Record<string, unknown>>).map((row, i) => ({
        ...catalogFromRow(row),
        ftsRank: 0.5 - i * 0.01,
      }));

      const merged = mergeCatalogSearchHits(ftsHits, likeHits, limit);
      if (merged.length > 0) return merged;
      const manifest = loadCatalogManifest();
      return manifest ? searchManifestCatalog(manifest, trimmed, limit) : [];
    },

    async listCategories() {
      const res = await pool.query(`
        SELECT category_id as id, category_label as label, COUNT(*)::int as crew_count
        FROM crew_catalog
        WHERE active = TRUE
        GROUP BY category_id, category_label
        ORDER BY category_label
      `);
      return mergeCategoryIconIds((res.rows as Array<Record<string, unknown>>).map((row) => ({
        id: row['id'] as string,
        label: row['label'] as string,
        crewCount: Number(row['crew_count']) || 0,
      })));
    },

    async listByCategory(categoryId: string, limit: number) {
      const res = await pool.query(
        `SELECT * FROM crew_catalog
         WHERE active = TRUE AND category_id = $1
         ORDER BY name
         LIMIT $2`,
        [categoryId, limit],
      );
      return (res.rows as Array<Record<string, unknown>>).map((row) =>
        catalogEntryToSummary(catalogFromRow(row)),
      );
    },

    async searchRosterCrews(query: string, limit: number) {
      const tsq = toTsQuery(query);
      if (!tsq) return [];
      try {
        const res = await pool.query(
          `SELECT *, ts_rank_cd(search_tsv, to_tsquery('english', $1)) as fts_rank
           FROM crews
           WHERE suggestable = TRUE AND search_tsv @@ to_tsquery('english', $1)
           ORDER BY fts_rank DESC
           LIMIT $2`,
          [tsq, limit],
        );
        return (res.rows as Array<Record<string, unknown>>).map((row) => ({
          ...crewFromRow(row),
          ftsRank: Number(row['fts_rank']) || 0,
        }));
      } catch {
        const like = `%${query.toLowerCase().slice(0, 80)}%`;
        const res = await pool.query(
          `SELECT * FROM crews WHERE suggestable = TRUE AND search_text ILIKE $1 LIMIT $2`,
          [like, limit],
        );
        return (res.rows as Array<Record<string, unknown>>).map((row, i) => ({
          ...crewFromRow(row),
          ftsRank: 1 - i * 0.01,
        }));
      }
    },

    async getCatalogEntry(id: string) {
      const res = await pool.query(`SELECT * FROM crew_catalog WHERE id = $1`, [id]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? catalogFromRow(row) : null;
    },

    async getCatalogByCallsign(callsign: string) {
      const res = await pool.query(`SELECT * FROM crew_catalog WHERE callsign = $1`, [callsign]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? catalogFromRow(row) : null;
    },

    async listRecruitedCatalogIds(): Promise<Set<string>> {
      const res = await pool.query(`SELECT catalog_id FROM crews WHERE catalog_id IS NOT NULL`);
      return new Set((res.rows as Array<Record<string, unknown>>).map((r) => r['catalog_id'] as string));
    },

    async getSessionCrewPreferences(sessionId: string): Promise<SessionCrewPreferences> {
      const now = new Date().toISOString();
      const res = await pool.query(`SELECT * FROM session_crew_preferences WHERE session_id = $1`, [sessionId]);
      const row = res.rows[0] as Record<string, unknown> | undefined;
      if (!row) return { sessionId, suggestionsDismissed: false, updatedAt: now };
      return {
        sessionId,
        suggestionsDismissed: !!row['suggestions_dismissed'],
        dismissedAt: row['dismissed_at'] ? new Date(row['dismissed_at'] as string).toISOString() : undefined,
        lastSuggestionAt: row['last_suggestion_at'] ? new Date(row['last_suggestion_at'] as string).toISOString() : undefined,
        lastSuggestionTurnId: (row['last_suggestion_turn_id'] as string) || undefined,
        updatedAt: row['updated_at'] ? new Date(row['updated_at'] as string).toISOString() : now,
      };
    },

    async upsertSessionCrewPreferences(sessionId: string, patch: Partial<SessionCrewPreferences>): Promise<SessionCrewPreferences> {
      // Flush pending session INSERTs so the FK constraint on session_id is satisfied.
      if (flushPendingWrites) await flushPendingWrites();
      const existing = await this.getSessionCrewPreferences(sessionId);
      const merged: SessionCrewPreferences = {
        ...existing,
        ...patch,
        sessionId,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      };
      await pool.query(
        `INSERT INTO session_crew_preferences (
          session_id, suggestions_dismissed, dismissed_at, last_suggestion_at,
          last_suggestion_turn_id, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(session_id) DO UPDATE SET
          suggestions_dismissed=EXCLUDED.suggestions_dismissed,
          dismissed_at=EXCLUDED.dismissed_at,
          last_suggestion_at=EXCLUDED.last_suggestion_at,
          last_suggestion_turn_id=EXCLUDED.last_suggestion_turn_id,
          updated_at=EXCLUDED.updated_at`,
        [
          sessionId,
          merged.suggestionsDismissed,
          merged.dismissedAt ?? null,
          merged.lastSuggestionAt ?? null,
          merged.lastSuggestionTurnId ?? null,
          merged.updatedAt,
        ],
      );
      return merged;
    },

    async getSessionCrewMessageCounts(sessionId: string): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      const res = await pool.query(
        `SELECT crew_id, message_count FROM session_crew_states WHERE session_id = $1`,
        [sessionId],
      );
      for (const row of res.rows as Array<Record<string, unknown>>) {
        out.set(row['crew_id'] as string, Number(row['message_count']) || 0);
      }
      return out;
    },

    async getSessionEnabledCrewIds(sessionId: string): Promise<string[]> {
      const res = await pool.query(
        `SELECT crew_id FROM session_crew_states WHERE session_id = $1 AND enabled = 1`,
        [sessionId],
      );
      return (res.rows as Array<Record<string, unknown>>).map((row) => row['crew_id'] as string);
    },
  };
}
