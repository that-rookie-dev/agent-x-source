import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../src/secret-sauce/MemoryManager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MemoryManager', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-mem-'));
    originalEnv = process.env['XDG_DATA_HOME'];
    process.env['XDG_DATA_HOME'] = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv) process.env['XDG_DATA_HOME'] = originalEnv;
    else delete process.env['XDG_DATA_HOME'];
  });

  it('starts with no memories', () => {
    const mm = new MemoryManager();
    expect(mm.getCount()).toBe(0);
  });

  it('adds memories', () => {
    const mm = new MemoryManager();
    mm.addMemory('User prefers TypeScript', 'preference');
    expect(mm.getCount()).toBe(1);
  });

  it('retrieves recent memories', () => {
    const mm = new MemoryManager();
    mm.addMemory('First memory', 'general');
    mm.addMemory('Second memory', 'general');
    const recent = mm.getRecentMemories(10);
    expect(recent).toHaveLength(2);
  });

  it('searches memories by content', () => {
    const mm = new MemoryManager();
    mm.addMemory('User likes TypeScript', 'preference');
    mm.addMemory('Project uses React', 'tech');

    const results = mm.searchMemories('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('TypeScript');
  });

  it('builds context string', () => {
    const mm = new MemoryManager();
    mm.addMemory('Important fact', 'general');
    const ctx = mm.buildContext();
    expect(ctx).toContain('[MEMORIES]');
    expect(ctx).toContain('Important fact');
  });

  it('returns empty context when no memories', () => {
    const mm = new MemoryManager();
    expect(mm.buildContext()).toBe('');
  });
});
