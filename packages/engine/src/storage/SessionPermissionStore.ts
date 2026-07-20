import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataDir } from '@agentx/shared';
import type { PermissionDecision, StorablePermission } from '@agentx/shared';

export interface StoredPermissionState {
  bypassPermissions: boolean;
  decisions: Array<Pick<StorablePermission, 'toolName' | 'targetPath' | 'decision'>>;
}

/**
 * File-backed store for per-session permission overrides and the bypass flag.
 *
 * Stored at `{dataDir}/sessions/{sessionId}/permissions.json`.
 */
export class SessionPermissionStore {
  private filePath: string;
  private state: StoredPermissionState;

  constructor(sessionId: string) {
    this.filePath = join(getDataDir(), 'sessions', sessionId, 'permissions.json');
    this.state = this.load();
  }

  getBypassPermissions(): boolean {
    return this.state.bypassPermissions;
  }

  setBypass(enabled: boolean): void {
    this.state.bypassPermissions = enabled;
    this.save();
  }

  recordGrant(toolName: string, decision: PermissionDecision, targetPath?: string | null): void {
    const normalizedPath = targetPath ?? null;
    this.state.decisions = this.state.decisions.filter(
      (d) => !(d.toolName === toolName && d.targetPath === normalizedPath),
    );
    this.state.decisions.push({ toolName, targetPath: normalizedPath, decision });
    this.save();
  }

  getDecisions(): StoredPermissionState['decisions'] {
    return this.state.decisions;
  }

  revokeAll(): void {
    this.state = { bypassPermissions: false, decisions: [] };
    this.save();
  }

  removeGrant(toolName: string, targetPath?: string | null): void {
    const normalizedPath = targetPath ?? null;
    this.state.decisions = this.state.decisions.filter(
      (d) => !(d.toolName === toolName && d.targetPath === normalizedPath),
    );
    this.save();
  }

  private load(): StoredPermissionState {
    if (!existsSync(this.filePath)) {
      return { bypassPermissions: false, decisions: [] };
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoredPermissionState>;
      return {
        bypassPermissions: !!raw.bypassPermissions,
        decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
      };
    } catch {
      return { bypassPermissions: false, decisions: [] };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // best-effort persistence
    }
  }
}
