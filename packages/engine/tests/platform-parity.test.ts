import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(relative(process.cwd(), full));
      }
    }
  }
  walk(dir);
  return files;
}

const SOURCE_DIR = 'packages/engine/src';
const ALL_SOURCE = getAllSourceFiles(SOURCE_DIR).filter(
  (f) => !f.includes('node_modules') && !f.includes('dist')
);

type PlatformIssue = {
  file: string;
  line: string;
  issue: string;
  platform: 'windows' | 'macos' | 'linux' | 'all';
};

function findPlatformIssues(): PlatformIssue[] {
  const issues: PlatformIssue[] = [];

  for (const file of ALL_SOURCE) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      const location = `${file}:${lineNum}`;

      // Check: Unix-only commands without platform guards
      if (line.includes('execSync') || line.includes('spawn')) {
        // Check for hardcoded 'sh' shell (except in platform.ts itself)
        if (line.match(/['"]sh['"][,\s)]/) && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "sh" shell. Use getShellCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'ps aux' (Unix-only)
        if (line.includes('ps aux') && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "ps aux" command. Use getProcessListCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'which' (Unix-only)
        if (line.match(/['"]which /) && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "which" command. Use getWhichCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'grep' (Unix-only) — catches "grep, 'grep, and `grep
        if (line.match(/[`"']grep /) && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "grep" command. Use getGrepCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'find' (Unix-only)
        if (line.match(/['"]find /) && !file.includes('platform.ts') && !file.includes('.test.')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "find" command. Use getFindCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'du' (Unix-only)
        if (line.includes('du -') && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "du" command. Use getDirectorySizeCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'sips' (macOS-only) — only flag if NOT inside IS_MACOS guard
        const isAfterGuard = lines.slice(Math.max(0, i - 10), i).some(
          (l) => l.trim() === 'if (IS_MACOS) {' || l.trim() === 'if (IS_MACOS)'
        );
        if (line.includes('sips') && !file.includes('platform.ts') && !file.includes('.test.') && !isAfterGuard) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "sips" command. Guard with IS_MACOS from platform.js first.',
            platform: 'all',
          });
        }

        // Check for hardcoded 'df' (no Windows support)
        if (line.match(/['"]df /) && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "df" command. Use getDiskSpaceCommand() from platform.js instead.',
            platform: 'windows',
          });
        }

        // Check for hardcoded 'ss' or 'lsof' (no Windows support)
        if ((line.includes('ss -') || line.includes('lsof ')) && !file.includes('platform.ts')) {
          issues.push({
            file: location, line: line.trim(),
            issue: 'Hardcoded "ss"/"lsof" command. Use getPortListCommand() from platform.js instead.',
            platform: 'windows',
          });
        }
      }

      // Check: Hardcoded Unix paths in shell commands
      if (line.includes('execSync') || line.includes('spawn')) {
        const unixBinPaths = ['/bin/', '/usr/bin/', '/usr/local/bin/'];
        for (const prefix of unixBinPaths) {
          if (line.includes(prefix) && !line.includes('DANGEROUS_PATHS') && !file.includes('platform.ts')) {
            issues.push({
              file: location, line: line.trim(),
              issue: `Hardcoded path "${prefix}" — may not exist on other platforms.`,
              platform: 'windows',
            });
          }
        }
      }
    }
  }

  return issues;
}

describe('Cross-Platform Parity', () => {
  const issues = findPlatformIssues();

  describe('No platform-specific commands outside of platform.ts', () => {
    const windowsIssues = issues.filter((i) => i.platform === 'windows');
    const allIssues = issues.filter((i) => i.platform === 'all');

    it('should not contain unguarded Windows-incompatible commands', () => {
      if (windowsIssues.length > 0) {
        console.log('\n=== Windows-Incompatible Commands Found ===');
        for (const issue of windowsIssues) {
          console.log(`  ${issue.file}`);
          console.log(`  Issue: ${issue.issue}`);
          console.log(`  Line:  ${issue.line}\n`);
        }
      }
      expect(windowsIssues.length).toBe(0);
    });

    it('should guard platform-specific tools (sips, etc.) with IS_MACOS check', () => {
      if (allIssues.length > 0) {
        console.log('\n=== Unguarded Platform-Specific Commands Found ===');
        for (const issue of allIssues) {
          console.log(`  ${issue.file}`);
          console.log(`  Issue: ${issue.issue}`);
          console.log(`  Line:  ${issue.line}\n`);
        }
      }
      expect(allIssues.length).toBe(0);
    });
  });

  describe('Core engine should use platform abstraction', () => {
    it('should import platform.js in tools that use platform-specific shell commands', () => {
      // Files that use cross-platform commands (git, npm, docker, etc.) don't need platform.js
      const criticalTools = [
        'shell.ts', 'system.ts', 'filesystem.ts', 'image.ts', 'code.ts',
      ];
      const missing = criticalTools.filter((t) => {
        const content = readFileSync(`${SOURCE_DIR}/tools/builtin/${t}`, 'utf-8');
        return (
          (content.includes('execSync') || content.includes('spawn')) &&
          !content.includes("from '../platform.js'")
        );
      });
      if (missing.length > 0) {
        console.log('\n=== Critical tools missing platform.js import ===');
        for (const f of missing) {
          console.log(`  ${f}`);
        }
      }
      expect(missing.length).toBe(0);
    });
  });
});
