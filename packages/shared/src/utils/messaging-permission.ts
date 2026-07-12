import type { PermissionDecision } from '../types/permission.js';

export const PERMISSION_INSTRUCTED_ERROR = 'PERMISSION_INSTRUCTED';

export interface PermissionInstructResult {
  type: 'instruct';
  instruction: string;
}

export type PermissionHandlerResult = PermissionDecision | PermissionInstructResult;

export function isPermissionInstructResult(
  result: PermissionHandlerResult,
): result is PermissionInstructResult {
  return typeof result === 'object' && result !== null && result.type === 'instruct';
}

export function normalizePermissionHandlerResult(result: PermissionHandlerResult): {
  decision: PermissionDecision;
  instruction?: string;
} {
  if (isPermissionInstructResult(result)) {
    return { decision: 'deny', instruction: result.instruction.trim() };
  }
  return { decision: result };
}

export function formatPermissionInstructedToolOutput(instruction: string): string {
  const text = instruction.trim();
  return text ? `[USER INSTRUCTION] ${text}` : '[USER INSTRUCTION] (empty)';
}
