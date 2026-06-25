import type { CatalogEntry, CatalogManifest, Crew, SessionCrewPreferences } from '@agentx/shared';
import { buildCrewSearchText } from '@agentx/shared';
import { loadCatalogManifest } from './catalog-manifest.js';
import { buildSqliteHubFtsMatch } from './fts-query.js';
import { catalogLikePattern, mergeCatalogSearchHits, searchManifestCatalog } from './catalog-search.js';
import { mergeCategoryIconIds } from './catalog-categories.js';
import { catalogEntryToSummary } from './catalog-summary.js';
import { markCatalogSeedProgress } from './catalog-seed-state.js';
import { dedupeSqliteCatalogTitles, pruneSqliteCatalogOrphans } from './catalog-prune.js';
import type { CrewCatalogStore } from './CrewSuggestionService.js';

export const CREW_CATALOG_SCHEMA_V19 = `
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
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_crew_preferences (
  session_id              TEXT PRIMARY KEY,
  suggestions_dismissed     INTEGER NOT NULL DEFAULT 0,
  dismissed_at            TEXT,
  last_suggestion_at      TEXT,
  last_suggestion_turn_id TEXT,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crew_catalog_category ON crew_catalog(category_id);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_callsign ON crew_catalog(callsign);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_active ON crew_catalog(active);

CREATE VIRTUAL TABLE IF NOT EXISTS crew_catalog_fts USING fts5(
  catalog_id UNINDEXED,
  search_text,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS crews_fts USING fts5(
  crew_id UNINDEXED,
  search_text,
  tokenize='porter unicode61'
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
    hubRevision: (row['hub_revision'] as number) ?? 1,
    active: !!(row['active'] ?? 1),
  };
}

function escapeFtsQuery(query: string): string {
  return buildSqliteHubFtsMatch(query);
}

export function runSqliteCrewCatalogMigration(db: {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
    all: (...args: unknown[]) => Array<Record<string, unknown>>;
  };
}): void {
  db.exec(CREW_CATALOG_SCHEMA_V19);

  const crewCols = db.prepare(`PRAGMA table_info(crews)`).all() as Array<{ name: string }>;
  const colNames = new Set(crewCols.map((c) => c.name));
  if (!colNames.has('source')) {
    try { db.exec(`ALTER TABLE crews ADD COLUMN source TEXT NOT NULL DEFAULT 'custom'`); } catch { /* exists */ }
  }
  if (!colNames.has('catalog_id')) {
    try { db.exec(`ALTER TABLE crews ADD COLUMN catalog_id TEXT`); } catch { /* exists */ }
  }
  if (!colNames.has('search_text')) {
    try { db.exec(`ALTER TABLE crews ADD COLUMN search_text TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  }
  if (!colNames.has('suggestable')) {
    try { db.exec(`ALTER TABLE crews ADD COLUMN suggestable INTEGER NOT NULL DEFAULT 1`); } catch { /* exists */ }
  }

  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_crews_source ON crews(source)`); } catch { /* best-effort */ }
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crews_catalog_id ON crews(catalog_id) WHERE catalog_id IS NOT NULL`); } catch { /* best-effort */ }
}

export function seedSqliteCatalog(
  db: Parameters<typeof runSqliteCrewCatalogMigration>[0],
  manifest: CatalogManifest,
  onProgress?: (processed: number, total: number) => void,
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const total = manifest.crews.length;
  const report = (processed: number) => {
    onProgress?.(processed, total);
    markCatalogSeedProgress(processed, total);
  };
  const upsert = db.prepare(`
    INSERT INTO crew_catalog (
      id, callsign, name, title, category_id, category_label, description,
      system_prompt, tone, expertise, traits, tools, search_text, hub_revision, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      callsign=excluded.callsign,
      name=excluded.name,
      title=excluded.title,
      category_id=excluded.category_id,
      category_label=excluded.category_label,
      description=excluded.description,
      system_prompt=excluded.system_prompt,
      tone=excluded.tone,
      expertise=excluded.expertise,
      traits=excluded.traits,
      tools=excluded.tools,
      search_text=excluded.search_text,
      hub_revision=excluded.hub_revision,
      active=1,
      updated_at=datetime('now')
  `);

  const ftsDelete = db.prepare(`DELETE FROM crew_catalog_fts WHERE catalog_id = ?`);
  const ftsInsert = db.prepare(`INSERT INTO crew_catalog_fts(catalog_id, search_text) VALUES (?, ?)`);

  const txn = typeof (db as unknown as { transaction?: (fn: () => void) => () => void }).transaction === 'function'
    ? (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
        let processed = 0;
        for (const crew of manifest.crews) {
          const existing = db.prepare(`SELECT id FROM crew_catalog WHERE id = ?`).get(crew.id);
          upsert.run(
            crew.id,
            crew.callsign,
            crew.name,
            crew.title,
            crew.categoryId,
            crew.categoryLabel,
            crew.description,
            crew.systemPrompt,
            crew.tone,
            JSON.stringify(crew.expertise),
            JSON.stringify(crew.traits),
            crew.tools ? JSON.stringify(crew.tools) : null,
            crew.searchText,
            manifest.revision,
          );
          ftsDelete.run(crew.id);
          ftsInsert.run(crew.id, crew.searchText);
          if (existing) updated += 1;
          else inserted += 1;
          processed += 1;
          if (processed % 25 === 0 || processed === total) report(processed);
        }
        db.prepare(`
          INSERT INTO app_metadata (key, value) VALUES ('crew_catalog_revision', ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `).run(String(manifest.revision));
        pruneSqliteCatalogOrphans(db, manifest);
        dedupeSqliteCatalogTitles(db, manifest);
      })
    : null;

  if (txn) {
    txn();
  } else {
    let processed = 0;
    for (const crew of manifest.crews) {
      const existing = db.prepare(`SELECT id FROM crew_catalog WHERE id = ?`).get(crew.id);
      upsert.run(
        crew.id,
        crew.callsign,
        crew.name,
        crew.title,
        crew.categoryId,
        crew.categoryLabel,
        crew.description,
        crew.systemPrompt,
        crew.tone,
        JSON.stringify(crew.expertise),
        JSON.stringify(crew.traits),
        crew.tools ? JSON.stringify(crew.tools) : null,
        crew.searchText,
        manifest.revision,
      );
      ftsDelete.run(crew.id);
      ftsInsert.run(crew.id, crew.searchText);
      if (existing) updated += 1;
      else inserted += 1;
      processed += 1;
      if (processed % 25 === 0 || processed === total) report(processed);
    }
    db.prepare(`
      INSERT INTO app_metadata (key, value) VALUES ('crew_catalog_revision', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(String(manifest.revision));
    pruneSqliteCatalogOrphans(db, manifest);
    dedupeSqliteCatalogTitles(db, manifest);
  }
  return { inserted, updated };
}

export function syncSqliteCrewFts(
  db: Parameters<typeof runSqliteCrewCatalogMigration>[0],
  crewId: string,
  searchText: string,
): void {
  db.prepare(`DELETE FROM crews_fts WHERE crew_id = ?`).run(crewId);
  if (searchText.trim()) {
    db.prepare(`INSERT INTO crews_fts(crew_id, search_text) VALUES (?, ?)`).run(crewId, searchText);
  }
}

export function backfillSqliteCrewSearchColumns(
  db: Parameters<typeof runSqliteCrewCatalogMigration>[0],
  crewFromRow: (row: Record<string, unknown>) => Crew,
): void {
  const rows = db.prepare(`SELECT * FROM crews`).all() as Array<Record<string, unknown>>;
  for (const row of rows) {
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
    db.prepare(`
      UPDATE crews SET source=?, catalog_id=COALESCE(catalog_id, ?), search_text=?, suggestable=COALESCE(suggestable, 1)
      WHERE id=?
    `).run(source, crew.catalogId ?? null, searchText, crew.id);
    syncSqliteCrewFts(db, crew.id, searchText);
  }
}

export function createSqliteCrewCatalogStore(
  db: Parameters<typeof runSqliteCrewCatalogMigration>[0] | null,
  memMode: boolean,
  crewFromRow: (row: Record<string, unknown>) => Crew,
): CrewCatalogStore {
  const store = {
    async getCatalogRevision(): Promise<number> {
      if (!db || memMode) return 0;
      const row = db.prepare(`SELECT value FROM app_metadata WHERE key='crew_catalog_revision'`).get();
      return row ? parseInt(row['value'] as string, 10) || 0 : 0;
    },

    async getCatalogCount(): Promise<number> {
      if (!db || memMode) return 0;
      const row = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get() as { c: number };
      return row?.c ?? 0;
    },

    async seedCatalog(manifest: CatalogManifest) {
      if (!db || memMode) return { inserted: 0, updated: 0 };
      return seedSqliteCatalog(db, manifest);
    },

    async ensureCatalogSeeded(): Promise<void> {
      if (!db || memMode) return;
      const count = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get() as { c: number };
      if ((count?.c ?? 0) > 0) return;
      const manifest = loadCatalogManifest();
      if (manifest) seedSqliteCatalog(db, manifest);
    },

    async searchCatalog(query: string, limit: number) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (memMode || !db) {
        const manifest = loadCatalogManifest();
        return manifest ? searchManifestCatalog(manifest, trimmed, limit) : [];
      }

      let ftsHits: Array<CatalogEntry & { ftsRank: number }> = [];
      const fts = escapeFtsQuery(trimmed);
      if (fts) {
        try {
          const rows = db.prepare(`
            SELECT c.*, (-bm25(crew_catalog_fts)) as fts_rank
            FROM crew_catalog_fts
            JOIN crew_catalog c ON c.id = crew_catalog_fts.catalog_id
            WHERE crew_catalog_fts MATCH ? AND c.active = 1
            ORDER BY fts_rank DESC
            LIMIT ?
          `).all(fts, limit) as Array<Record<string, unknown>>;
          ftsHits = rows.map((row) => ({ ...catalogFromRow(row), ftsRank: Number(row['fts_rank']) || 0 }));
        } catch {
          ftsHits = [];
        }
      }

      const like = catalogLikePattern(trimmed);
      const likeRows = db.prepare(`
        SELECT * FROM crew_catalog WHERE active = 1 AND search_text LIKE ? LIMIT ?
      `).all(like, limit) as Array<Record<string, unknown>>;
      const likeHits = likeRows.map((row, i) => ({ ...catalogFromRow(row), ftsRank: 0.5 - i * 0.01 }));

      return mergeCatalogSearchHits(ftsHits, likeHits, limit);
    },

    async listCategories() {
      if (!db || memMode) return [];
      const rows = db.prepare(`
        SELECT category_id as id, category_label as label, COUNT(*) as crew_count
        FROM crew_catalog
        WHERE active = 1
        GROUP BY category_id, category_label
        ORDER BY category_label
      `).all() as Array<Record<string, unknown>>;
      return mergeCategoryIconIds(rows.map((row) => ({
        id: row['id'] as string,
        label: row['label'] as string,
        crewCount: Number(row['crew_count']) || 0,
      })));
    },

    async listByCategory(categoryId: string, limit: number) {
      if (!db || memMode) return [];
      const rows = db.prepare(`
        SELECT * FROM crew_catalog
        WHERE active = 1 AND category_id = ?
        ORDER BY name
        LIMIT ?
      `).all(categoryId, limit) as Array<Record<string, unknown>>;
      return rows.map((row) => catalogEntryToSummary(catalogFromRow(row)));
    },

    async searchRosterCrews(query: string, limit: number) {
      if (!db || memMode) return [];
      const fts = escapeFtsQuery(query);
      if (!fts) return [];
      try {
        const rows = db.prepare(`
          SELECT cr.*, (-bm25(crews_fts)) as fts_rank
          FROM crews_fts
          JOIN crews cr ON cr.id = crews_fts.crew_id
          WHERE crews_fts MATCH ? AND cr.suggestable = 1
          ORDER BY fts_rank DESC
          LIMIT ?
        `).all(fts, limit) as Array<Record<string, unknown>>;
        return rows.map((row) => ({
          ...crewFromRow(row),
          ftsRank: Number(row['fts_rank']) || 0,
        }));
      } catch {
        const like = `%${query.toLowerCase().slice(0, 80)}%`;
        const rows = db.prepare(`
          SELECT * FROM crews WHERE suggestable = 1 AND search_text LIKE ? LIMIT ?
        `).all(like, limit) as Array<Record<string, unknown>>;
        return rows.map((row, i) => ({
          ...crewFromRow(row),
          ftsRank: 1 - i * 0.01,
        }));
      }
    },

    async getCatalogEntry(id: string) {
      if (!db || memMode) return null;
      const row = db.prepare(`SELECT * FROM crew_catalog WHERE id = ?`).get(id);
      return row ? catalogFromRow(row) : null;
    },

    async getCatalogByCallsign(callsign: string) {
      if (!db || memMode) return null;
      const row = db.prepare(`SELECT * FROM crew_catalog WHERE callsign = ?`).get(callsign);
      return row ? catalogFromRow(row) : null;
    },

    async listRecruitedCatalogIds(): Promise<Set<string>> {
      if (!db || memMode) return new Set();
      const rows = db.prepare(`SELECT catalog_id FROM crews WHERE catalog_id IS NOT NULL`).all() as Array<Record<string, unknown>>;
      return new Set(rows.map((r) => r['catalog_id'] as string));
    },

    async getSessionCrewPreferences(sessionId: string): Promise<SessionCrewPreferences> {
      const now = new Date().toISOString();
      if (!db || memMode) {
        return { sessionId, suggestionsDismissed: false, updatedAt: now };
      }
      const row = db.prepare(`SELECT * FROM session_crew_preferences WHERE session_id = ?`).get(sessionId);
      if (!row) {
        return { sessionId, suggestionsDismissed: false, updatedAt: now };
      }
      return {
        sessionId,
        suggestionsDismissed: !!(row['suggestions_dismissed']),
        dismissedAt: (row['dismissed_at'] as string) || undefined,
        lastSuggestionAt: (row['last_suggestion_at'] as string) || undefined,
        lastSuggestionTurnId: (row['last_suggestion_turn_id'] as string) || undefined,
        updatedAt: (row['updated_at'] as string) || now,
      };
    },

    async upsertSessionCrewPreferences(sessionId: string, patch: Partial<SessionCrewPreferences>): Promise<SessionCrewPreferences> {
      const existing = await store.getSessionCrewPreferences(sessionId);
      const merged: SessionCrewPreferences = {
        ...existing,
        ...patch,
        sessionId,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      };
      if (!db || memMode) return merged;
      db.prepare(`
        INSERT INTO session_crew_preferences (
          session_id, suggestions_dismissed, dismissed_at, last_suggestion_at,
          last_suggestion_turn_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          suggestions_dismissed=excluded.suggestions_dismissed,
          dismissed_at=excluded.dismissed_at,
          last_suggestion_at=excluded.last_suggestion_at,
          last_suggestion_turn_id=excluded.last_suggestion_turn_id,
          updated_at=excluded.updated_at
      `).run(
        sessionId,
        merged.suggestionsDismissed ? 1 : 0,
        merged.dismissedAt ?? null,
        merged.lastSuggestionAt ?? null,
        merged.lastSuggestionTurnId ?? null,
        merged.updatedAt,
      );
      return merged;
    },

    async getSessionCrewMessageCounts(sessionId: string): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      if (!db || memMode) return out;
      const rows = db.prepare(`
        SELECT crew_id, message_count FROM session_crew_states WHERE session_id = ?
      `).all(sessionId) as Array<Record<string, unknown>>;
      for (const row of rows) {
        out.set(row['crew_id'] as string, (row['message_count'] as number) ?? 0);
      }
      return out;
    },

    async getSessionEnabledCrewIds(sessionId: string): Promise<string[]> {
      if (!db || memMode) return [];
      const rows = db.prepare(`
        SELECT crew_id FROM session_crew_states
        WHERE session_id = ? AND enabled = 1
      `).all(sessionId) as Array<Record<string, unknown>>;
      return rows.map((row) => row['crew_id'] as string);
    },
  };
  return store;
}
