import type { ToolResult, ToolExecutionContext, PermissionRule, SessionContextKind } from '@agentx/shared';
import { formatPermissionInstructedToolOutput, type PermissionHandlerResult } from '@agentx/shared';
import { PermissionManager } from './permissions/PermissionManager.js';
import { ScopeGuard } from './permissions/ScopeGuard.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { SafetyAuditor } from '../safety/SafetyAuditor.js';
import type { PolicyEngine } from '../enterprise/PolicyEngine.js';
import type { AgentInfo } from '../agent/AgentInfo.js';
import { isPlanDeniedTool } from '../agent/plan-mode-utils.js';
import type { ThirdPartyTurnPolicy } from '../integrations/third-party-access.js';
import {
  blockCredentialScavenger,
  blockThirdPartyLocalSubstitute,
} from '../integrations/third-party-access-guard.js';
import { ToolPermissionService, type ToolPermissionHost } from '../services/tool/ToolPermissionService.js';


export type PermissionRequestHandler = (
  toolId: string,
  path: string,
  riskLevel: string,
  context?: {
    args?: Record<string, unknown>;
    integrationPreview?: import('@agentx/shared').IntegrationActionPreview;
    forAutomation?: boolean;
  },
) => Promise<PermissionHandlerResult>;

export type PermissionPromptHook = (details: {
  toolId: string;
  path: string;
  riskLevel: string;
  forAutomation?: boolean;
  integrationPreview?: import('@agentx/shared').IntegrationActionPreview;
}) => void;

export interface ToolExecutionEntry {
  toolId: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: number;
  elapsed: number;
  sessionId: string;
}

const MAX_HISTORY = 200;

export class ToolExecutor implements ToolPermissionHost {
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private scopeGuard: ScopeGuard;
  private handlers: Map<string, (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>> = new Map();

  getHandlers(): Map<string, (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>> {
    return this.handlers;
  }
  private permissionRequestHandler?: PermissionRequestHandler;
  /** Dedicated handler for messaging channel super-sessions — not overwritten by UI agent wiring. */
  private channelPermissionRequestHandler?: PermissionRequestHandler;
  /** When true, route permission prompts through the channel handler (Telegram-bound super-sessions). */
  private messagingPermissionMode = false;
  private inboundSourceChannel: string | null = null;
  private inboundSourceThreadId: string | null = null;
  private inboundSourceMessageId: string | null = null;
  private onToolOutput?: (output: string) => void;
  private toolCache: Map<string, ReturnType<ToolRegistry['get']>> = new Map();
  private beforeToolHook: ((toolId: string, args: Record<string, unknown>, path?: string) => void) | null = null;
  private safetyAuditor: SafetyAuditor | null = null;
  private onExecutionPersist: ((entry: ToolExecutionEntry) => void) | null = null;
  private policyEngine: PolicyEngine | null = null;
  private executionHistory: ToolExecutionEntry[] = [];
  private mode: 'agent' | 'plan' = 'agent';
  private currentAgent: AgentInfo | null = null;
  private alwaysPromptPermissions = false;
  private sessionRules: PermissionRule[] = [];
  private agentPermissions: PermissionRule[] = [];
  private userConfigRules: PermissionRule[] = [];
  private voiceTurnActive = false;
  private sessionContextKind?: SessionContextKind;
  private thirdPartyTurnPolicy: ThirdPartyTurnPolicy | null = null;
  private turnAborted = false;
  private permissionPromptHook?: PermissionPromptHook;
  private permissionService: ToolPermissionService;

  constructor(registry: ToolRegistry, scopePath: string) {
    this.registry = registry;
    this.permissionManager = new PermissionManager();
    this.scopeGuard = new ScopeGuard(scopePath);
    this.permissionService = new ToolPermissionService();
  }

  setMode(mode: 'agent' | 'plan'): void {
    this.mode = mode;
  }

  setAgent(agent: AgentInfo): void {
    this.currentAgent = agent;
    this.setAgentPermissions(agent.permissions ?? []);
  }

  setAlwaysPromptPermissions(enabled: boolean): void {
    this.alwaysPromptPermissions = enabled;
  }

  setSessionContextKind(kind?: SessionContextKind): void {
    this.sessionContextKind = kind;
  }

  setSessionRules(rules: PermissionRule[]): void {
    this.sessionRules = rules;
  }

  setAgentPermissions(rules: PermissionRule[]): void {
    this.agentPermissions = rules;
  }

  setUserConfigRules(rules: PermissionRule[]): void {
    this.userConfigRules = rules;
  }

  setVoiceTurnActive(active: boolean): void {
    this.voiceTurnActive = active;
  }

  setThirdPartyTurnPolicy(policy: ThirdPartyTurnPolicy | null): void {
    this.thirdPartyTurnPolicy = policy;
  }

  getThirdPartyTurnPolicy(): ThirdPartyTurnPolicy | null {
    return this.thirdPartyTurnPolicy;
  }

  setTurnAborted(aborted: boolean): void {
    this.turnAborted = aborted;
  }

  isTurnAborted(): boolean {
    return this.turnAborted;
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

  setExecutionPersist(cb: (entry: ToolExecutionEntry) => void): void {
    this.onExecutionPersist = cb;
  }

  setPermissionRequestHandler(handler: PermissionRequestHandler): void {
    this.permissionRequestHandler = handler;
  }

  setPermissionPromptHook(hook: PermissionPromptHook | undefined): void {
    this.permissionPromptHook = hook;
  }

  setChannelPermissionRequestHandler(handler: PermissionRequestHandler | null | undefined): void {
    this.channelPermissionRequestHandler = handler ?? undefined;
  }

  setMessagingPermissionMode(enabled: boolean): void {
    this.messagingPermissionMode = enabled;
  }

  setInboundSourceChannel(channel: string | null): void {
    this.inboundSourceChannel = channel;
  }

  setInboundSourceThreadId(threadId: string | null): void {
    this.inboundSourceThreadId = threadId;
  }

  getInboundSourceThreadId(): string | null {
    return this.inboundSourceThreadId;
  }

  setInboundSourceMessageId(messageId: string | null): void {
    this.inboundSourceMessageId = messageId;
  }

  getInboundSourceMessageId(): string | null {
    return this.inboundSourceMessageId;
  }

  getPermissionRequestHandler(): PermissionRequestHandler | undefined {
    return this.permissionRequestHandler;
  }

  getChannelPermissionRequestHandler(): PermissionRequestHandler | undefined {
    return this.channelPermissionRequestHandler;
  }

  getPermissionPromptHook(): PermissionPromptHook | undefined {
    return this.permissionPromptHook;
  }

  getBeforeToolHook(): ((toolId: string, args: Record<string, unknown>, path?: string) => void) | null {
    return this.beforeToolHook;
  }

  getAlwaysPromptPermissions(): boolean {
    return this.alwaysPromptPermissions;
  }

  getMessagingPermissionMode(): boolean {
    return this.messagingPermissionMode;
  }

  getInboundSourceChannel(): string | null {
    return this.inboundSourceChannel;
  }

  getMode(): 'agent' | 'plan' {
    return this.mode;
  }

  getSessionRules(): PermissionRule[] {
    return this.sessionRules;
  }

  getAgentPermissions(): PermissionRule[] {
    return this.agentPermissions;
  }

  getUserConfigRules(): PermissionRule[] {
    return this.userConfigRules;
  }

  getCurrentAgent(): AgentInfo | null {
    return this.currentAgent;
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /** Copy permission policy, mode, and hooks from another executor (e.g. parent → crew worker). */
  copyExecutionPolicyFrom(source: ToolExecutor): void {
    const src = source as unknown as {
      permissionRequestHandler?: PermissionRequestHandler;
      channelPermissionRequestHandler?: PermissionRequestHandler;
      mode: 'agent' | 'plan';
      sessionRules: PermissionRule[];
      agentPermissions: PermissionRule[];
      userConfigRules: PermissionRule[];
      currentAgent: AgentInfo | null;
      beforeToolHook: ((toolId: string, args: Record<string, unknown>, path?: string) => void) | null;
      safetyAuditor: SafetyAuditor | null;
      policyEngine: PolicyEngine | null;
      inboundSourceChannel: string | null;
      inboundSourceThreadId: string | null;
      inboundSourceMessageId: string | null;
    };
    if (src.permissionRequestHandler) {
      this.setPermissionRequestHandler(src.permissionRequestHandler);
    }
    if (src.channelPermissionRequestHandler) {
      this.setChannelPermissionRequestHandler(src.channelPermissionRequestHandler);
    }
    this.setMode(src.mode);
    this.setSessionRules([...src.sessionRules]);
    this.setAgentPermissions([...src.agentPermissions]);
    this.setUserConfigRules([...src.userConfigRules]);
    if (src.currentAgent) this.setAgent(src.currentAgent);
    if (src.beforeToolHook) this.setBeforeToolHook(src.beforeToolHook);
    if (src.safetyAuditor) this.setSafetyAuditor(src.safetyAuditor);
    if (src.policyEngine) this.setPolicyEngine(src.policyEngine);
    this.setInboundSourceChannel(src.inboundSourceChannel ?? null);
    this.setInboundSourceThreadId(src.inboundSourceThreadId ?? null);
    this.setInboundSourceMessageId(src.inboundSourceMessageId ?? null);
  }

  setToolOutputHandler(handler: (output: string) => void): void {
    this.onToolOutput = handler;
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

  hasHandler(toolId: string): boolean {
    return this.handlers.has(toolId);
  }

  unregisterHandlersByPrefix(prefix: string): number {
    let removed = 0;
    for (const toolId of [...this.handlers.keys()]) {
      if (toolId.startsWith(prefix)) {
        this.handlers.delete(toolId);
        removed += 1;
      }
    }
    return removed;
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult> {
    if (options?.signal?.aborted) {
      return { success: false, output: 'Tool execution cancelled', error: 'ABORTED' };
    }
    if (this.turnAborted) {
      return {
        success: false,
        output: 'Turn aborted — tool execution stopped.',
        error: 'TURN_ABORTED',
      };
    }

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

    // Third-party access — block local scavenging for external service requests
    const scavengerBlock = blockCredentialScavenger(toolId, args);
    if (scavengerBlock) return scavengerBlock;

    const thirdPartyBlock = blockThirdPartyLocalSubstitute(toolId, this.thirdPartyTurnPolicy);
    if (thirdPartyBlock) return thirdPartyBlock;

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

    // Plan mode: block edit/delete tools only
    if (this.mode === 'plan' && isPlanDeniedTool(toolId)) {
      const modeLabel = this.currentAgent?.name ?? 'Plan';
      return {
        success: false,
        output: `The "${toolId}" tool cannot be executed in ${modeLabel} mode. Editing or deleting existing resources requires Agent Mode or Hyperdrive. Reads, new file creation, scripts, web search, and scheduling work in Plan mode.`,
        error: 'MODE_RESTRICTED',
      };
    }

    if (this.turnAborted || options?.signal?.aborted) {
      return {
        success: false,
        output: 'Turn aborted — tool execution stopped.',
        error: 'TURN_ABORTED',
      };
    }

    const permissionResult = await this.permissionService.requestPermission(
      this,
      toolId,
      args,
      sessionId,
      scopePathForHook,
      tool,
    );

    if (permissionResult.decision === 'deny') {
      if (permissionResult.instruction) {
        return {
          success: false,
          output: formatPermissionInstructedToolOutput(permissionResult.instruction),
          error: permissionResult.error ?? 'PERMISSION_INSTRUCTED',
        };
      }
      return {
        success: false,
        output: permissionResult.error === 'MODE_RESTRICTED' ? `"${toolId}" is not available.` : 'Permission denied',
        error: permissionResult.error ?? 'PERMISSION_DENIED',
      };
    }

    if (this.turnAborted || options?.signal?.aborted) {
      return {
        success: false,
        output: 'Turn aborted — tool execution stopped.',
        error: 'TURN_ABORTED',
      };
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
    if (options?.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }
    const onToolOutput = this.onToolOutput;
    const context: ToolExecutionContext = {
      sessionId,
      scopePath: this.scopeGuard.getScopePath(),
      contextKind: this.sessionContextKind,
      timeout: this.voiceTurnActive ? 22_000 : 30_000,
      voiceTurn: this.voiceTurnActive,
      mode: this.mode,
      ...(this.inboundSourceChannel ? { sourceChannel: this.inboundSourceChannel } : {}),
      ...(this.inboundSourceThreadId ? { sourceThreadId: this.inboundSourceThreadId } : {}),
      ...(this.inboundSourceMessageId ? { sourceMessageId: this.inboundSourceMessageId } : {}),
      onOutput: onToolOutput,
      signal: abortController.signal,
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
      const entry: ToolExecutionEntry = { toolId, args, result, timestamp: startTime, elapsed, sessionId };
      this.executionHistory.push(entry);
      if (this.executionHistory.length > MAX_HISTORY) this.executionHistory.shift();

      this.onExecutionPersist?.(entry);

      // Enterprise audit log
      this.policyEngine?.logAudit({ action: 'execute', toolId, args, result, sessionId, duration: elapsed });

      if (options?.signal?.aborted) {
        return { success: false, output: 'Tool execution cancelled', error: 'ABORTED' };
      }

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
      const entry: ToolExecutionEntry = { toolId, args, result, timestamp: now, elapsed, sessionId };
      this.executionHistory.push(entry);
      if (this.executionHistory.length > MAX_HISTORY) this.executionHistory.shift();

      this.onExecutionPersist?.(entry);

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
