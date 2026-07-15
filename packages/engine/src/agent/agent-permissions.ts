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
      grant(toolId: string, decision: PermissionDecision): void;
      deny(toolId: string): void;
      allowAll(): void;
    };
  } | null | undefined;
  options: { automationRun?: boolean };
  isDelegatedWorker: boolean;
  autoApproveTools: boolean;
  turnApprovedAll: boolean;
  userCancelledTurn: boolean;
  pendingPermissions: Map<string, { resolve: (choice: PermissionHandlerResult) => void; toolName: string; path: string; riskLevel: string }>;
  emit(event: EngineEvent): void;
  persistPermissionGrant(toolId: string, decision: PermissionDecision): void;
}

export function bindPermissionHandler(ctx: PermissionContext): void {
  if (!ctx.toolExecutor || ctx.options.automationRun) return;
  ctx.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel, context) => {
    if (isPermissionExemptTool(toolId)) return 'allow_once';
    if (ctx.userCancelledTurn || ctx.toolExecutor?.isTurnAborted()) return 'deny';
    if (ctx.isDelegatedWorker || ctx.autoApproveTools || ctx.turnApprovedAll) return 'allow_once';
    const requestId = randomUUID();
    const { commandPreview, argsSummary } = summarizePermissionArgs(context?.args as Record<string, unknown> | undefined);
    if (ctx.userCancelledTurn) return 'deny';
    return new Promise<PermissionHandlerResult>((resolve) => {
      ctx.pendingPermissions.set(requestId, {
        resolve,
        toolName: toolId,
        path,
        riskLevel,
      });
      ctx.emit({
        type: 'permission_required',
        requestId,
        tool: toolId,
        path,
        riskLevel,
        integrationPreview: context?.integrationPreview,
        ...(commandPreview ? { commandPreview } : {}),
        ...(argsSummary ? { argsSummary } : {}),
      } as EngineEvent);
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
  }
  entry.resolve(result);
  ctx.pendingPermissions.delete(requestId);
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
    }
    entry.resolve(choice);
    ctx.pendingPermissions.delete(id);
  }
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
  } else if (decision === 'deny') {
    ctx.toolExecutor.getPermissionManager().deny(toolName);
    ctx.persistPermissionGrant(toolName, 'deny');
  }
}
