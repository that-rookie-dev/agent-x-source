import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { PermissionManager } from './permissions/PermissionManager.js';
import { ScopeGuard } from './permissions/ScopeGuard.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { SafetyAuditor } from '../safety/SafetyAuditor.js';
import type { PolicyEngine } from '../enterprise/PolicyEngine.js';


export type PermissionRequestHandler = (
  toolId: string,
  path: string,
  riskLevel: string,
) => Promise<'allow_once' | 'allow_always' | 'deny'>;

export interface ToolExecutionEntry {
  toolId: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: number;
  elapsed: number;
  sessionId: string;
}

const MAX_HISTORY = 200;

export class ToolExecutor {
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private scopeGuard: ScopeGuard;
  private handlers: Map<string, (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>> = new Map();
  private permissionRequestHandler?: PermissionRequestHandler;
  private toolCache: Map<string, ReturnType<ToolRegistry['get']>> = new Map();
  private beforeToolHook: ((toolId: string, args: Record<string, unknown>, path?: string) => void) | null = null;
  private safetyAuditor: SafetyAuditor | null = null;
  private policyEngine: PolicyEngine | null = null;
  private executionHistory: ToolExecutionEntry[] = [];

  constructor(registry: ToolRegistry, scopePath: string) {
    this.registry = registry;
    this.permissionManager = new PermissionManager();
    this.scopeGuard = new ScopeGuard(scopePath);
  }

  getExecutionHistory(): ToolExecutionEntry[] {
    return this.executionHistory;
  }

  setSafetyAuditor(auditor: SafetyAuditor): void {
    this.safetyAuditor = auditor;
  }

  setPolicyEngine(engine: PolicyEngine): void {
    this.policyEngine = engine;
  }

  setBeforeToolHook(hook: (toolId: string, args: Record<string, unknown>, path?: string) => void): void {
    this.beforeToolHook = hook;
  }

  setPermissionRequestHandler(handler: PermissionRequestHandler): void {
    this.permissionRequestHandler = handler;
  }

  setScopePath(scopePath: string): void {
    this.scopeGuard = new ScopeGuard(scopePath);
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
    let tool = this.toolCache.get(toolId);
    if (!tool) {
      tool = this.registry.get(toolId);
      if (tool) this.toolCache.set(toolId, tool);
    }
    if (!tool) {
      return { success: false, output: `Unknown tool: ${toolId}`, error: 'TOOL_NOT_FOUND' };
    }

    // Safety audit — intercept before execution
    if (this.safetyAuditor) {
      const blocked = await this.safetyAuditor.intercept(toolId, args);
      if (blocked) return blocked;
    }

    // Enterprise policy evaluation
    if (this.policyEngine) {
      const path = (args['path'] ?? args['filePath'] ?? args['file'] ?? args['target'] ?? args['from']) as string | undefined;
      const decision = this.policyEngine.evaluate(toolId, path);
      if (decision === 'deny') {
        return { success: false, output: 'Blocked by enterprise policy', error: 'POLICY_DENIED' };
      }
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

    // Check permissions — previously denied tools still get a chance to be re-allowed
    const decision = this.permissionManager.check(toolId, path);
    const needsPermission = decision !== 'allow_always';

    if (needsPermission && this.permissionRequestHandler && tool.riskLevel !== 'low') {
      const response = await this.permissionRequestHandler(toolId, path ?? '*', tool.riskLevel);
      if (response === 'deny') {
        this.permissionManager.deny(toolId, path);
        return { success: false, output: 'Permission denied', error: 'PERMISSION_DENIED' };
      }
      if (response === 'allow_always') {
        this.permissionManager.grant(toolId, 'allow_always', path);
      }
    }

    // Fire before-tool hook for diff/preview
    if (this.beforeToolHook && path) {
      this.beforeToolHook(toolId, args, path);
    }

    // Execute with timeout enforcement
    const handler = this.handlers.get(toolId);
    if (!handler) {
      return { success: false, output: `No handler for tool: ${toolId}`, error: 'NO_HANDLER' };
    }

    const abortController = new AbortController();
    const context: ToolExecutionContext = {
      sessionId,
      scopePath: this.scopeGuard.getScopePath(),
      timeout: 30_000,

    };

    try {
      const startTime = Date.now();
      
      // Race between handler execution and timeout
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        setTimeout(() => {
          abortController.abort();
          reject(new Error(`Tool execution timeout after ${context.timeout}ms`));
        }, context.timeout);
      });

      const result = await Promise.race([
        handler(args, context),
        timeoutPromise,
      ]);
      
      const elapsed = Date.now() - startTime;
      this.executionHistory.push({ toolId, args, result, timestamp: startTime, elapsed, sessionId });
      if (this.executionHistory.length > MAX_HISTORY) this.executionHistory.shift();

      // Enterprise audit log
      this.policyEngine?.logAudit({ action: 'execute', toolId, args, result, sessionId, duration: elapsed });

      return result;
    } catch (error) {
      const now = Date.now();
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      const result: ToolResult = {
        success: false,
        output: isTimeout 
          ? `Tool execution timed out after ${context.timeout}ms`
          : (error instanceof Error ? error.message : 'Tool execution failed'),
        error: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
      };
      const elapsed = now - (this.executionHistory[this.executionHistory.length - 1]?.timestamp ?? now);
      this.executionHistory.push({ toolId, args, result, timestamp: now, elapsed, sessionId });
      if (this.executionHistory.length > MAX_HISTORY) this.executionHistory.shift();

      // Enterprise audit log
      this.policyEngine?.logAudit({ action: 'execute', toolId, args, result, sessionId, duration: elapsed });

      return result;
    }
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  getScopeGuard(): ScopeGuard {
    return this.scopeGuard;
  }
}
