import { describe, it, expect, afterEach } from 'vitest';
import { PostgresStorageAdapter } from '../src/storage/PostgresStorageAdapter.js';

describe('PostgresStorageAdapter pool options', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses config values when env vars are absent', () => {
    delete process.env['PG_POOL_MAX'];
    delete process.env['PG_POOL_IDLE_TIMEOUT_MS'];
    delete process.env['PG_CONNECTION_TIMEOUT_MS'];
    delete process.env['PG_POOL_ALLOW_EXIT_ON_IDLE'];

    const adapter = new PostgresStorageAdapter({
      connectionString: 'postgres://localhost:5432/test',
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
    });
    const pool = adapter.getPool();

    expect(pool.options.max).toBe(5);
    expect(pool.options.idleTimeoutMillis).toBe(10_000);
    expect(pool.options.connectionTimeoutMillis).toBe(3_000);
    expect(pool.options.allowExitOnIdle).toBe(false);

    adapter.close();
  });

  it('env vars override config values', () => {
    process.env['PG_POOL_MAX'] = '42';
    process.env['PG_POOL_IDLE_TIMEOUT_MS'] = '60000';
    process.env['PG_CONNECTION_TIMEOUT_MS'] = '10000';
    process.env['PG_POOL_ALLOW_EXIT_ON_IDLE'] = 'true';

    const adapter = new PostgresStorageAdapter({
      connectionString: 'postgres://localhost:5432/test',
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
      allowExitOnIdle: false,
    });
    const pool = adapter.getPool();

    expect(pool.options.max).toBe(42);
    expect(pool.options.idleTimeoutMillis).toBe(60_000);
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.allowExitOnIdle).toBe(true);

    adapter.close();
  });
});
