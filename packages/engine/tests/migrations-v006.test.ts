import { describe, it, expect } from 'vitest';

describe('migration registry', () => {
  it('contains the final 9 baseline migrations including prime_adoption, capabilities, engineering_crew, and phase_docs', async () => {
    const { MIGRATION_FILES } = await import('../src/db/migration-registry.js');
    const ids = MIGRATION_FILES.map((m) => m.name);

    expect(ids).toHaveLength(9);
    expect(ids.some((name) => name.includes('prime_adoption'))).toBe(true);
    expect(ids.some((name) => name.includes('capabilities'))).toBe(true);
    expect(ids.some((name) => name.includes('engineering_crew'))).toBe(true);
    expect(ids.some((name) => name.includes('engineering_crew_phase_docs'))).toBe(true);
  });
});
