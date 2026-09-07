import type { ToolResult, ToolExecutionContext, PermissionRule, SessionContextKind, AgentXConfig, TurnAttachment } from '@agentx/shared';
import { formatPermissionInstructedToolOutput, type PermissionHandlerResult } from '@agentx/shared';
import { PermissionManager } from './permissions/PermissionManager.js';
import { ScopeGuard } from './permissions/ScopeGuard.js';
import { ToolRegistry } from './ToolRegistry.js';
import { getAttachmentService } from '../attachments/index.js';
import type { SafetyAuditor } from '../safety/SafetyAuditor.js';
import type { PolicyEngine } from '../enterprise/PolicyEngine.js';
import type { ThirdPartyTurnPolicy } from '../integrations/third-party-access.js';
import {
  blockCredentialScavenger,
  blockThirdPartyLocalSubstitute,
} from '../integrations/third-party-access-guard.js';
import type { KbDocumentTurnPolicy } from '../knowledge-base/kb-document-access-guard.js';
import { blockKbDiskFallback } from '../knowledge-base/kb-document-access-guard.js';
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

/** Ensure every tool returns an honest, well-formed result — never fire-and-forget. */
function normalizeToolResult(toolId: string, result: unknown): ToolResult {
  if (!result || typeof result !== 'object') {
    return {
      success: false,
      output: `Tool "${toolId}" returned no result. Action was NOT performed.`,
      error: 'INVALID_RESULT',
    };
  }
  const r = result as Partial<ToolResult>;
  if (typeof r.success !== 'boolean') {
    return {
      success: false,
      output: `Tool "${toolId}" returned an invalid result. Action was NOT performed.`,
      error: 'INVALID_RESULT',
    };
  }
  const output = typeof r.output === 'string'
    ? r.output
    : (r.output == null ? '' : String(r.output));
  if (r.success) {
    return {
      success: true,
      output: output.trim() || `Tool "${toolId}" completed successfully.`,
      ...(r.error ? { error: r.error } : {}),
      ...(r.metadata ? { metadata: r.metadata } : {}),
    };
  }
  return {
    success: false,
    output: output.trim() || `Tool "${toolId}" failed. Action was NOT performed.`,
    error: r.error ?? 'EXECUTION_ERROR',
    ...(r.metadata ? { metadata: r.metadata } : {}),
  };
}

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
  private alwaysPromptPermissions = false;
  private sessionRules: PermissionRule[] = [];
  private agentPermissions: PermissionRule[] = [];
  private userConfigRules: PermissionRule[] = [];
  /** Per-turn set of tool IDs the user has consented to inline (bypass-mode enforcement). */
  private pendingToolConsent: Set<string> = new Set();
  /** Session waiver for low-risk proactive deliverable confirmation. */
  private skipLowRiskProactiveConsent = false;
  private currentUserMessageProvider: (() => string) | null = null;
  private voiceTurnActive = false;
  private sessionContextKind?: SessionContextKind;
  private runtimeConfig: AgentXConfig | null = null;
  private thirdPartyTurnPolicy: ThirdPartyTurnPolicy | null = null;
  private kbDocumentTurnPolicy: KbDocumentTurnPolicy | null = null;
  private turnAborted = false;
  private permissionPromptHook?: PermissionPromptHook;
  private permissionService: ToolPermissionService;
  /** Clarify-first consent (questionnaire) before permission modal. */
  private actionConsentHandler: ((
    toolId: string,
    args: Record<string, unknown>,
    definition: import('@agentx/shared').ToolDefinition,
  ) => Promise<import('../services/tool/ToolPermissionService.js').ActionConsentResult>) | null = null;
  private permissionOutcomeHandler: ((
    outcome: import('../services/tool/ToolPermissionService.js').PermissionOutcomeEmit,
  ) => void) | null = null;
  /** Per-session file read cache keyed by resolved absolute path. */
  private fileReadCachePerSession = new Map<string, Map<string, { content: string; mtimeMs: number; size: number }>>();
  /** Attachments collected from tool handlers during a turn. */
  private collectedAttachments: TurnAttachment[] = [];

  constructor(registry: ToolRegistry, scopePath: string) {
    this.registry = registry;
    this.permissionManager = new PermissionManager();
    this.scopeGuard = new ScopeGuard(scopePath);
    this.permissionService = new ToolPermissionService();
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

  getVoiceTurnActive(): boolean {
    return this.voiceTurnActive;
  }

  setThirdPartyTurnPolicy(policy: ThirdPartyTurnPolicy | null): void {
    this.thirdPartyTurnPolicy = policy;
  }

  getThirdPartyTurnPolicy(): ThirdPartyTurnPolicy | null {
    return this.thirdPartyTurnPolicy;
  }

  setKbDocumentTurnPolicy(policy: KbDocumentTurnPolicy | null): void {
    this.kbDocumentTurnPolicy = policy;
  }

  getKbDocumentTurnPolicy(): KbDocumentTurnPolicy | null {
    return this.kbDocumentTurnPolicy;
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

  setConfig(config: AgentXConfig | null): void {
    this.runtimeConfig = config;
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

  getCollectedAttachments(): TurnAttachment[] {
    return this.collectedAttachments;
  }

  clearCollectedAttachments(): void {
    this.collectedAttachments = [];
  }

  private getFileReadCache(sessionId: string): Map<string, { content: string; mtimeMs: number; size: number }> {
    let cache = this.fileReadCachePerSession.get(sessionId);
    if (!cache) {
      cache = new Map<string, { content: string; mtimeMs: number; size: number }>();
      this.fileReadCachePerSession.set(sessionId, cache);
    }
    return cache;
  }

  getInboundSourceChannel(): string | null {
    return this.inboundSourceChannel;
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

  getPendingToolConsent(): Set<string> | null {
    return this.pendingToolConsent;
  }

  getSkipLowRiskProactiveConsent(): boolean {
    return this.skipLowRiskProactiveConsent;
  }

  setSkipLowRiskProactiveConsent(enabled: boolean): void {
    this.skipLowRiskProactiveConsent = enabled;
  }

  setCurrentUserMessageProvider(provider: (() => string) | null): void {
    this.currentUserMessageProvider = provider;
  }

  getCurrentUserMessage(): string {
    return this.currentUserMessageProvider?.() ?? '';
  }

  /** Grant inline consent for a tool this turn (called when the user says "yes/go ahead"). */
  grantToolConsent(toolId: string): void {
    this.pendingToolConsent.add(toolId);
  }

  /** Clear per-turn consent (called at the end of each turn). */
  clearToolConsent(): void {
    this.pendingToolConsent.clear();
  }

  setActionConsentHandler(
    handler: (
      toolId: string,
      args: Record<string, unknown>,
      definition: import('@agentx/shared').ToolDefinition,
    ) => Promise<import('../services/tool/ToolPermissionService.js').ActionConsentResult>,
  ): void {
    this.actionConsentHandler = handler;
  }

  setPermissionOutcomeHandler(
    handler: (outcome: import('../services/tool/ToolPermissionService.js').PermissionOutcomeEmit) => void,
  ): void {
    this.permissionOutcomeHandler = handler;
  }

  async requestActionConsent(
    toolId: string,
    args: Record<string, unknown>,
    definition: import('@agentx/shared').ToolDefinition,
  ): Promise<import('../services/tool/ToolPermissionService.js').ActionConsentResult> {
    // No clarify UI wired (automation workers, early boot, unit tests) — skip the
    // questionnaire gate and let the permission modal / bypass path decide.
    if (!this.actionConsentHandler) return { proceed: true, answer: '' };
    return this.actionConsentHandler(toolId, args, definition);
  }

  emitPermissionOutcome(outcome: import('../services/tool/ToolPermissionService.js').PermissionOutcomeEmit): void {
    this.permissionOutcomeHandler?.(outcome);
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /** Copy permission policy and hooks from another executor (e.g. parent → crew worker). */
  copyExecutionPolicyFrom(source: ToolExecutor): void {
    const src = source as unknown as {
      permissionRequestHandler?: PermissionRequestHandler;
      channelPermissionRequestHandler?: PermissionRequestHandler;
      sessionRules: PermissionRule[];
      agentPermissions: PermissionRule[];
      userConfigRules: PermissionRule[];
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
    this.setSessionRules([...src.sessionRules]);
    this.setAgentPermissions([...src.agentPermissions]);
    this.setUserConfigRules([...src.userConfigRules]);
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

  unregisterHandler(toolId: string): boolean {
    return this.handlers.delete(toolId);
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

    // Validate argument types and nested structure against the tool schema.
    // This catches LLM mistakes early (e.g. sending a string instead of an
    // array, or using wrong field names in nested objects) and gives a clear
    // error message instead of letting the MCP server fail opaquely.
    const schemaError = validateToolArgsAgainstSchema(tool.schema, args);
    if (schemaError) {
      return {
        success: false,
        output: schemaError,
        error: 'SCHEMA_VALIDATION_FAILED',
      };
    }

    // Third-party access — block local scavenging for external service requests
    const scavengerBlock = blockCredentialScavenger(toolId, args);
    if (scavengerBlock) return scavengerBlock;

    const thirdPartyBlock = blockThirdPartyLocalSubstitute(toolId, this.thirdPartyTurnPolicy);
    if (thirdPartyBlock) return thirdPartyBlock;

    // @kb-pinned documents — Knowledge Base search only; never open originals from disk
    const kbDiskBlock = blockKbDiskFallback(toolId, this.kbDocumentTurnPolicy);
    if (kbDiskBlock) return kbDiskBlock;

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

    // Sync user-attached file paths into the ScopeGuard so tools can read files
    // the user explicitly attached to the chat, even if they live outside the
    // workspace scope. The act of attaching a file IS the user's authorization.
    this.syncAttachmentAuthorizations(sessionId);

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
        output: permissionResult.error === 'MODE_RESTRICTED'
          ? `"${toolId}" is not available. Action was NOT performed.`
          : `Permission denied for "${toolId}". Action was NOT performed. `
            + 'Approve it in the permission prompt (or enable bypass permissions), then retry.',
        error: permissionResult.error ?? 'PERMISSION_DENIED',
      };
    }

    // Record turn consent so subsequent calls of the same tool don't re-prompt.
    this.grantToolConsent(toolId);

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
      timeout: tool?.timeoutMs ?? (this.voiceTurnActive ? 22_000 : 30_000),
      voiceTurn: this.voiceTurnActive,
      config: this.runtimeConfig ?? undefined,
      ...(this.inboundSourceChannel ? { sourceChannel: this.inboundSourceChannel } : {}),
      ...(this.inboundSourceThreadId ? { sourceThreadId: this.inboundSourceThreadId } : {}),
      ...(this.inboundSourceMessageId ? { sourceMessageId: this.inboundSourceMessageId } : {}),
      fileReadCache: this.getFileReadCache(sessionId),
      onOutput: onToolOutput,
      signal: abortController.signal,
      registerAttachment: async (opts) => {
        let buffer: Buffer | undefined;
        if (opts.buffer) {
          if (ArrayBuffer.isView(opts.buffer)) {
            const view = opts.buffer as Uint8Array;
            buffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
          } else {
            buffer = Buffer.from(opts.buffer as ArrayBuffer);
          }
        }
        const stored = await getAttachmentService().registerAttachment({
          sessionId,
          filename: opts.filename,
          mimeType: opts.mimeType,
          source: opts.source ?? 'tool',
          originalPath: opts.originalPath,
          dataUrl: opts.dataUrl,
          buffer,
        });
        const turnAttachment: TurnAttachment = {
          id: stored.id,
          name: stored.filename,
          mimeType: stored.mimeType,
          type: stored.mimeType.startsWith('image/') ? 'image' : 'file',
          storageId: stored.id,
          source: stored.source,
        };
        this.collectedAttachments.push(turnAttachment);
        return turnAttachment;
      },
    };

    try {
      const startTime = Date.now();

      // Race between handler execution and timeout. Handler errors are converted to a
      // ToolResult so the race only rejects on our timeout, avoiding unhandled
      // rejections from the losing promise.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Tool execution timeout after ${context.timeout}ms`));
        }, context.timeout);
      });

      const handlerPromise = handler(args, context).catch((error: unknown) => ({
        success: false,
        output: error instanceof Error ? error.message : 'Tool execution failed',
        error: 'EXECUTION_ERROR',
      }));

      const rawResult = await Promise.race([
        handlerPromise,
        timeoutPromise,
      ]);
      clearTimeout(timeoutId);
      const result = normalizeToolResult(toolId, rawResult);

      const elapsed = Date.now() - startTime;
      const entry: ToolExecutionEntry = { toolId, args, result, timestamp: startTime, elapsed, sessionId };
      this.executionHistory.push(entry);
      if (this.executionHistory.length > MAX_HISTORY) this.executionHistory.shift();

      this.onExecutionPersist?.(entry);

      // Enterprise audit log
      this.policyEngine?.logAudit({ action: 'execute', toolId, args, result, sessionId, duration: elapsed });

      if (options?.signal?.aborted) {
        return { success: false, output: 'Tool execution cancelled. Action was NOT performed.', error: 'ABORTED' };
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

  /**
   * Sync all user-attached file paths for the current session into the ScopeGuard
   * so that tools (file_read, pdf_read, image_ocr, etc.) can read files the user
   * explicitly attached to the chat, even if they live outside the workspace.
   *
   * The user's act of attaching a file IS the authorization to read it — no
   * scope check or permission prompt should block access to it.
   */
  private syncAttachmentAuthorizations(sessionId: string): void {
    this.scopeGuard.clearAuthorizedAttachmentPaths();
    try {
      const service = getAttachmentService();
      const paths = service.getSessionAttachmentPaths(sessionId);
      if (paths.length > 0) {
        this.scopeGuard.authorizeAttachmentPaths(paths);
      }
    } catch { /* best-effort — AttachmentService may not be initialized yet */ }
  }
}

// ─── Schema validation ──────────────────────────────────────────────────

/**
 * Lightweight JSON Schema validator for tool arguments.
 * Validates types, required fields, array items, and nested object properties.
 * Returns an error message string if validation fails, or null if valid.
 *
 * This is intentionally lightweight (not full JSON Schema) — it covers the
 * common LLM mistakes: wrong types, missing required nested fields, and
 * arrays of wrong element types. Full JSON Schema validation (ajv) would be
 * heavier and isn't needed for the common failure modes we see.
 */
function validateToolArgsAgainstSchema(
  schema: { type?: string; properties?: Record<string, unknown>; required?: string[] },
  args: Record<string, unknown>,
  path = '',
): string | null {
  if (!schema?.properties) return null;

  for (const [key, value] of Object.entries(args)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const propSchema = schema.properties[key] as
      | { type?: string; items?: Record<string, unknown>; properties?: Record<string, unknown>; required?: string[] }
      | undefined;

    // Skip validation for unknown properties — some tools accept extra args.
    if (!propSchema) continue;

    const expectedType = propSchema.type;
    if (!expectedType) continue;

    const typeError = checkType(value, expectedType, fieldPath);
    if (typeError) return typeError;

    // Validate array items
    if (expectedType === 'array' && Array.isArray(value) && propSchema.items) {
      const itemSchema = propSchema.items as { type?: string; properties?: Record<string, unknown>; required?: string[] };
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${fieldPath}[${i}]`;
        const itemError = checkType(value[i], itemSchema.type, itemPath);
        if (itemError) return itemError;

        // Recursively validate nested object items (e.g. cartItems[].menu_item_id)
        if (typeof value[i] === 'object' && value[i] !== null && !Array.isArray(value[i]) && itemSchema.properties) {
          const nestedError = validateToolArgsAgainstSchema(itemSchema, value[i] as Record<string, unknown>, itemPath);
          if (nestedError) return nestedError;
        }
      }
    }

    // Validate nested object properties
    if (expectedType === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value) && propSchema.properties) {
      const nestedError = validateToolArgsAgainstSchema(propSchema, value as Record<string, unknown>, fieldPath);
      if (nestedError) return nestedError;
    }
  }

  return null;
}

function checkType(value: unknown, expectedType: string | undefined, path: string): string | null {
  if (!expectedType) return null;
  if (value === undefined || value === null) return null; // Optional — required check is separate

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        // Accept numbers/booleans as strings (common LLM coercion) but reject objects/arrays.
        if (typeof value === 'object') {
          return `Argument "${path}" should be a string but got ${Array.isArray(value) ? 'array' : 'object'}.`;
        }
      }
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        // Accept numeric strings (common LLM behavior)
        if (typeof value === 'string' && !isNaN(Number(value))) break;
        return `Argument "${path}" should be a number but got ${typeof value}.`;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        // Accept "true"/"false" strings
        if (typeof value === 'string' && (value === 'true' || value === 'false')) break;
        return `Argument "${path}" should be a boolean but got ${typeof value}.`;
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        return `Argument "${path}" should be an array but got ${typeof value}.` +
          (typeof value === 'object' ? ' Did you forget to wrap it in []?' : '');
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `Argument "${path}" should be an object but got ${Array.isArray(value) ? 'array' : typeof value}.`;
      }
      break;
    default:
      // Unknown type — skip validation
      break;
  }
  return null;
}
