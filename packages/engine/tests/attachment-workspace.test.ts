import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AttachmentResolver } from '../src/communication/AttachmentResolver.js';

describe('AttachmentResolver workspace hardening', () => {
  it('rejects source=workspace paths outside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ws-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-out-'));
    const outsideFile = join(outside, 'secret.txt');
    writeFileSync(outsideFile, 'nope');

    const resolver = new AttachmentResolver();
    resolver.setWorkspaceRoot(root);
    const [out] = await resolver.resolve([{
      id: 'a1',
      type: 'file',
      name: 'secret.txt',
      source: 'workspace',
      originalPath: outsideFile,
    }]);

    expect(out!.content).toContain('outside workspace');
    expect(out!.storageId).toBeUndefined();
  });

  it('accepts source=workspace paths inside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ws-'));
    const insideFile = join(root, 'notes.txt');
    writeFileSync(insideFile, 'hello');

    const resolver = new AttachmentResolver();
    resolver.setWorkspaceRoot(root);
    const [out] = await resolver.resolve([{
      id: 'a2',
      type: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      source: 'workspace',
      originalPath: insideFile,
    }]);

    expect(out!.content).toBe('');
    expect(out!.storageId).toBeTruthy();
  });

  it('rejects workspace symlink that escapes the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ws-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-out-'));
    const outsideFile = join(outside, 'leak.txt');
    writeFileSync(outsideFile, 'leak');
    const linkPath = join(root, 'escape.txt');
    try {
      symlinkSync(outsideFile, linkPath);
    } catch {
      // Some CI environments disallow symlinks — skip.
      return;
    }

    const resolver = new AttachmentResolver();
    resolver.setWorkspaceRoot(root);
    const [out] = await resolver.resolve([{
      id: 'a3',
      type: 'file',
      name: 'escape.txt',
      source: 'workspace',
      originalPath: linkPath,
    }]);

    expect(out!.content).toContain('outside workspace');
  });

  it('still allows tool/mcp originalPath outside workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ws-'));
    mkdirSync(root, { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), 'ax-out-'));
    const outsideFile = join(outside, 'tool.txt');
    writeFileSync(outsideFile, 'tool');

    const resolver = new AttachmentResolver();
    resolver.setWorkspaceRoot(root);
    const [out] = await resolver.resolve([{
      id: 'a4',
      type: 'file',
      name: 'tool.txt',
      mimeType: 'text/plain',
      source: 'tool',
      originalPath: outsideFile,
    }]);

    // Tool paths are not workspace-gated (may still fail register in odd envs).
    expect(out!.content ?? '').not.toContain('outside workspace');
  });

  it('resolves workspace folders as directory hints (no file extract)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-ws-'));
    const bills = join(root, 'bills');
    mkdirSync(bills, { recursive: true });
    writeFileSync(join(bills, 'jan.pdf'), 'pdf');

    const resolver = new AttachmentResolver();
    resolver.setWorkspaceRoot(root);
    const [out] = await resolver.resolve([{
      id: 'a5',
      type: 'folder',
      name: 'bills',
      mimeType: 'inode/directory',
      source: 'workspace',
      originalPath: bills,
    }]);

    expect(out!.type).toBe('folder');
    expect(out!.storageId).toBeUndefined();
    expect(out!.content).toContain('Attached workspace folder');
    expect(out!.content).toContain(bills);
    expect(out!.content).toContain('list_dir');
  });
});
