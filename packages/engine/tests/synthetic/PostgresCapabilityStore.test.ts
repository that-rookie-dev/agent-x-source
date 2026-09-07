import { describe, it, expect } from 'vitest';
import { PostgresCapabilityStore } from '../../src/synthetic/PostgresCapabilityStore.js';
import { MIGRATION_FILES } from '../../src/db/migration-registry.js';

describe('PostgresCapabilityStore', () => {
  it('issues INSERT for a new capability', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const store = new PostgresCapabilityStore({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    });
    const now = Date.now();
    await store.insertCapability({
      id: 'cap1', kind: 'skill', name: 'n', description: 'd', createdAt: now, updatedAt: now,
      createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'proposed',
      useCount: 0, trialCount: 0, promptTemplate: 'p', triggerPattern: 't', exampleCalls: [],
    });
    expect(calls[0]?.sql).toMatch(/INSERT INTO capabilities/);
  });

  it('reads tool_executions aggregates', async () => {
    const store = new PostgresCapabilityStore({
      query: async () => ({
        rows: [{ tool_name: 'shell_exec', frequency: 9, last_at: new Date().toISOString() }],
      }),
    });
    const rows = await store.listToolExecutionAggregates(3);
    expect(rows[0]?.toolName).toBe('shell_exec');
    expect(rows[0]?.frequency).toBe(9);
  });

  it('retries transient connection errors then succeeds', async () => {
    let n = 0;
    const store = new PostgresCapabilityStore({
      query: async (sql) => {
        n += 1;
        if (n === 1 && /INSERT INTO capabilities/.test(sql)) throw new Error('connection reset ECONNRESET');
        return { rows: [] };
      },
    });
    const now = Date.now();
    await store.insertCapability({
      id: 'cap1', kind: 'skill', name: 'n', description: 'd', createdAt: now, updatedAt: now,
      createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'proposed',
      useCount: 0, trialCount: 0, promptTemplate: 'p', triggerPattern: 't', exampleCalls: [],
    });
    expect(n).toBeGreaterThan(1);
  });

  it('migrates from empty DB through the consolidated SI capabilities baseline', () => {
    const versions = MIGRATION_FILES.filter((m) => m.name === 'capabilities');
    expect(versions.map((m) => m.version)).toEqual([7]);
    const latest = MIGRATION_FILES.find((m) => m.version === 7)!;
    expect(latest.sql).toContain('rejected_count');
    expect(latest.sql).toContain('capability_audit_events');
  });

  it('surfaces non-transient errors', async () => {
    const store = new PostgresCapabilityStore({
      query: async () => {
        throw new Error('invalid data');
      },
    });
    await expect(store.getCapability('missing')).rejects.toThrow(/invalid data/);
  });
});
