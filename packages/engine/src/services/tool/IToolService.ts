import type { ToolDefinition, ToolResult, PermissionRule } from '@agentx/shared';
import type { ParallelClassification } from '../../tools/ParallelClassifier.js';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { PermissionResult } from './ToolPermissionService.js';

export interface ToolCall {
  toolId: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  sessionId?: string;
}

export interface IToolService {
  readonly name?: string;

  listTools(): ToolDefinition[];

  execute(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    ctx?: { signal?: AbortSignal },
  ): Promise<ToolResult>;

  classify(calls: ToolCall[]): ParallelClassification;

  requestPermission(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath?: string,
  ): Promise<PermissionResult>;

  getToolExecutor(): ToolExecutor;
  getRegistry(): ToolRegistry;
  getSessionRules(): PermissionRule[];
  setSessionRules(rules: PermissionRule[]): void;
  isTurnAborted(): boolean;
}
