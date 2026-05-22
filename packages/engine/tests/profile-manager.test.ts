import { describe, it, expect } from 'vitest';
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

  it('initializes with default profiles', () => {
    const pm = new ProfileManager();
    const profiles = pm.list();
    expect(profiles.length).toBeGreaterThanOrEqual(4);
  });

  it('has general as default active profile', () => {
    const pm = new ProfileManager();
    expect(pm.getActiveId()).toBe('general');
    expect(pm.getActive().name).toBe('General Assistant');
  });

  it('switches profiles', () => {
    const pm = new ProfileManager();
    const result = pm.switch('architect');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Software Architect');
    expect(pm.getActiveId()).toBe('architect');
  });

  it('returns null when switching to nonexistent profile', () => {
    const pm = new ProfileManager();
    expect(pm.switch('nonexistent')).toBeNull();
  });

  it('gets system prompt for active profile', () => {
    const pm = new ProfileManager();
    const prompt = pm.getSystemPrompt();
    expect(prompt).toContain('versatile');
  });

  it('creates new profiles', () => {
    const pm = new ProfileManager();
    const profile = pm.create({
      id: 'custom',
      name: 'Custom',
      description: 'A custom profile',
      systemPrompt: 'Be custom.',
      expertise: [],
      traits: [],
      toolPreferences: null,
      enabledTools: null,
      disabledTools: null,
      isDefault: false,
    });
    expect(profile.id).toBe('custom');
    expect(pm.get('custom')).toBeDefined();
  });

  it('deletes non-active profiles', () => {
    const pm = new ProfileManager();
    expect(pm.delete('writer')).toBe(true);
    expect(pm.get('writer')).toBeUndefined();
  });

  it('cannot delete active profile', () => {
    const pm = new ProfileManager();
    expect(pm.delete('general')).toBe(false);
  });
});
