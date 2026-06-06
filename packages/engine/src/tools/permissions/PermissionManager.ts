import type { Permission, PermissionDecision } from '@agentx/shared';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../../config/paths.js';

export class PermissionManager {
  private permissions: Map<string, Permission> = new Map();
  private sessionId = '';
  private persistPath: string;

  constructor() {
    const dir = getSecretSauceDir();
    this.persistPath = join(dir, 'PERMISSIONS.md');
    this.loadFromDisk();
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  check(toolName: string, path?: string): PermissionDecision | null {
    if (this.permissions.has('__all__')) return 'allow_always';
    const key = this.makeKey(toolName, path);
    const permission = this.permissions.get(key) ?? this.permissions.get(toolName);
    if (!permission) return null;
    return permission.decision;
  }

  grant(toolName: string, decision: PermissionDecision, path?: string): void {
    const key = this.makeKey(toolName, path);
    this.permissions.set(key, {
      id: key,
      sessionId: this.sessionId,
      toolName,
      targetPath: path ?? null,
      decision,
      createdAt: new Date().toISOString(),
    });
    // Persist "always" decisions to disk
    if (decision === 'allow_always') {
      this.saveToDisk();
    }
  }

  deny(toolName: string, path?: string): void {
    this.grant(toolName, 'deny', path);
    this.saveToDisk();
  }

  revoke(toolName: string, path?: string): void {
    const key = this.makeKey(toolName, path);
    this.permissions.delete(key);
    this.saveToDisk();
  }

  revokeAll(): void {
    this.permissions.clear();
    this.saveToDisk();
  }

  /**
   * Bypass all permission checks — grants `allow_always` for any tool.
   * Used in CI/CD mode when --allow-all-tools is specified.
   */
  allowAll(): void {
    // Store a sentinel that overrides all checks
    this.permissions.set('__all__', {
      id: '__all__',
      sessionId: this.sessionId,
      toolName: '*',
      targetPath: null,
      decision: 'allow_always',
      createdAt: new Date().toISOString(),
    });
    // Persist to disk so it survives restarts
    this.saveToDisk();
  }

  isAllAllowed(): boolean {
    return this.permissions.has('__all__');
  }

  list(): Permission[] {
    return [...this.permissions.values()];
  }

  private makeKey(toolName: string, path?: string): string {
    return path ? `${toolName}:${path}` : toolName;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const content = readFileSync(this.persistPath, 'utf-8');

      // Parse markdown table format
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.startsWith('| ') || line.startsWith('| Tool') || line.startsWith('|---')) continue;
        const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
        if (cols.length >= 3) {
          const toolName = cols[0] ?? '';
          const rawPath = cols[1] ?? '*';
          const targetPath = rawPath === '*' ? undefined : rawPath;
          const decisionRaw = (cols[2] ?? '').trim();
          
          // Validate decision is a known value
          if (decisionRaw !== 'allow_always' && decisionRaw !== 'deny') {
            continue;
          }
          
          const decision = decisionRaw as PermissionDecision;
          
          // Handle the __all__ sentinel (loaded as tool '*' with path '*')
          if (toolName === '*' && !targetPath) {
            this.permissions.set('__all__', {
              id: '__all__',
              sessionId: 'persisted',
              toolName: '*',
              targetPath: null,
              decision,
              createdAt: cols[3] ?? new Date().toISOString(),
            });
            continue;
          }
          
          const key = this.makeKey(toolName, targetPath);
          this.permissions.set(key, {
            id: key,
            sessionId: 'persisted',
            toolName,
            targetPath: targetPath ?? null,
            decision,
            createdAt: cols[3] ?? new Date().toISOString(),
          });
        }
      }
    } catch {
      // Ignore read errors — fresh start
    }
  }

  private saveToDisk(): void {
    try {
      const dir = getSecretSauceDir();
      mkdirSync(dir, { recursive: true });

      // Only persist allow_always and deny decisions (not allow_once)
      const persistent = [...this.permissions.values()].filter(
        (p) => p.decision === 'allow_always' || p.decision === 'deny',
      );

      const lines = [
        '# Agent-X Permissions',
        '',
        'Persisted permission decisions. Edit this file to manage tool access.',
        '',
        '| Tool | Path | Decision | Date |',
        '|------|------|----------|------|',
      ];

      for (const p of persistent) {
        // Save the __all__ sentinel as '*' with path '*'
        const toolName = p.id === '__all__' ? '*' : p.toolName;
        lines.push(`| ${toolName} | ${p.targetPath ?? '*'} | ${p.decision} | ${p.createdAt} |`);
      }

      lines.push('');
      writeFileSync(this.persistPath, lines.join('\n'), 'utf-8');
    } catch {
      // Silently fail — non-critical
    }
  }
}
