import { randomUUID } from 'node:crypto';
import type { PermissionHandlerResult, PermissionDecision } from '@agentx/shared';
import { isPermissionInstructResult } from '@agentx/shared';
import type { PermissionRequestHandler } from '../tools/ToolExecutor.js';

export interface MessagingPermissionPromptDetails {
  toolId: string;
  path: string;
  riskLevel: string;
  forAutomation?: boolean;
  integrationPreview?: import('@agentx/shared').IntegrationActionPreview;
}

export type MessagingPermissionSendPrompt = (
  permId: string,
  details: MessagingPermissionPromptDetails,
) => Promise<void>;

/**
 * Called when a permission prompt times out without a user response.
 * The host should abort the active agent turn to prevent the agent from
 * continuing and firing more permission prompts in a loop.
 */
export type MessagingPermissionTimeoutCallback = () => void;

/**
 * Shared permission prompt lifecycle for Telegram, Slack, and Discord:
 * Allow Once / Always Allow / Deny / Instruct (custom text).
 */
export class MessagingPermissionCoordinator {
  private pending = new Map<string, (result: PermissionHandlerResult) => void>();
  private requesters = new Map<string, string>();
  private awaitingInstruct = new Map<string, string>();
  private timeoutCallback?: MessagingPermissionTimeoutCallback;

  /** Register a callback fired when a permission prompt times out without response. */
  onTimeout(cb: MessagingPermissionTimeoutCallback): void {
    this.timeoutCallback = cb;
  }

  createHandler(
    sendPrompt: MessagingPermissionSendPrompt,
    getUserKey: () => string | undefined,
    _onInstructPrompt?: (userKey: string) => Promise<void>,
  ): PermissionRequestHandler {
    return async (toolId, path, riskLevel, context) => {
      const userKey = getUserKey();
      if (!userKey) return 'deny';

      const permId = randomUUID();
      this.requesters.set(permId, userKey);
      await sendPrompt(permId, {
        toolId,
        path,
        riskLevel,
        forAutomation: context?.forAutomation,
        integrationPreview: context?.integrationPreview,
      });

      return new Promise<PermissionHandlerResult>((resolve) => {
        const timeout = setTimeout(() => {
          this.pending.delete(permId);
          this.requesters.delete(permId);
          this.clearInstructForPerm(permId);
          // Fire the timeout callback so the host can abort the active turn,
          // preventing the agent from continuing and firing more prompts.
          try { this.timeoutCallback?.(); } catch { /* best-effort */ }
          resolve('deny');
        }, 120_000);

        this.pending.set(permId, (result) => {
          clearTimeout(timeout);
          this.pending.delete(permId);
          this.requesters.delete(permId);
          this.clearInstructForPerm(permId);
          resolve(result);
        });
      });
    };
  }

  resolveDecision(permId: string, choice: PermissionDecision, expectedUserKey?: string): boolean {
    if (expectedUserKey) {
      const owner = this.requesters.get(permId);
      if (owner && owner !== expectedUserKey) return false;
    }
    const resolver = this.pending.get(permId);
    if (!resolver) return false;
    resolver(choice);
    return true;
  }

  async beginInstruct(permId: string, userKey: string, onInstructPrompt?: (key: string) => Promise<void>): Promise<boolean> {
    const owner = this.requesters.get(permId);
    if (!owner || owner !== userKey) return false;
    if (!this.pending.has(permId)) return false;
    this.awaitingInstruct.set(userKey, permId);
    if (onInstructPrompt) {
      await onInstructPrompt(userKey);
    }
    return true;
  }

  consumeInstructText(userKey: string, text: string): boolean {
    const permId = this.awaitingInstruct.get(userKey);
    if (!permId) return false;
    const resolver = this.pending.get(permId);
    if (!resolver) {
      this.awaitingInstruct.delete(userKey);
      return false;
    }
    const instruction = text.trim();
    if (!instruction) return false;
    this.awaitingInstruct.delete(userKey);
    resolver({ type: 'instruct', instruction });
    return true;
  }

  isAwaitingInstruct(userKey: string): boolean {
    return this.awaitingInstruct.has(userKey);
  }

  private clearInstructForPerm(permId: string): void {
    for (const [userKey, id] of this.awaitingInstruct.entries()) {
      if (id === permId) this.awaitingInstruct.delete(userKey);
    }
  }
}

export function permissionResultLabel(result: PermissionHandlerResult): string {
  if (isPermissionInstructResult(result)) return '✏️ Instruction sent';
  if (result === 'allow_once') return '✅ Allowed (once)';
  if (result === 'allow_always') return '✅ Always allowed';
  return '❌ Denied';
}
