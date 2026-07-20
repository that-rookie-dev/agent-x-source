import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engineSrc = join(import.meta.dirname, '../src');

function readEngine(relativePath: string): string {
  return readFileSync(join(engineSrc, relativePath), 'utf-8');
}

describe('memory cleanup acceptance (Phase C–E)', () => {
  it('agent-prompt does not register Soul section', () => {
    const source = readEngine('agent/agent-prompt.ts');
    expect(source).not.toContain('createSoulSection');
    expect(source).not.toMatch(/\[SOUL\]/);
  });

  it('prompt assembly exports no Soul or legacy neural section builders', async () => {
    const sections = await import('../src/prompt/assembly/sections.js');
    expect(sections).not.toHaveProperty('createSoulSection');
    expect(sections).not.toHaveProperty('createNeuralSection');
  });

  it('agent-memory uses Memory Fabric ingesters only', () => {
    const source = readEngine('agent/agent-memory.ts');
    expect(source).not.toContain('secretSauce');
    expect(source).not.toContain('MemoryExtractor');
    expect(source).toContain('ChatTurnMemoryIngester');
  });

  it('runtime code has no agent_persona SQL (baseline + drop migration only)', () => {
    const adapter = readEngine('storage/PostgresStorageAdapter.ts');
    const hydration = readEngine('storage/pg-hydration.ts');
    expect(adapter).not.toMatch(/getPersona\s*\(/);
    expect(adapter).not.toMatch(/setPersona\s*\(/);
    expect(hydration).not.toContain('agent_persona');
  });
});
