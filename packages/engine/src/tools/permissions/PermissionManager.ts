import type { Permission, PermissionDecision } from '@agentx/shared';

export class PermissionManager {
  private permissions: Map<string, Permission> = new Map();
  private sessionId = '';
  private bypassPermissions = false;

  constructor() {}

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Reset all permissions for a new session */
  resetForNewSession(sessionId: string): void {
    this.permissions.clear();
    this.bypassPermissions = false;
    this.sessionId = sessionId;
  }

  check(toolName: string, path?: string): PermissionDecision | null {
    if (this.isAllAllowed()) return 'allow_always';
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
  }

  deny(toolName: string, path?: string): void {
    this.grant(toolName, 'deny', path);
  }

  revoke(toolName: string, path?: string): void {
    const key = this.makeKey(toolName, path);
    this.permissions.delete(key);
  }

  revokeAll(): void {
    this.permissions.clear();
    this.bypassPermissions = false;
  }

  allowAll(): void {
    this.permissions.set('__all__', {
      id: '__all__',
      sessionId: this.sessionId,
      toolName: '*',
      targetPath: null,
      decision: 'allow_always',
      createdAt: new Date().toISOString(),
    });
  }

  setBypassPermissions(enabled: boolean): void {
    this.bypassPermissions = enabled;
  }

  getBypassPermissions(): boolean {
    return this.bypassPermissions;
  }

  isAllAllowed(): boolean {
    return this.bypassPermissions || this.permissions.has('__all__');
  }

  list(): Permission[] {
    return [...this.permissions.values()];
  }

  private makeKey(toolName: string, path?: string): string {
    return path ? `${toolName}:${path}` : toolName;
  }
}
