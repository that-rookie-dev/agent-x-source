import { describe, it, expect } from 'vitest';
import {
  isPermissionInstructResult,
  normalizePermissionHandlerResult,
  formatPermissionInstructedToolOutput,
  PERMISSION_INSTRUCTED_ERROR,
} from '../src/utils/messaging-permission.js';

describe('messaging-permission', () => {
  it('detects instruct results', () => {
    expect(isPermissionInstructResult({ type: 'instruct', instruction: 'use dry-run' })).toBe(true);
    expect(isPermissionInstructResult('deny')).toBe(false);
  });

  it('normalizes instruct to deny with instruction text', () => {
    const normalized = normalizePermissionHandlerResult({ type: 'instruct', instruction: '  skip file write  ' });
    expect(normalized.decision).toBe('deny');
    expect(normalized.instruction).toBe('skip file write');
  });

  it('passes through allow decisions', () => {
    expect(normalizePermissionHandlerResult('allow_once')).toEqual({ decision: 'allow_once' });
  });

  it('formats instructed tool output', () => {
    expect(formatPermissionInstructedToolOutput('retry with smaller scope')).toBe('[USER INSTRUCTION] retry with smaller scope');
    expect(PERMISSION_INSTRUCTED_ERROR).toBe('PERMISSION_INSTRUCTED');
  });
});
