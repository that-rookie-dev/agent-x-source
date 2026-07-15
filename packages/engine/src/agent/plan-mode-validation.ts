/**
 * Plan-mode validation helpers extracted from Agent.ts (REFACTOR-2, Group 2).
 *
 * These standalone functions accept a `PlanModeValidationContext` (the slice of
 * AgentFacade they need) instead of `this`, preserving all original behavior.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { streamText } from 'ai';
import type { Message, EngineEvent, AgentXConfig, CompletionMessage } from '@agentx/shared';
import { generateMessageId, getLogger, appendStreamText, extractStreamTextDelta, resolveEffectiveMaxOutputTokens, estimatePromptTokens } from '@agentx/shared';
import { isWriteTool } from './plan-mode-utils.js';
import { createAiSdkModel } from './AiSdkBridge.js';
import { buildCompletionMessages } from './context-profile.js';
import type { ToolLedger } from './ToolLedger.js';

/** Slice of AgentFacade required by the plan-mode validation helpers. */
export interface PlanModeValidationContext {
  sessionId: string;
  scopePath: string;
  config: AgentXConfig;
  messages: CompletionMessage[];
  toolLedger: ToolLedger;
  toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }>;
  partialTurnContent: string;
  sessionManager: unknown;
  getApiKey(): string | undefined;
  getContextWindow(): number;
  getActiveModelCaps(): { hasReasoning: boolean; contextWindow?: number; outputTokenLimit?: number };
  emit(event: EngineEvent, isUpdateFlag?: boolean): void;
}

/**
 * Detect plan-mode violations (successful write tools) and rollback via latest checkpoint.
 */
export async function enforcePlanModeViolations(ctx: PlanModeValidationContext, turnStart: number): Promise<void> {
  const violations = ctx.toolLedger.getEntries().filter((e) => e.success && isWriteTool(e.name));
  if (violations.length === 0) return;

  getLogger().warn('AGENT', `Plan mode violation: ${violations.length} write tool(s) succeeded`);
  let checkpointId: string | undefined;
  let rolledBack = false;

  try {
    const store = (ctx.sessionManager as unknown as { store?: { listCheckpoints?: (sid: string) => Array<{ id: string; createdAt: string }>; restoreCheckpoint?: (sid: string, id: string) => boolean } })?.store;
    if (store?.listCheckpoints && store.restoreCheckpoint) {
      const checkpoints = store.listCheckpoints(ctx.sessionId);
      const turnStartIso = new Date(turnStart - 5000).toISOString();
      const candidate = checkpoints
        .filter((c) => c.createdAt >= turnStartIso)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
        ?? checkpoints[checkpoints.length - 1];
      if (candidate) {
        checkpointId = candidate.id;
        rolledBack = store.restoreCheckpoint(ctx.sessionId, checkpointId);
      }
    }
  } catch (e) {
    getLogger().error('PLAN_VIOLATION', e instanceof Error ? e.message : String(e));
  }

  ctx.emit({
    type: 'plan_mode_violation',
    violations: violations.map((v) => ({ tool: v.name, path: v.path, output: v.output.slice(0, 200) })),
    checkpointId,
    rolledBack,
  });
}

/**
 * Detect if agent response claims success for restricted operations while in plan mode.
 * Returns whether response is transparent about mode restrictions.
 */
export function validateModeRestrictionTransparency(
  ctx: PlanModeValidationContext,
  responseContent: string,
  toolExecutions: Array<{ name: string; success: boolean; output: string; elapsed: number }>
): { isTransparent: boolean; issues: string[] } {
  const issues: string[] = [];

  // Pattern: agent claims to have created/edited/deleted files
  const writePatterns = [
    /created\s+(["`]?[\w./-]+["`]?)/gi,
    /created the file/gi,
    /created a new file/gi,
    /wrote.*to\s+(["`]?[\w./-]+["`]?)/gi,
    /edited\s+(["`]?[\w./-]+["`]?)/gi,
    /modified\s+(["`]?[\w./-]+["`]?)/gi,
    /deleted\s+(["`]?[\w./-]+["`]?)/gi,
    /done!\s*i'[^ ]*ve created/gi,
    /done.*created/gi,
    /i've created/gi,
    /i have created/gi,
  ];

  let claimsRestrictedMutation = false;
  for (const pattern of writePatterns) {
    if (pattern.test(responseContent)) {
      claimsRestrictedMutation = true;
      break;
    }
  }

  // Check if any edit/delete operations failed
  const restrictedToolsAttempted = toolExecutions.filter(t => isWriteTool(t.name));
  const failedRestricted = restrictedToolsAttempted.filter(t => !t.success);

  // Filesystem ground-truth: if a claimed path exists but tool reported failure, note the mismatch
  for (const entry of failedRestricted) {
    const pathMatch = entry.output.match(/path[=:\s]+(["']?)([\w./-]+)\1/i)
      || entry.output.match(/([\w./-]+\.\w{1,8})/);
    const relPath = pathMatch?.[2] || pathMatch?.[1];
    if (relPath) {
      const absPath = resolve(ctx.scopePath, relPath);
      if (existsSync(absPath)) {
        issues.push(`Tool ${entry.name} reported failure but file exists: ${relPath}`);
      }
    }
  }

  if (claimsRestrictedMutation && failedRestricted.length > 0) {
    issues.push(`Agent claimed success but ${failedRestricted.length} edit/delete operation(s) failed`);
  }

  if ((responseContent.includes('Done!') || responseContent.includes('Completed!')) &&
      claimsRestrictedMutation &&
      failedRestricted.length > 0 &&
      !responseContent.toLowerCase().includes('plan mode') &&
      !responseContent.toLowerCase().includes('mode restriction') &&
      !responseContent.toLowerCase().includes('switch to agent')) {
    issues.push('Claims completion without mentioning mode restriction');
  }

  return {
    isTransparent: issues.length === 0,
    issues,
  };
}

/**
 * Send the fabricated response back to LLM with context about the restriction,
 * and request a refactored honest response.
 */
export async function refactorResponseForTransparency(
  ctx: PlanModeValidationContext,
  originalMessage: Message,
  validation: { isTransparent: boolean; issues: string[] }
): Promise<Message> {
  getLogger().info('AGENT', `Refactoring response due to mode restriction transparency issues: ${validation.issues.join(', ')}`);

  // Build context about what failed
  const failedOps = ctx.toolCallLogForReflection
    .filter(t => !t.success)
    .map(t => `- ${t.name}: ${t.output.slice(0, 100)}`)
    .join('\n');

  const refactorPrompt = `[SYSTEM] Your previous response contained an issue:

PROBLEM: You claimed to have edited/deleted files, but those edit/delete tools failed in Plan Mode.
The following operations actually FAILED:
${failedOps}

YOUR PREVIOUS RESPONSE:
${originalMessage.content}

FIX: Rewrite your response to be honest. You must:
1. Explain EXACTLY what edit/delete action you tried
2. Explain that edit/delete requires Agent Mode or Hyperdrive
3. Note that reads, new files, scripts, search, and scheduling work in Plan mode
4. Do NOT claim an edit or delete succeeded

Provide the corrected response now:`;

  try {
    const model = createAiSdkModel(ctx.config, ctx.getApiKey());
    const aiMessages = buildCompletionMessages(
      ctx.messages.slice(0, -1).map(m => ({
        role: m.role,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
      })),
      false,
      3,
      ctx.config.provider.activeProvider,
    ).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));
    aiMessages.push({ role: 'user', content: refactorPrompt });

    let refactoredContent = '';
    ctx.emit({ type: 'loading_start', stage: 'refactoring' });
    const refactorMaxOutputTokens = resolveEffectiveMaxOutputTokens({
      configured: ctx.config.maxOutputTokens,
      contextWindow: ctx.getContextWindow(),
      estimatedInputTokens: estimatePromptTokens(aiMessages, 0, 0),
      modelCaps: ctx.getActiveModelCaps(),
    });
    const refactorResult = streamText({
      model,
      messages: aiMessages,
      tools: undefined,
      maxRetries: 1,
      maxOutputTokens: refactorMaxOutputTokens,
    });

    for await (const chunk of refactorResult.fullStream) {
      if (chunk.type === 'text-delta') {
        const delta = extractStreamTextDelta(chunk as Record<string, unknown>);
        refactoredContent = appendStreamText(refactoredContent, delta);
        ctx.partialTurnContent = refactoredContent;
        ctx.emit({ type: 'stream_chunk', content: delta, fullContent: refactoredContent });
      }
    }
    ctx.emit({ type: 'loading_end' });

    if (refactoredContent.trim()) {
      getLogger().info('AGENT', `Refactored response (${refactoredContent.length} chars)`);
      ctx.messages[ctx.messages.length - 1] = { role: 'assistant', content: refactoredContent };
      return {
        id: generateMessageId(),
        sessionId: ctx.sessionId,
        role: 'assistant',
        content: refactoredContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: Math.ceil(refactoredContent.length / 4),
      };
    }
  } catch (error) {
    getLogger().error('REFACTOR', error instanceof Error ? error.message : String(error));
    // If refactor fails, return original but prepend a disclaimer
  }

  // Fallback: return original with disclaimer prepended
  const disclaimer = `⚠️ MODE RESTRICTION: You are in Plan Mode (read-only). The operation(s) above could not be executed. Switch to Agent Mode to enable file operations.\n\n${originalMessage.content}`;
  return {
    ...originalMessage,
    content: disclaimer,
  };
}
