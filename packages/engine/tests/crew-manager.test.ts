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

  it('has no active crew when fresh', () => {
    const pm = new CrewManager();
    expect(pm.getActiveId()).toBeNull();
    expect(pm.getActive()).toBeNull();
  });

  it('creates and switches crews', () => {
    const pm = new CrewManager();
    pm.create({
      id: 'devops',
      name: 'DevOps Engineer',
      callsign: 'devops',
      systemPrompt: 'You are a DevOps engineer.',
      isDefault: false,
    });
    const result = pm.switch('devops');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('DevOps Engineer');
    expect(pm.getActiveId()).toBe('devops');
  });

  it('returns null when switching to nonexistent crew member', () => {
    const pm = new CrewManager();
    expect(pm.switch('nonexistent')).toBeNull();
  });

  it('returns null system prompt when no active crew', () => {
    const pm = new CrewManager();
    expect(pm.getSystemPrompt()).toBeNull();
  });

  it('creates new crews with name + prompt only', () => {
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
    expect(pm.get('custom')).toBeDefined();
  });

  it('deletes non-active crews', () => {
    const pm = new CrewManager();
    pm.create({ id: 'temp', name: 'Temp', callsign: 'temp', systemPrompt: 'temp', isDefault: false });
    expect(pm.delete('temp')).toBe(true);
    expect(pm.get('temp')).toBeUndefined();
  });

  it('cannot delete non-existent crew member', () => {
    const pm = new CrewManager();
    expect(pm.delete('nonexistent')).toBe(false);
  });

  it('cannot delete last remaining crew member', () => {
    const pm = new CrewManager();
    const crew = pm.create({ id: 'sole', name: 'Sole', callsign: 'sole', systemPrompt: 'Sole crew', isDefault: false });
    pm.switch('sole');
    expect(pm.delete('sole')).toBe(false);
  });
});
