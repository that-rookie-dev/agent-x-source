import type { Pool } from 'pg';
import { generateId } from '@agentx/shared';
import type { StorablePermission } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the permission helpers. Mirrors the relevant private
 * state/methods of PostgresStorageAdapter so the extracted functions can
 * operate without `this`.
 */
export interface PermissionContext {
  pool: Pool;
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

export function addPermission(
  ctx: PermissionContext,
  sessionIdOrPerm: string | StorablePermission,
  perm?: Omit<StorablePermission, 'id' | 'createdAt' | 'sessionId'>,
): void {
  if (typeof sessionIdOrPerm === 'object') {
    const p = sessionIdOrPerm;
    addPermissionEntry(ctx, p.sessionId, {
      id: p.id,
      toolName: p.toolName,
      targetPath: p.targetPath ?? null,
      decision: p.decision,
    });
    return;
  }
  addPermissionEntry(ctx, sessionIdOrPerm, {
    toolName: perm!.toolName,
    targetPath: perm!.targetPath ?? null,
    decision: perm!.decision,
  });
}

export function addPermissionEntry(
  ctx: PermissionContext,
  sessionId: string,
  perm: { id?: string; toolName: string; targetPath: string | null; decision: string },
): void {
  const id = perm.id ?? generateId();
  const now = new Date().toISOString();
  const entry: StorablePermission = {
    id, sessionId, toolName: perm.toolName, targetPath: perm.targetPath,
    decision: perm.decision, createdAt: now,
  };
  const arr = ctx.cache.permissions.get(sessionId) ?? [];
  arr.push(entry);
  ctx.cache.permissions.set(sessionId, arr);
  ctx.write(
    'INSERT INTO permissions (id,session_id,tool_name,target_path,decision) VALUES ($1,$2,$3,$4,$5)',
    [id, sessionId, perm.toolName, perm.targetPath, perm.decision]
  );
}

export function getPermissions(
  ctx: PermissionContext,
  sessionId: string,
): StorablePermission[] {
  return ctx.cache.permissions.get(sessionId) ?? [];
}

export async function getPermissionsAsync(
  ctx: PermissionContext,
  sessionId: string,
): Promise<StorablePermission[]> {
  try {
    const result = await ctx.pool.query(
      `SELECT id,session_id as "sessionId",tool_name as "toolName",target_path as "targetPath",decision,created_at as "createdAt"
       FROM permissions WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows as StorablePermission[];
  } catch { return []; }
}

export function removePermissions(
  ctx: PermissionContext,
  sessionId: string,
  toolName?: string,
): void {
  const arr = ctx.cache.permissions.get(sessionId) ?? [];
  if (toolName) {
    const next = arr.filter((p) => p.toolName !== toolName && p.id !== toolName);
    if (next.length) ctx.cache.permissions.set(sessionId, next);
    else ctx.cache.permissions.delete(sessionId);
    ctx.write('DELETE FROM permissions WHERE session_id = $1 AND tool_name = $2', [sessionId, toolName]);
    return;
  }
  ctx.cache.permissions.delete(sessionId);
  ctx.write('DELETE FROM permissions WHERE session_id = $1', [sessionId]);
}
