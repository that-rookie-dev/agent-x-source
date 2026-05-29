import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScopeGuard } from '../src/tools/permissions/ScopeGuard.js';
import { tmpdir, platform } from 'node:os';
import { join, sep } from 'node:path';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';

const isWindows = platform() === 'win32';
const isMacOS = platform() === 'darwin';

function getSystemPaths(): string[] {
  if (isWindows) {
    return [
      'C:\\Windows\\System32',
      'C:\\Program Files\\App',
      'C:\\Program Files (x86)\\App',
      'C:\\ProgramData\\SomeApp',
      'C:\\Users\\Public\\Documents',
      'D:\\',
      'E:\\',
    ];
  }
  const paths = [
    '/etc/passwd',
    '/root/.bashrc',
    '/var/log/system.log',
    '/usr/bin/bash',
    '/bin/sh',
    '/sbin/init',
    '/sys/devices/system/cpu',
    '/proc/1/status',
    '/dev/null',
    '/boot/vmlinuz',
    '/lib/libc.so.6',
    '/opt/app/file.txt',
    '/srv/www/index.html',
  ];
  if (isMacOS) {
    paths.push(
      '/private/var/db',
      '/private/etc/ssl',
      '/Volumes/ExternalDrive',
      '/System/Library',
      '/Users/otheruser',
    );
  }
  return paths;
}

describe('ScopeGuard', () => {
  const testScopeBase = join(tmpdir(), 'agentx-scope-test');
  let testScope: string;
  let scopeGuard: ScopeGuard;

  beforeEach(() => {
    testScope = join(testScopeBase, Date.now().toString());
    mkdirSync(testScope, { recursive: true });
    scopeGuard = new ScopeGuard(testScope);
  });

  afterEach(() => {
    try {
      rmSync(testScopeBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should allow paths within scope', () => {
    const testPath = join(testScope, 'subfolder', 'file.txt');
    const result = scopeGuard.validatePath(testPath);
    expect(result.valid).toBe(true);
    expect(result.resolved).toBe(testPath);
  });

  it('should allow subpaths of the scope', () => {
    const result = scopeGuard.validatePath(testScope);
    expect(result.valid).toBe(true);
  });

  it('should handle relative paths correctly', () => {
    const originalDir = process.cwd();
    try {
      process.chdir(testScope);
      const result = scopeGuard.validatePath('.' + sep + 'subfolder' + sep + 'file.txt');
      expect(result.valid).toBe(true);
    } finally {
      process.chdir(originalDir);
    }
  });

  it('should reject paths outside scope', () => {
    const badPath = isWindows
      ? 'C:\\Windows\\System32\\config'
      : '/etc/passwd';
    const result = scopeGuard.validatePath(badPath);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Access to system path');
  });

  it('should reject various dangerous system paths', () => {
    const dangerousPaths = getSystemPaths();

    for (const path of dangerousPaths) {
      const result = scopeGuard.validatePath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Access to system path');
    }
  });

  it('should handle Windows-style paths with drive letters', () => {
    const scopeOnC = new ScopeGuard(isWindows ? 'C:\\Users\\Me\\project' : '/home/me/project');
    const result = scopeOnC.validatePath(
      isWindows ? 'C:\\Windows\\System32' : '/etc/passwd'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Access to system path');
  });

  it('should reject symlinks that escape scope', () => {
    if (isWindows) return; // symlinks require admin/dev-mode on Windows

    const targetOutside = join(tmpdir(), 'outside-scope-' + Date.now());
    const symlinkInside = join(testScope, 'escape-link');

    writeFileSync(targetOutside, 'secret');
    symlinkSync(targetOutside, symlinkInside);

    const result = scopeGuard.validatePath(symlinkInside);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Symlink resolves outside scope');

    rmSync(targetOutside);
  });

  it('should allow symlinks that stay within scope', () => {
    if (isWindows) return;

    const targetInside = join(testScope, 'target-file');
    const symlinkInside = join(testScope, 'within-link');

    writeFileSync(targetInside, 'data');
    symlinkSync(targetInside, symlinkInside);

    const result = scopeGuard.validatePath(symlinkInside);
    expect(result.valid).toBe(true);

    rmSync(targetInside);
  });

  it('should detect /private bypass on macOS', () => {
    if (!isMacOS) return;

    // On macOS, /var is a symlink to /private/var.
    // Accessing /private/var/log directly should be blocked.
    const scope = new ScopeGuard('/Users/testuser/project');
    const result = scope.validatePath('/private/var/log/system.log');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Access to system path');
  });

  it('should allow paths within scope when scope is under /var on macOS', () => {
    if (!isMacOS) return;

    // On macOS, temp dir is under /var/folders/... which is under /private/var
    // This scope is already set up in beforeEach
    const result = scopeGuard.validatePath(join(testScope, 'test.txt'));
    expect(result.valid).toBe(true);
  });
});