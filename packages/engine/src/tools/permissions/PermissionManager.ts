import type { Permission, PermissionDecision } from '@agentx/shared';

export class PermissionManager {
  private permissions: Map<string, Permission> = new Map();
  private sessionId = '';

  constructor() {}

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Reset all permissions for a new session */
  resetForNewSession(sessionId: string): void {
    this.permissions.clear();
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

  isAllAllowed(): boolean {
    return this.permissions.has('__all__');
  }

  list(): Permission[] {
    return [...this.permissions.values()];
  }

  private makeKey(toolName: string, path?: string): string {
    return path ? `${toolName}:${path}` : toolName;
  }
}
