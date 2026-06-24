import type { Pool } from 'pg';
import type { CatalogEntry, CatalogManifest, Crew, SessionCrewPreferences } from '@agentx/shared';
import { buildCrewSearchText } from '@agentx/shared';
import { loadCatalogManifest } from './catalog-manifest.js';
import { buildPostgresHubTsQuery } from './fts-query.js';
import { catalogLikePattern, mergeCatalogSearchHits } from './catalog-search.js';
import { mergeCategoryIconIds } from './catalog-categories.js';
import { catalogEntryToSummary } from './catalog-summary.js';
import { markCatalogSeedProgress } from './catalog-seed-state.js';
import type { CrewCatalogStore } from './CrewSuggestionService.js';

export const PG_CREW_CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS crew_catalog (
  id              TEXT PRIMARY KEY,
  callsign        TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  category_id     TEXT NOT NULL,
  category_label  TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  system_prompt   TEXT NOT NULL DEFAULT '',
  tone            TEXT,
  expertise       TEXT,
  traits          TEXT,
  tools           TEXT,
  search_text     TEXT NOT NULL DEFAULT '',
  hub_revision    INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_crew_preferences (
  session_id              TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  suggestions_dismissed     BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at            TIMESTAMPTZ,
  last_suggestion_at      TIMESTAMPTZ,
  last_suggestion_turn_id TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_catalog_category ON crew_catalog(category_id);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_callsign ON crew_catalog(callsign);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_active ON crew_catalog(active);

CREATE TABLE IF NOT EXISTS _schema (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

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
    searchText: (row['search_text'] as string) || '',
    hubRevision: Number(row['hub_revision'] ?? 1),
    active: row['active'] !== false && row['active'] !== 0,
  };
}

function toTsQuery(query: string): string {
  return buildPostgresHubTsQuery(query);
}

export async function runPgCrewCatalogMigration(pool: Pool): Promise<void> {
  await pool.query(PG_CREW_CATALOG_SCHEMA);

  await pool.query(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'custom'`);
  await pool.query(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS catalog_id TEXT`);
  await pool.query(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS suggestable BOOLEAN NOT NULL DEFAULT TRUE`);

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE crew_catalog ADD COLUMN search_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE crews ADD COLUMN search_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_crew_catalog_tsv ON crew_catalog USING GIN (search_tsv)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_crews_tsv ON crews USING GIN (search_tsv)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_crews_source ON crews(source)`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crews_catalog_id ON crews(catalog_id) WHERE catalog_id IS NOT NULL
  `);

  await pool.query(`INSERT INTO _schema (version) VALUES (19) ON CONFLICT (version) DO NOTHING`);
}

export async function seedPgCatalog(
  pool: Pool,
  manifest: CatalogManifest,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const total = manifest.crews.length;
  const report = (processed: number) => {
    onProgress?.(processed, total);
    markCatalogSeedProgress(processed, total);
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let processed = 0;
    for (const crew of manifest.crews) {
      const existing = await client.query(`SELECT id FROM crew_catalog WHERE id = $1`, [crew.id]);
      await client.query(
        `INSERT INTO crew_catalog (
          id, callsign, name, title, category_id, category_label, description,
          system_prompt, tone, expertise, traits, tools, search_text, hub_revision, active, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,NOW())
        ON CONFLICT(id) DO UPDATE SET
          callsign=EXCLUDED.callsign, name=EXCLUDED.name, title=EXCLUDED.title,
          category_id=EXCLUDED.category_id, category_label=EXCLUDED.category_label,
          description=EXCLUDED.description, system_prompt=EXCLUDED.system_prompt,
          tone=EXCLUDED.tone, expertise=EXCLUDED.expertise, traits=EXCLUDED.traits,
          tools=EXCLUDED.tools, search_text=EXCLUDED.search_text,
          hub_revision=EXCLUDED.hub_revision, active=TRUE, updated_at=NOW()`,
        [
          crew.id, crew.callsign, crew.name, crew.title, crew.categoryId, crew.categoryLabel,
          crew.description, crew.systemPrompt, crew.tone,
          JSON.stringify(crew.expertise), JSON.stringify(crew.traits),
          crew.tools ? JSON.stringify(crew.tools) : null,
          crew.searchText, manifest.revision,
        ],
      );
      if (existing.rowCount) updated += 1;
      else inserted += 1;
      processed += 1;
      if (processed % 25 === 0 || processed === total) report(processed);
    }
    await client.query(
      `INSERT INTO app_metadata (key, value) VALUES ('crew_catalog_revision', $1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [String(manifest.revision)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
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

    seedCatalog(manifest: CatalogManifest) {
      return seedPgCatalog(pool, manifest);
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

      return mergeCatalogSearchHits(ftsHits, likeHits, limit);
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
