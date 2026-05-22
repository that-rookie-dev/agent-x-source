import type { Permission, PermissionDecision } from '@agentx/shared';

export class PermissionManager {
  private permissions: Map<string, Permission> = new Map();
  private sessionId = '';

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  check(toolName: string, path?: string): PermissionDecision | null {
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

  list(): Permission[] {
    return [...this.permissions.values()];
  }

  private makeKey(toolName: string, path?: string): string {
    return path ? `${toolName}:${path}` : toolName;
  }
}
