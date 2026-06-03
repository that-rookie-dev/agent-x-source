import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolRegistry } from '@agentx/engine';
import type { ToolExecutor } from '@agentx/engine';
import type * as vscode from 'vscode';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolkitRefs {
  registry: ToolRegistry;
  executor: ToolExecutor;
}

export interface AdapterContext {
  workspaceRoot: string;
  extensionContext: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
}

export interface AdapterCategoryResult {
  overridden: string[];
  keptAsIs: string[];
  disabled: string[];
}

export function createDisabledHandler(
  toolId: string,
  reason: string,
): ToolHandler {
  return async () => ({
    success: false,
    output: `${toolId} is not available in VS Code: ${reason}`,
    error: 'NOT_AVAILABLE_IN_VSCODE',
  });
}

export function createWorkspaceScopedHandler(
  originalHandler: ToolHandler,
  workspaceRoot: string,
): ToolHandler {
  return async (args, context) => {
    const scopedContext: ToolExecutionContext = {
      ...context,
      scopePath: workspaceRoot,
    };
    return originalHandler(args, scopedContext);
  };
}
