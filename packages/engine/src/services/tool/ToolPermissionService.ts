import {
  isChannelSessionId,
  normalizePermissionHandlerResult,
  isAgentInternalPath,
  type PermissionDecision,
  type PermissionRule,
  type ToolDefinition,
} from '@agentx/shared';
import type { PermissionManager } from '../../tools/permissions/PermissionManager.js';
import { evaluateRules } from '../../tools/permissions/RuleEngine.js';
import { isPermissionExemptTool } from '../../tools/permissions/exempt-tools.js';
import { isIntegrationToolId } from '../../integrations/action-classifier.js';
import { buildIntegrationActionPreview } from '../../integrations/action-preview.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { PermissionPromptHook, PermissionRequestHandler } from '../../tools/ToolExecutor.js';
import { getAttachmentService } from '../../attachments/index.js';
import {
  detectsExplicitDeliverableRequest,
  isProactiveDeliverableTool,
  proactiveDeliverableConsentInstruction,
} from './proactive-deliverable-consent.js';

const PATH_KEYS = ['path', 'filePath', 'file', 'target', 'from', 'to', 'cwd', 'output', 'source', 'archive', 'file1', 'file2', 'database'];

function allPathsAreAgentInternal(args: Record<string, unknown>): boolean {
  let hasPath = false;
  for (const key of PATH_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim()) {
      hasPath = true;
      if (!isAgentInternalPath(val)) return false;
    }
  }
  return hasPath;
}

/**
 * Read-only document/image tools whose sole effect is extracting/parsing content
 * the user has already explicitly attached to the session. Attaching a file is
 * itself the authorization to read it — these tools never need a separate
 * permission prompt when every path argument is a known attachment of this
 * session, regardless of the "always prompt permissions" setting.
 */
const ATTACHMENT_READ_TOOLS = new Set([
  'file_read', 'pdf_read', 'docx_read', 'xlsx_read', 'pptx_read',
  'json_parse', 'csv_parse', 'image_view', 'image_ocr',
]);

function allPathsAreSessionAttachments(sessionId: string, args: Record<string, unknown>): boolean {
  let hasPath = false;
  const service = getAttachmentService();
  for (const key of PATH_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim()) {
      hasPath = true;
      if (!service.isSessionAttachmentPath(sessionId, val)) return false;
    }
  }
  return hasPath;
}

/** tool_call bridge wrapping an attachment read should inherit the same allowlist. */
function isAttachmentReadViaToolCall(sessionId: string, toolId: string, args: Record<string, unknown>): boolean {
  if (toolId !== 'tool_call') return false;
  const inner = typeof args['tool'] === 'string' ? args['tool'] : '';
  if (!ATTACHMENT_READ_TOOLS.has(inner)) return false;
  const innerArgs = (args['arguments'] ?? args['args'] ?? {}) as Record<string, unknown>;
  return allPathsAreSessionAttachments(sessionId, innerArgs);
}

export interface PermissionResult {
  decision: 'allow' | 'allow_once' | 'allow_always' | 'deny' | 'ask';
  error?: 'MODE_RESTRICTED' | 'PERMISSION_DENIED' | 'PERMISSION_INSTRUCTED' | 'SCOPE_VIOLATION';
  instruction?: string;
}

export type ActionConsentResult = {
  proceed: boolean;
  answer?: string;
};

export type PermissionOutcomeEmit = {
  toolId: string;
  toolName?: string;
  path?: string;
  riskLevel?: string;
  decision: 'allow_once' | 'allow_always' | 'deny' | 'instructed' | 'declined_consent';
  label: string;
  instruction?: string;
  actionSummary?: string;
};

export interface ToolPermissionHost {
  getPermissionManager(): PermissionManager;
  getRegistry(): ToolRegistry;
  getPermissionRequestHandler(): PermissionRequestHandler | undefined;
  getChannelPermissionRequestHandler(): PermissionRequestHandler | undefined;
  getPermissionPromptHook(): PermissionPromptHook | undefined;
  getAlwaysPromptPermissions(): boolean;
  getMessagingPermissionMode(): boolean;
  getInboundSourceChannel(): string | null;
  getSessionRules(): PermissionRule[];
  getAgentPermissions(): PermissionRule[];
  getUserConfigRules(): PermissionRule[];
  /** Tools the user verbally consented to this turn (questionnaire / affirmative). */
  getPendingToolConsent?(): Set<string> | null;
  grantToolConsent?(toolId: string): void;
  /** Session waiver: user said don't ask / just carry on for low-risk proactive actions. */
  getSkipLowRiskProactiveConsent?(): boolean;
  /** Latest user turn text for detecting an explicit save/create request. */
  getCurrentUserMessage?(): string;
  /** Voice sessions collect concurrent permission asks into one spoken confirmation. */
  getVoiceTurnActive?(): boolean;
  /**
   * Clarify-first: ask "Shall I …?" via questionnaire before the permission modal.
   */
  requestActionConsent?(
    toolId: string,
    args: Record<string, unknown>,
    definition: ToolDefinition,
  ): Promise<ActionConsentResult>;
  emitPermissionOutcome?(outcome: PermissionOutcomeEmit): void;
}

/** Build a short human action phrase for consent questionnaires. */
export function summarizeToolAction(toolId: string, args: Record<string, unknown>, definition?: ToolDefinition): string {
  const name = definition?.name ?? toolId;
  const path = typeof args['path'] === 'string' ? args['path']
    : typeof args['file'] === 'string' ? args['file']
      : typeof args['filePath'] === 'string' ? args['filePath']
        : undefined;
  const cmd = typeof args['command'] === 'string' ? args['command']
    : typeof args['cmd'] === 'string' ? args['cmd']
      : undefined;
  if (toolId === 'file_write' || toolId === 'write_file') {
    return path ? `write a file at ${path}` : 'write a file';
  }
  if (toolId === 'save_to_article') {
    const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
    return title ? `save "${title}" as an Article` : 'save this analysis as an Article';
  }
  if (toolId === 'gen_markdown' || toolId === 'gen_html') {
    return path ? `create ${name} at ${path}` : `create a ${name} document`;
  }
  if (toolId === 'pdf_create' || toolId === 'docx_create' || toolId === 'xlsx_create' || toolId === 'pptx_create' || toolId === 'csv_create') {
    return path ? `create ${name} at ${path}` : `create a ${name} document`;
  }
  if (toolId === 'file_edit' || toolId === 'edit_file' || toolId === 'apply_patch') {
    return path ? `edit ${path}` : 'edit a file';
  }
  if (toolId === 'shell_exec' || toolId === 'bash' || toolId === 'run_command' || toolId === 'execute') {
    const short = cmd ? (cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd) : '';
    return short ? `run a shell command (${short})` : 'run a shell command';
  }
  if (toolId.startsWith('integration__') || toolId.includes('send')) {
    return `use ${name}`;
  }
  return path ? `use ${name} on ${path}` : `use ${name}`;
}

/**
 * Encapsulates tool permission rule evaluation and interactive prompting.
 */
export class ToolPermissionService {
  /** Only one clarify→permission flow may run at a time. */
  private flowBusy = false;

  async requestPermission(
    host: ToolPermissionHost,
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath?: string,
    tool?: ToolDefinition,
  ): Promise<PermissionResult> {
    return await this.requestPermissionInner(host, toolId, args, sessionId, scopePath, tool);
  }

  private async requestPermissionInner(
    host: ToolPermissionHost,
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath?: string,
    tool?: ToolDefinition,
  ): Promise<PermissionResult> {
    const definition = tool ?? host.getRegistry().get(toolId);
    if (!definition) {
      return { decision: 'deny', error: 'MODE_RESTRICTED' };
    }

    const permissionManager = host.getPermissionManager();
    const voiceTurn = host.getVoiceTurnActive?.() === true;
    const existingGrant = permissionManager.check(toolId, scopePath ?? undefined);
    if (!voiceTurn && (existingGrant === 'allow_always' || existingGrant === 'allow_once')) {
      return { decision: 'allow' };
    }
    if (voiceTurn && host.getPendingToolConsent?.()?.has(toolId)) {
      return { decision: 'allow' };
    }
    if (!voiceTurn && existingGrant === 'deny') {
      return { decision: 'deny', error: 'PERMISSION_DENIED' };
    }

    const permissionExempt = isPermissionExemptTool(toolId, definition?.category);
    if (permissionExempt) {
      return { decision: 'allow' };
    }

    const path = scopePath ?? '*';
    const ruleResult = evaluateRules(
      `tool:${toolId}`,
      path,
      host.getAgentPermissions(),
      host.getSessionRules(),
      host.getUserConfigRules(),
    );

    if (ruleResult === 'deny') {
      return { decision: 'deny', error: 'MODE_RESTRICTED' };
    }

    if (ruleResult === 'allow') {
      return { decision: 'allow' };
    }

    if (allPathsAreAgentInternal(args)) {
      return { decision: 'allow' };
    }

    if (
      (ATTACHMENT_READ_TOOLS.has(toolId) && allPathsAreSessionAttachments(sessionId, args))
      || isAttachmentReadViaToolCall(sessionId, toolId, args)
    ) {
      return { decision: 'allow' };
    }

    const shouldPrompt = host.getAlwaysPromptPermissions() || definition.riskLevel !== 'low';
    if (!shouldPrompt) {
      const bypassOn = voiceTurn ? false : permissionManager.getBypassPermissions();
      // Bypass: agent may proceed freely for low-risk tools.
      if (bypassOn) {
        return { decision: 'allow' };
      }
      // Low-risk proactive deliverables still need a plain-text confirmation unless
      // the user already asked for it this turn or waived asks for the session.
      if (isProactiveDeliverableTool(toolId)) {
        const waived = host.getSkipLowRiskProactiveConsent?.() === true;
        const explicit = detectsExplicitDeliverableRequest(host.getCurrentUserMessage?.() ?? '');
        const hadConsent = Boolean(host.getPendingToolConsent?.()?.has(toolId));
        if (!waived && !explicit && !hadConsent) {
          return {
            decision: 'deny',
            error: 'PERMISSION_INSTRUCTED',
            instruction: proactiveDeliverableConsentInstruction(toolId),
          };
        }
      }
      return { decision: 'allow' };
    }

    if (this.flowBusy && !voiceTurn) {
      return {
        decision: 'deny',
        error: 'PERMISSION_INSTRUCTED',
        instruction:
          'Another permission request is already waiting for the user. '
          + 'Only one permission may be asked at a time. Wait for their answer, then retry a single tool.',
      };
    }

    if (!voiceTurn) this.flowBusy = true;
    try {
      return await this.requestPermissionInteractive(
        host,
        toolId,
        args,
        sessionId,
        scopePath,
        definition,
        permissionManager,
      );
    } finally {
      if (!voiceTurn) this.flowBusy = false;
    }
  }

  private async requestPermissionInteractive(
    host: ToolPermissionHost,
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath: string | undefined,
    definition: ToolDefinition,
    permissionManager: PermissionManager,
  ): Promise<PermissionResult> {
    const path = scopePath ?? '*';
    const voiceTurn = host.getVoiceTurnActive?.() === true;
    const bypassOn = voiceTurn ? false : permissionManager.getBypassPermissions();
    const isChannelSession = isChannelSessionId(sessionId) || host.getMessagingPermissionMode();
    const actionSummary = summarizeToolAction(toolId, args, definition);
    const pathArg = typeof args['path'] === 'string' ? args['path']
      : typeof args['file'] === 'string' ? args['file']
        : (typeof path === 'string' && path !== '*' ? path : undefined);

    let hadConsent = Boolean(host.getPendingToolConsent?.()?.has(toolId));

    // Clarify-first (desktop): questionnaire "Shall I …?" before the permission modal.
    // Voice sessions are spoken-confirmation only — never a UI questionnaire.
    // When the host does not wire requestActionConsent (tests / automation), fall through to the modal.
    if (!voiceTurn && !isChannelSession && !hadConsent && host.requestActionConsent) {
      const consent = await host.requestActionConsent(toolId, args, definition);
      if (!consent.proceed) {
        host.emitPermissionOutcome?.({
          toolId,
          toolName: definition.name,
          path: pathArg,
          riskLevel: definition.riskLevel,
          decision: 'declined_consent',
          label: 'Declined',
          actionSummary,
        });
        return {
          decision: 'deny',
          error: 'PERMISSION_DENIED',
          instruction: consent.answer?.trim()
            ? `User declined: ${consent.answer.trim()}`
            : 'User declined this action.',
        };
      }
      host.grantToolConsent?.(toolId);
      hadConsent = true;
    }

    // Bypass ON: after clarify-first (or prior turn consent), skip the technical modal.
    if (bypassOn && !isChannelSession && hadConsent) {
      host.emitPermissionOutcome?.({
        toolId,
        toolName: definition.name,
        path: pathArg,
        riskLevel: definition.riskLevel,
        decision: 'allow_once',
        label: 'Allowed (bypass)',
        actionSummary,
      });
      return { decision: 'allow' };
    }

    // Bypass ON with no consent path (handler not wired): still skip modal — legacy behavior.
    if (bypassOn && !isChannelSession && !host.requestActionConsent) {
      host.emitPermissionOutcome?.({
        toolId,
        toolName: definition.name,
        path: pathArg,
        riskLevel: definition.riskLevel,
        decision: 'allow_once',
        label: 'Allowed (bypass)',
        actionSummary,
      });
      return { decision: 'allow' };
    }

    const permissionHandler = this.resolvePermissionRequestHandler(host, sessionId, voiceTurn);
    if (!permissionHandler) {
      return { decision: 'deny', error: 'PERMISSION_DENIED' };
    }

    const integrationPreview = isIntegrationToolId(toolId)
      ? (buildIntegrationActionPreview(toolId, args, definition) ?? undefined)
      : undefined;

    if (!voiceTurn) {
      host.getPermissionPromptHook()?.({
        toolId,
        path,
        riskLevel: definition.riskLevel,
        integrationPreview,
      });
    }

    const response = await permissionHandler(toolId, path, definition.riskLevel, {
      args,
      integrationPreview,
    });

    const { decision, instruction } = normalizePermissionHandlerResult(response);

    if (decision === 'deny') {
      host.emitPermissionOutcome?.({
        toolId,
        toolName: definition.name,
        path: pathArg,
        riskLevel: definition.riskLevel,
        decision: instruction ? 'instructed' : 'deny',
        label: instruction ? 'Instructed' : 'Denied',
        instruction,
        actionSummary,
      });
      return {
        decision: 'deny',
        error: instruction ? 'PERMISSION_INSTRUCTED' : 'PERMISSION_DENIED',
        instruction,
      };
    }

    if (decision === 'allow_always') {
      host.getPermissionManager().grant(toolId, 'allow_always' as PermissionDecision, scopePath ?? undefined);
      host.grantToolConsent?.(toolId);
      host.emitPermissionOutcome?.({
        toolId,
        toolName: definition.name,
        path: pathArg,
        riskLevel: definition.riskLevel,
        decision: 'allow_always',
        label: 'Allowed always',
        actionSummary,
      });
      return { decision: 'allow_always' };
    }

    host.grantToolConsent?.(toolId);
    host.emitPermissionOutcome?.({
      toolId,
      toolName: definition.name,
      path: pathArg,
      riskLevel: definition.riskLevel,
      decision: 'allow_once',
      label: 'Allowed once',
      actionSummary,
    });
    return { decision: 'allow_once' };
  }

  private resolvePermissionRequestHandler(
    host: ToolPermissionHost,
    sessionId: string,
    voiceTurn = false,
  ): PermissionRequestHandler | undefined {
    // Voice confirmation must use the voice handler, never Telegram/Slack/Discord UI.
    if (voiceTurn) return host.getPermissionRequestHandler();
    const channelHandler = host.getChannelPermissionRequestHandler();
    if (channelHandler && (isChannelSessionId(sessionId) || host.getMessagingPermissionMode())) {
      return channelHandler;
    }
    return host.getPermissionRequestHandler();
  }
}
