/**
 * Permission handling helpers extracted from Agent.ts (REFACTOR-2).
 */
import { randomUUID } from 'node:crypto';
import type { PermissionDecision, PermissionHandlerResult, EngineEvent } from '@agentx/shared';
import { isPermissionExemptTool } from '../tools/permissions/exempt-tools.js';
import { summarizePermissionArgs } from './agent-helpers.js';



export interface PermissionContext {
  toolExecutor: {
    setPermissionRequestHandler(handler: (toolId: string, path: string, riskLevel: string, context?: { args?: unknown; integrationPreview?: string }) => Promise<PermissionHandlerResult>): void;
    isTurnAborted(): boolean;
    getPermissionManager(): {
      check(toolId: string, path?: string): PermissionDecision | undefined;
      grant(toolId: string, decision: PermissionDecision, path?: string): void;
      deny(toolId: string, path?: string): void;
      allowAll(): void;
      isAllAllowed(): boolean;
    };
  } | null | undefined;
  options: { automationRun?: boolean };
  isDelegatedWorker: boolean;
  turnApprovedAll: boolean;
  userCancelledTurn: boolean;
  pendingPermissions: Map<string, { resolve: (choice: PermissionHandlerResult) => void; toolName: string; path: string; riskLevel: string }>;
  emit(event: EngineEvent): void;
  persistPermissionGrant(toolId: string, decision: PermissionDecision): void;
  /** Permission-request queue: process one at a time. */
  permissionQueue?: Array<{
    toolId: string;
    path: string;
    riskLevel: string;
    context?: { args?: unknown; integrationPreview?: string };
    resolve: (value: PermissionHandlerResult) => void;
  }>;
  activePermissionId?: string | null;
  /** Finish the active request and optionally drain the queue. */
  processPermissionQueue?: (choice?: PermissionHandlerResult) => void;
}

export function bindPermissionHandler(ctx: PermissionContext): void {
  if (!ctx.toolExecutor || ctx.options.automationRun) return;

  const queue: NonNullable<PermissionContext['permissionQueue']> = [];
  ctx.permissionQueue = queue;

  let active: { requestId: string; resolve: (value: PermissionHandlerResult) => void; timer: ReturnType<typeof setInterval> | null } | null = null;

  const clearActive = () => {
    if (!active) return;
    if (active.timer) {
      clearInterval(active.timer);
      active.timer = null;
    }
    ctx.pendingPermissions.delete(active.requestId);
    ctx.activePermissionId = null;
    active = null;
  };

  const processQueue = (choice?: PermissionHandlerResult) => {
    clearActive();
    if (choice !== undefined) {
      while (queue.length > 0) {
        queue.shift()!.resolve(choice);
      }
      return;
    }

    const next = queue.shift();
    if (!next) return;

    const requestId = randomUUID();
    active = { requestId, resolve: next.resolve, timer: null };
    ctx.pendingPermissions.set(requestId, {
      resolve: next.resolve,
      toolName: next.toolId,
      path: next.path,
      riskLevel: next.riskLevel,
    });
    ctx.activePermissionId = requestId;

    const { commandPreview, argsSummary } = summarizePermissionArgs(next.context?.args as Record<string, unknown> | undefined);
    ctx.emit({
      type: 'permission_required',
      requestId,
      tool: next.toolId,
      path: next.path,
      riskLevel: next.riskLevel,
      integrationPreview: next.context?.integrationPreview,
      ...(commandPreview ? { commandPreview } : {}),
      ...(argsSummary ? { argsSummary } : {}),
    } as EngineEvent);

    const rePrompt = () => {
      // Guard: if the permission was already resolved (e.g. user enabled bypass
      // mode or granted allow_always after the prompt was shown), stop the timer
      // and do NOT re-emit the permission_required event. Without this check,
      // the 15-second re-prompt timer keeps firing even after the user has
      // responded, causing the popup to reappear endlessly.
      const pm = ctx.toolExecutor?.getPermissionManager();
      if (!pm) { clearActive(); return; }
      if (pm.isAllAllowed()) { clearActive(); return; }
      const existing = pm.check(next.toolId, next.path);
      if (existing === 'allow_always' || existing === 'allow_once') { clearActive(); return; }
      if (existing === 'deny') { clearActive(); return; }
      if (ctx.userCancelledTurn || ctx.toolExecutor?.isTurnAborted()) { clearActive(); return; }
      ctx.emit({
        type: 'permission_required',
        requestId,
        tool: next.toolId,
        path: next.path,
        riskLevel: next.riskLevel,
        rePrompt: true,
        integrationPreview: next.context?.integrationPreview,
        ...(commandPreview ? { commandPreview } : {}),
        ...(argsSummary ? { argsSummary } : {}),
      } as EngineEvent);
    };
    active.timer = setInterval(rePrompt, 15000);
  };

  ctx.processPermissionQueue = processQueue;

  ctx.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel, context) => {
    if (isPermissionExemptTool(toolId)) return 'allow_once';
    if (ctx.userCancelledTurn || ctx.toolExecutor?.isTurnAborted()) return 'deny';
    if (ctx.toolExecutor?.getPermissionManager().isAllAllowed()) return 'allow_once';
    if (ctx.isDelegatedWorker || ctx.turnApprovedAll) return 'allow_once';
    if (ctx.userCancelledTurn) return 'deny';

    return new Promise<PermissionHandlerResult>((resolve) => {
      queue.push({ toolId, path, riskLevel, context, resolve });
      if (!active) processQueue();
    });
  });
}

export async function ensureAutomationToolsApproved(
  ctx: PermissionContext,
  toolIds: string[],
): Promise<{ ok: boolean; denied?: string[]; error?: string }> {
  const executor = ctx.toolExecutor;
  if (!executor || toolIds.length === 0) return { ok: true };

  const unique = [...new Set(toolIds)];
  for (const toolId of unique) {
    const existing = executor.getPermissionManager().check(toolId, '*')
      ?? executor.getPermissionManager().check(toolId);
    if (existing === 'allow_always') continue;
    executor.getPermissionManager().grant(toolId, 'allow_always');
    ctx.persistPermissionGrant(toolId, 'allow_always');
  }
  return { ok: true };
}

export function grantAutomationNotifyTools(ctx: PermissionContext, toolIds: string[]): void {
  const executor = ctx.toolExecutor;
  if (!executor || toolIds.length === 0) return;
  for (const toolId of toolIds) {
    executor.getPermissionManager().grant(toolId, 'allow_always');
    ctx.persistPermissionGrant(toolId, 'allow_always');
  }
}

export function resolvePermissionRequest(ctx: PermissionContext, requestId: string, result: PermissionHandlerResult): void {
  const entry = ctx.pendingPermissions.get(requestId);
  if (!entry) return;
  if (typeof result === 'string' && result === 'allow_always') {
    ctx.toolExecutor?.getPermissionManager().grant(entry.toolName, 'allow_always');
    ctx.persistPermissionGrant(entry.toolName, 'allow_always');
  } else if (typeof result === 'string' && result === 'allow_once') {
    // Persist the one-time grant so the same tool is not re-prompted repeatedly in one turn/session.
    ctx.toolExecutor?.getPermissionManager().grant(entry.toolName, 'allow_once');
  } else if (typeof result === 'string' && result === 'deny') {
    // Persist the deny decision so the tool is not re-prompted in future turns.
    ctx.toolExecutor?.getPermissionManager().deny(entry.toolName, entry.path);
    ctx.persistPermissionGrant(entry.toolName, 'deny');
  }
  entry.resolve(result);
  ctx.pendingPermissions.delete(requestId);
  ctx.processPermissionQueue?.();
}

export function respondToPermissionBatch(
  ctx: PermissionContext,
  choice: 'allow_once' | 'allow_always' | 'deny',
): void {
  if (choice === 'allow_always') {
    ctx.toolExecutor?.getPermissionManager().allowAll();
    ctx.persistPermissionGrant('*', 'allow_always');
  } else if (choice !== 'deny') {
    ctx.turnApprovedAll = true;
  }
  for (const [id, entry] of ctx.pendingPermissions) {
    if (choice === 'allow_always') {
      ctx.toolExecutor?.getPermissionManager().grant(entry.toolName, 'allow_always');
      ctx.persistPermissionGrant(entry.toolName, 'allow_always');
    } else if (choice === 'deny') {
      // Persist each deny so the tools are not re-prompted in future turns.
      ctx.toolExecutor?.getPermissionManager().deny(entry.toolName, entry.path);
      ctx.persistPermissionGrant(entry.toolName, 'deny');
    }
    entry.resolve(choice);
    ctx.pendingPermissions.delete(id);
  }
  ctx.processPermissionQueue?.(choice);
}

export function recordToolPermissionDecision(
  ctx: PermissionContext,
  toolName: string,
  decision: PermissionDecision,
): void {
  if (!ctx.toolExecutor) return;
  if (decision === 'allow_always') {
    ctx.toolExecutor.getPermissionManager().grant(toolName, 'allow_always');
    ctx.persistPermissionGrant(toolName, 'allow_always');
  } else if (decision === 'allow_once') {
    ctx.toolExecutor.getPermissionManager().grant(toolName, 'allow_once');
  } else if (decision === 'deny') {
    ctx.toolExecutor.getPermissionManager().deny(toolName);
    ctx.persistPermissionGrant(toolName, 'deny');
  }
}
