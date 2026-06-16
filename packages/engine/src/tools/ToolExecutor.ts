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

const WRITE_TOOLS = new Set([
  'file_write', 'file_delete', 'folder_create', 'folder_delete', 'folder_move', 'file_copy',
  'file_patch', 'code_replace', 'code_insert', 'code_range',
  'csv_create', 'pdf_create', 'docx_create', 'pptx_create', 'xlsx_create',
  'json_set', 'http_download', 'archive_create', 'archive_extract',
  'browser_screenshot', 'chart_generate', 'qr_generate',
  'shell_exec', 'shell_background', 'shell_exec_streaming',
  'process_kill', 'db_query', 'db_migrate',
  'git_commit', 'git_push', 'git_merge', 'git_rebase', 'git_reset', 'git_tag', 'git_stash',
  'package_install', 'package_remove', 'pkg_update',
  'docker_build', 'container_run', 'container_start', 'container_stop', 'container_exec',
  'cron_create', 'encrypt_file', 'decrypt_file',
]);

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
  private mode: 'agent' | 'plan' = 'agent';

  constructor(registry: ToolRegistry, scopePath: string) {
    this.registry = registry;
    this.permissionManager = new PermissionManager();
    this.scopeGuard = new ScopeGuard(scopePath);
  }

  setMode(mode: 'agent' | 'plan'): void {
    this.mode = mode;
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

    // Validate required arguments from tool schema
    const required = tool.schema.required;
    if (required && required.length > 0) {
      const missing: string[] = [];
      for (const key of required) {
        const val = args[key];
        if (val === undefined || val === null || val === '') {
          missing.push(key);
        }
      }
      if (missing.length > 0) {
        return {
          success: false,
          output: `Missing required argument(s): ${missing.join(', ')}. Expected: ${required.join(', ')}`,
          error: 'INVALID_ARGS',
        };
      }
    }

    // Safety audit — intercept before execution
    if (this.safetyAuditor) {
      const blocked = await this.safetyAuditor.intercept(toolId, args);
      if (blocked) return blocked;
    }

    // Enterprise policy evaluation
    if (this.policyEngine) {
      const policyPath = (args['path'] ?? args['filePath'] ?? args['file'] ?? args['target'] ?? args['from']) as string | undefined;
      const decision = this.policyEngine.evaluate(toolId, policyPath);
      if (decision === 'deny') {
        return { success: false, output: 'Blocked by enterprise policy', error: 'POLICY_DENIED' };
      }
    }

    // Check scope for ALL path-like arguments
    const pathKeys = ['path', 'filePath', 'file', 'target', 'from', 'to', 'cwd', 'output', 'source', 'archive', 'file1', 'file2', 'database'];
    let scopePathForHook: string | undefined;
    for (const key of pathKeys) {
      const p = args[key] as string | undefined;
      if (p && typeof p === 'string') {
        if (!scopePathForHook) scopePathForHook = p;
        const validation = this.scopeGuard.validatePath(p);
        if (!validation.valid) {
          const label = key === 'to' ? 'Destination path' : key === 'cwd' ? 'Working directory' : `Path (${key})`;
          return { success: false, output: `${label} outside scope: ${validation.error}`, error: 'SCOPE_VIOLATION' };
        }
      }
    }

    // Plan mode: block write/exec tools entirely
    if (this.mode === 'plan' && WRITE_TOOLS.has(toolId)) {
      return { success: false, output: `"${toolId}" is not available in Plan mode. Switch to Agent mode to use this tool.`, error: 'MODE_RESTRICTED' };
    }

    // Check permissions — previously denied tools still get a chance to be re-allowed
    const decision = this.permissionManager.check(toolId, scopePathForHook);
    const needsPermission = decision !== 'allow_always';

    if (needsPermission && this.permissionRequestHandler && tool.riskLevel !== 'low') {
      // Agent mode: auto-approve within scopePath to avoid interrupting the UX flow
      if (this.mode === 'agent' && scopePathForHook && this.scopeGuard.validatePath(scopePathForHook).valid) {
        this.permissionManager.grant(toolId, 'allow_always', scopePathForHook);
      } else if (this.mode === 'plan') {
        // Plan mode: never ask for permissions — just deny any risky tool
        return { success: false, output: `"${toolId}" is not available in Plan mode.`, error: 'MODE_RESTRICTED' };
      } else {
        // Other modes: prompt user for permission
        const response = await this.permissionRequestHandler(toolId, scopePathForHook ?? '*', tool.riskLevel);
        if (response === 'deny') {
          this.permissionManager.deny(toolId, scopePathForHook);
          return { success: false, output: 'Permission denied', error: 'PERMISSION_DENIED' };
        }
        if (response === 'allow_always') {
          this.permissionManager.grant(toolId, 'allow_always', scopePathForHook);
        }
      }
    }

    // Fire before-tool hook for diff/preview
    if (this.beforeToolHook && scopePathForHook) {
      this.beforeToolHook(toolId, args, scopePathForHook);
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
      mode: this.mode,
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
