import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonaStore, DEFAULT_PERSONA, getPersonaStore, setPersonaStore } from '../src/persona/PersonaStore.js';

describe('PersonaStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-persona-'));
    setPersonaStore(new PersonaStore(tempDir));
  });

  afterEach(() => {
    setPersonaStore(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('load creates default file when missing', () => {
    const store = getPersonaStore();
    const persona = store.load();
    expect(persona.name).toBe(DEFAULT_PERSONA.name);
    expect(store.get().name).toBe(DEFAULT_PERSONA.name);
  });

  it('save + get roundtrip', () => {
    const store = getPersonaStore();
    store.load();
    const saved = store.save({
      name: 'FRIDAY',
      description: 'Test assistant',
      communicationStyle: 'casual',
      decisionMaking: 'aggressive',
      domainContext: 'Testing',
      traits: ['Fast', 'Direct'],
    });
    expect(saved.name).toBe('FRIDAY');
    expect(store.get().traits).toEqual(['Fast', 'Direct']);
  });

  it('reload picks up disk changes', () => {
    const store = getPersonaStore();
    store.load();
    writeFileSync(
      join(tempDir, 'persona.json'),
      JSON.stringify({ ...DEFAULT_PERSONA, name: 'CORTANA' }, null, 2),
      'utf-8',
    );
    const reloaded = store.reload();
    expect(reloaded.name).toBe('CORTANA');
  });
});
