import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CatalogManifest } from '@agentx/shared';
import { seedPgCatalog } from '../src/crew/postgres-crew-catalog.js';

const SAMPLE_MANIFEST: CatalogManifest = {
  revision: 14,
  categories: [{ id: 'test', label: 'Test' }],
  crews: [
    {
      id: 'crew-1',
      callsign: 'alpha',
      name: 'Alpha',
      title: 'Tester',
      categoryId: 'test',
      categoryLabel: 'Test',
      description: 'Desc',
      systemPrompt: 'Prompt',
      tone: 'calm',
      expertise: ['testing'],
      traits: ['precise'],
      tools: ['shell_exec'],
      tags: ['qa'],
      searchText: 'alpha tester',
      hubRevision: 14,
      active: true,
    },
  ],
};

function createMockPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO crew_catalog')) {
        return { rows: [{ inserted: true }] };
      }
      if (sql.includes('DELETE FROM crew_catalog')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id FROM crew_catalog')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO app_metadata')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: client.query,
  };
  return { pool, client, queries };
}

describe('seedPgCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('insert column count matches bound parameters per crew row', async () => {
    const { pool, queries } = createMockPool();
    await seedPgCatalog(pool as never, SAMPLE_MANIFEST);

    const insert = queries.find((q) => q.sql.includes('INSERT INTO crew_catalog'));
    expect(insert).toBeDefined();

    const columnMatch = insert!.sql.match(/INSERT INTO crew_catalog \(\s*([\s\S]*?)\s*\) VALUES/i);
    expect(columnMatch).toBeTruthy();
    const columns = columnMatch![1]
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    expect(columns).toHaveLength(15);
    expect(insert!.params).toHaveLength(15);
    expect(insert!.sql).not.toMatch(/hub_revision,\s*active,\s*updated_at/i);
  });
});
