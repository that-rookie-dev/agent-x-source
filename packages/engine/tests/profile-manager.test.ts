import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileManager } from '../src/secret-sauce/ProfileManager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ProfileManager', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-profile-'));
    originalEnv = process.env['XDG_DATA_HOME'];
    process.env['XDG_DATA_HOME'] = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv) process.env['XDG_DATA_HOME'] = originalEnv;
    else delete process.env['XDG_DATA_HOME'];
  });

  it('initializes with bootstrap profile when fresh', () => {
    const pm = new ProfileManager();
    const profiles = pm.list();
    expect(profiles.length).toBe(1);
    expect(profiles[0]!.id).toBe('default');
  });

  it('has default as active profile', () => {
    const pm = new ProfileManager();
    expect(pm.getActiveId()).toBe('default');
    expect(pm.getActive().name).toBe('Default');
  });

  it('creates and switches profiles', () => {
    const pm = new ProfileManager();
    pm.create({
      id: 'devops',
      name: 'DevOps Engineer',
      systemPrompt: 'You are a DevOps engineer.',
      isDefault: false,
    });
    const result = pm.switch('devops');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('DevOps Engineer');
    expect(pm.getActiveId()).toBe('devops');
  });

  it('returns null when switching to nonexistent profile', () => {
    const pm = new ProfileManager();
    expect(pm.switch('nonexistent')).toBeNull();
  });

  it('gets system prompt for active profile', () => {
    const pm = new ProfileManager();
    const prompt = pm.getSystemPrompt();
    expect(prompt).toContain('capable');
  });

  it('creates new profiles with name + prompt only', () => {
    const pm = new ProfileManager();
    const profile = pm.create({
      id: 'custom',
      name: 'Custom',
      systemPrompt: 'Be custom.',
      isDefault: false,
    });
    expect(profile.id).toBe('custom');
    expect(profile.name).toBe('Custom');
    expect(profile.systemPrompt).toBe('Be custom.');
    expect(pm.get('custom')).toBeDefined();
  });

  it('deletes non-active profiles', () => {
    const pm = new ProfileManager();
    pm.create({ id: 'temp', name: 'Temp', systemPrompt: 'temp', isDefault: false });
    expect(pm.delete('temp')).toBe(true);
    expect(pm.get('temp')).toBeUndefined();
  });

  it('cannot delete active profile', () => {
    const pm = new ProfileManager();
    expect(pm.delete('default')).toBe(false);
  });

  it('cannot delete last remaining profile', () => {
    const pm = new ProfileManager();
    // Only 1 profile (default) exists
    expect(pm.delete('default')).toBe(false);
  });
});
