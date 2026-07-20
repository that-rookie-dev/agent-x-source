import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrewManager } from '../src/secret-sauce/CrewManager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CrewManager', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-crew-'));
    originalEnv = process.env['XDG_DATA_HOME'];
    process.env['XDG_DATA_HOME'] = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv) process.env['XDG_DATA_HOME'] = originalEnv;
    else delete process.env['XDG_DATA_HOME'];
  });

  it('initializes with no crews when fresh', () => {
    const pm = new CrewManager();
    const crews = pm.list();
    expect(crews.length).toBe(0);
  });

  it('creates new crews', () => {
    const pm = new CrewManager();
    const crew = pm.create({
      id: 'custom',
      name: 'Custom',
      callsign: 'custom',
      systemPrompt: 'Be custom.',
      isDefault: false,
    });
    expect(crew.id).toBe('custom');
    expect(crew.name).toBe('Custom');
    expect(crew.systemPrompt).toBe('Be custom.');
    expect(crew.enabled).toBe(true);
    expect(pm.get('custom')).toBeDefined();
  });

  it('creates crew with title and expertise', () => {
    const pm = new CrewManager();
    const crew = pm.create({
      id: 'expert',
      name: 'Dr. Expert',
      title: 'AI Researcher',
      callsign: 'expert',
      systemPrompt: 'You are an expert.',
      expertise: ['AI', 'ML'],
      traits: ['analytical'],
      isDefault: false,
    });
    expect(crew.title).toBe('AI Researcher');
    expect(crew.expertise).toEqual(['AI', 'ML']);
    expect(crew.traits).toEqual(['analytical']);
  });

  it('enables and disables crews', () => {
    const pm = new CrewManager();
    pm.create({ id: 'toggle', name: 'Toggle', callsign: 'toggle', systemPrompt: 'test', isDefault: false });
    expect(pm.disable('toggle')).toBe(true);
    expect(pm.get('toggle')!.enabled).toBe(false);
    expect(pm.enable('toggle')).toBe(true);
    expect(pm.get('toggle')!.enabled).toBe(true);
  });

  it('lists only enabled crews', () => {
    const pm = new CrewManager();
    pm.create({ id: 'a', name: 'A', callsign: 'a', systemPrompt: 'a', isDefault: false });
    pm.create({ id: 'b', name: 'B', callsign: 'b', systemPrompt: 'b', isDefault: false, enabled: false });
    expect(pm.listEnabled().length).toBe(1);
    expect(pm.listEnabled()[0]!.id).toBe('a');
  });

  it('deletes crews', () => {
    const pm = new CrewManager();
    pm.create({ id: 'temp', name: 'Temp', callsign: 'temp', systemPrompt: 'temp', isDefault: false });
    expect(pm.delete('temp')).toBe(true);
    expect(pm.get('temp')).toBeUndefined();
  });

  it('cannot delete non-existent crew', () => {
    const pm = new CrewManager();
    expect(pm.delete('nonexistent')).toBe(false);
  });

  it('generates multi-crew system prompt', () => {
    const pm = new CrewManager();
    pm.create({ id: 'dev', name: 'Dev', callsign: 'dev', title: 'Developer', systemPrompt: 'You write code.', expertise: ['coding'], isDefault: false });
    const prompt = pm.getMultiCrewSystemPrompt();
    expect(prompt).toContain('Dev — Developer');
    expect(prompt).toContain('@dev');
    expect(prompt).toContain('coding');
  });

  it('updates crew properties', () => {
    const pm = new CrewManager();
    pm.create({ id: 'upd', name: 'Old', callsign: 'old', systemPrompt: 'old', isDefault: false });
    const updated = pm.update('upd', { name: 'New', title: 'Renamed', expertise: ['new-skill'] });
    expect(updated!.name).toBe('New');
    expect(updated!.title).toBe('Renamed');
    expect(updated!.expertise).toEqual(['new-skill']);
  });

  it('recovers missing crews from session host snapshots', () => {
    const pm = new CrewManager();
    const restored = pm.recoverFromSessionHosts([
      {
        id: 'orphan-1',
        name: 'Elena',
        callsign: 'elena',
        title: 'Luxury Travel Concierge',
        source: 'custom',
      },
    ]);
    expect(restored).toBe(1);
    expect(pm.get('orphan-1')?.title).toBe('Luxury Travel Concierge');
    // Idempotent — already present.
    expect(pm.recoverFromSessionHosts([{
      id: 'orphan-1',
      name: 'Elena',
      callsign: 'elena',
    }])).toBe(0);
  });

  it('writes a local crews.json backup on create', () => {
    const pm = new CrewManager();
    pm.create({
      id: 'backed-up',
      name: 'Backup',
      callsign: 'backup',
      systemPrompt: 'persist me',
      isDefault: false,
    });
    const again = new CrewManager();
    expect(again.get('backed-up')?.name).toBe('Backup');
  });
});