import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { PermissionManager } from './permissions/PermissionManager.js';
import { ScopeGuard } from './permissions/ScopeGuard.js';
import { ToolRegistry } from './ToolRegistry.js';

export type PermissionRequestHandler = (
  toolId: string,
  path: string,
  riskLevel: string,
) => Promise<'allow_once' | 'allow_always' | 'deny'>;

export class ToolExecutor {
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private scopeGuard: ScopeGuard;
  private handlers: Map<string, (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>> = new Map();
  private permissionRequestHandler?: PermissionRequestHandler;

  constructor(registry: ToolRegistry, scopePath: string) {
    this.registry = registry;
    this.permissionManager = new PermissionManager();
    this.scopeGuard = new ScopeGuard(scopePath);
  }

  setPermissionRequestHandler(handler: PermissionRequestHandler): void {
    this.permissionRequestHandler = handler;
  }

  registerHandler(
    toolId: string,
    handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>,
  ): void {
    this.handlers.set(toolId, handler);
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return { success: false, output: `Unknown tool: ${toolId}`, error: 'TOOL_NOT_FOUND' };
    }

    // Check scope for path-based tools
    const path = (args['path'] ?? args['filePath'] ?? args['file'] ?? args['target'] ?? args['from']) as string | undefined;
    if (path) {
      const validation = this.scopeGuard.validatePath(path);
      if (!validation.valid) {
        return { success: false, output: validation.error ?? 'Path outside scope', error: 'SCOPE_VIOLATION' };
      }
    }
    // Also check 'to' destination for move operations
    const toPath = args['to'] as string | undefined;
    if (toPath) {
      const validation = this.scopeGuard.validatePath(toPath);
      if (!validation.valid) {
        return { success: false, output: validation.error ?? 'Destination path outside scope', error: 'SCOPE_VIOLATION' };
      }
    }

    // Check permissions
    const decision = this.permissionManager.check(toolId, path);
    if (decision === 'deny') {
      return { success: false, output: 'Permission denied', error: 'PERMISSION_DENIED' };
    }

    if (decision === null && tool.riskLevel !== 'low') {
      // Need to ask user
      if (this.permissionRequestHandler) {
        const response = await this.permissionRequestHandler(toolId, path ?? '*', tool.riskLevel);
        if (response === 'deny') {
          this.permissionManager.deny(toolId, path);
          return { success: false, output: 'Permission denied by user', error: 'PERMISSION_DENIED' };
        }
        if (response === 'allow_always') {
          this.permissionManager.grant(toolId, 'allow_always', path);
        }
        // allow_once — proceed without storing
      }
    }

    // Execute
    const handler = this.handlers.get(toolId);
    if (!handler) {
      return { success: false, output: `No handler for tool: ${toolId}`, error: 'NO_HANDLER' };
    }

    const context: ToolExecutionContext = {
      sessionId,
      scopePath: this.scopeGuard.getScopePath(),
      timeout: 30_000,
    };

    try {
      const result = await handler(args, context);
      return result;
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : 'Tool execution failed',
        error: 'EXECUTION_ERROR',
      };
    }
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  getScopeGuard(): ScopeGuard {
    return this.scopeGuard;
  }
}
