import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { FailureRecord, TaskStep } from './TaskExecutor.js';
import { PLAN_SYSTEM_PROMPT, extractJsonArray, tryShellExec } from './task-executor-helpers.js';

/**
 * Context required by the extracted verification & operational functions.
 * Only includes the properties/methods actually used by these functions.
 */
export interface VerifyOpsContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  /** Mutable set of models already tried during failover. */
  usedFallbackModels: Set<string>;
  /** The original model name to restore to after failover recovery. */
  originalModel: string;
}

export async function checkRegressions(
  ctx: VerifyOpsContext,
  commands: Array<{ cmd: string; timeout: number }>,
  gitManager?: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> },
): Promise<string | null> {
  const fullTestCommands = commands.filter(c =>
    /test|spec|check/i.test(c.cmd) && !/build/i.test(c.cmd)
  );
  if (fullTestCommands.length === 0) return null;

  for (const tc of fullTestCommands) {
    const output = await tryShellExec(ctx.agent, tc.cmd);
    if (output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('not ok')) {
      getLogger().warn('TASK_EXECUTOR', `Regression detected in: ${tc.cmd}`);
      // Auto-rollback: revert each completed step snapshot in reverse order until regression clears
      if (gitManager?.listSnapshots) {
        const snapshots = gitManager.listSnapshots();
        for (let s = snapshots.length - 1; s >= 0; s--) {
          getLogger().info('TASK_EXECUTOR', `Rolling back snapshot ${s}: ${snapshots[s]!.hash.slice(0, 12)}`);
          if (gitManager.revert?.(snapshots[s]!.hash)) {
            // Check if regression is resolved
            const retryOutput = await tryShellExec(ctx.agent, tc.cmd);
            if (!retryOutput.toLowerCase().includes('error') && !retryOutput.toLowerCase().includes('fail') && !retryOutput.toLowerCase().includes('not ok')) {
              return `Regression resolved by rolling back snapshot ${s}`;
            }
          }
        }
      }
      return `REGRESSION: ${tc.cmd} failed — ${output.slice(0, 200)}`;
    }
  }
  return `All regression checks passed`;
}

/**
 * Hallucination guardrail: cross-reference factual claims in step output
 * against tool execution results. Detects fabricated content.
 */
export async function verifyFacts(ctx: VerifyOpsContext, step: TaskStep, result: string): Promise<{ passed: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  // Extract file path claims
  const mentionedFiles = result.match(/["'`]?([\w./-]+\.[\w]{1,8})["'`]?/g) || [];
  for (const f of mentionedFiles.slice(0, 10)) {
    const clean = f.replace(/["'`]/g, '');
    const exists = await tryShellExec(ctx.agent, `test -f "${clean}" && echo "y" || echo "n"`);
    if (exists.trim() !== 'y' && !clean.startsWith('http') && !/^\d+\.\d+/.test(clean)) {
      warnings.push(`Claimed file "${clean}" may not exist — verify`);
    }
  }

  // Detect fabricated statistics/numbers without source context
  const statClaims = result.match(/(\d+%|[\d,]+ (?:users|requests|items|records|errors|lines|files|rows))/gi);
  if (statClaims && statClaims.length > 2) {
    const hasSource = /(?:according to|source|from|based on|measured|observed|found|returned|output)/i.test(result);
    if (!hasSource) {
      warnings.push(`${statClaims.length} statistical claims without verifiable source context`);
    }
  }

  // Cross-reference with step result claims — if step claims "created file X" but result doesn't mention it
  const creationClaims = result.match(/(?:created|wrote|generated|built|compiled)\s+["'`]?([\w./-]+)["'`]?/gi) || [];
  if (creationClaims.length > 0 && step.result) {
    for (const claim of creationClaims) {
      const fileMatch = claim.match(/["'`]?([\w./-]+\.[\w]{1,8})["'`]?/);
      if (fileMatch && !(step.result.includes(fileMatch[1]!))) {
        warnings.push(`Claimed "${claim}" but not found in tool results`);
      }
    }
  }

  return {
    passed: warnings.length < 3, // Allow minor inconsistencies
    warnings,
  };
}

export async function replan(
  ctx: VerifyOpsContext,
  goal: string,
  failedSteps: TaskStep[],
  lastResult: string,
  failureReason: string,
  failureHistory: FailureRecord[],
): Promise<TaskStep[]> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const remainingDesc = failedSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
  const failureContext = failureHistory.length > 0
    ? '\nPrevious failed attempts for context:\n' + failureHistory.map(f =>
        `  - Attempt ${f.attemptNumber} at "${f.description}": ${f.failureReason}`
      ).join('\n')
    : '';

  const replanResult = await generateText({
    model,
    system: PLAN_SYSTEM_PROMPT + '\n\nYou are re-planning because a previous step failed. Adjust the remaining steps to account for the failure. DO NOT repeat the same approach that already failed.\n\nWeb research is available — use research steps to investigate the failure and find solutions before re-attempting.',
    prompt: `Goal: ${goal}\n\nFailed step: ${failedSteps[0]?.description}\nFailure reason: ${failureReason}\nPartial result: ${lastResult.slice(0, 1000)}${failureContext}\n\nRemaining steps to replan:\n${remainingDesc}\n\nProvide a revised plan (JSON array).`,
    temperature: 0.4,
    maxRetries: 2,
  });

  const parsed = extractJsonArray(replanResult.text);
  if (!parsed || parsed.length === 0) return failedSteps;

  // Preserve repoPath from the original failed step if the first entry has one
  const firstFailedStep = failedSteps[0];
  const defaultRepoPath = firstFailedStep?.repoPath;

  return parsed.map(s => ({
    id: crypto.randomUUID(),
    description: (s['description'] as string) || 'Revised step',
    expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
    status: 'pending' as const,
    repoPath: (s['repoPath'] as string) || defaultRepoPath,
  }));
}

/**
 * Try to switch to a fallback model if the primary model fails.
 * Uses a prioritized chain: fastest/cheapest first, most capable last.
 */
export async function tryModelFailover(ctx: VerifyOpsContext): Promise<boolean> {
  const fallbackModels: string[] = [
    'gemini-2.0-flash',
    'claude-3-haiku-20240307',
    'gpt-4o-mini',
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'gemini-2.0-pro-exp',
  ];

  const usedFallbacks = ctx.usedFallbackModels;

  for (const fb of fallbackModels) {
    if (usedFallbacks.has(fb)) continue;
    if (ctx.agent.isModelGrounded(fb)) {
      getLogger().info('TASK_EXECUTOR', `Skipping grounded fallback model: ${fb}`);
      continue;
    }
    usedFallbacks.add(fb);

    try {
      getLogger().info('TASK_EXECUTOR', `Trying fallback model: ${fb}`);
      const available = await ctx.agent.trialModel(fb);
      if (!available) {
        getLogger().warn('TASK_EXECUTOR', `Fallback model ${fb} is not available`);
        continue;
      }
      ctx.agent.switchModel(fb);
      ctx.config.provider.activeModel = fb;
      getLogger().info('TASK_EXECUTOR', `Switched to fallback model: ${fb}`);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Detect and analyze image/screenshot/visual assets referenced in the goal.
 * Returns a description string to inject into planning context, or null.
 */
export async function processGoalVisuals(ctx: VerifyOpsContext, goal: string): Promise<string | null> {
  const imageRefs: string[] = [];
  const imgRe = /["']?([\w./-]+\.(?:png|jpg|jpeg|gif|bmp|webp|svg|fig|sketch|xd|psd))["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(goal)) !== null) {
    if (m[1]) imageRefs.push(m[1]);
  }
  // Also detect generic references like "screenshot", "wireframe", "diagram", "mockup"
  const hasGenericRef = /screenshot|wireframe|diagram|mockup|visual|design|ui\s*mock|prototype/i.test(goal) && imageRefs.length === 0;

  if (imageRefs.length === 0 && !hasGenericRef) return null;

  const descriptions: string[] = [];

  for (const ref of imageRefs) {
    const exists = await tryShellExec(ctx.agent, `test -f "${ref}" && echo "exists" || echo "not found"`);
    if (exists.trim() === 'exists') {
      const fileInfo = await tryShellExec(ctx.agent, `file "${ref}" 2>/dev/null || echo "unknown"`);
      const sizeInfo = await tryShellExec(ctx.agent, `wc -c "${ref}" 2>/dev/null | awk '{print $1}' || echo "unknown"`);
      descriptions.push(`- ${ref} (${fileInfo.trim().split(',')[0] || 'image'}, ${sizeInfo.trim()} bytes)`);
    } else {
      descriptions.push(`- ${ref} (referenced but not found in workspace)`);
    }
  }

  if (hasGenericRef) {
    descriptions.push('- Generic visual reference (screenshot/diagram/mockup) mentioned');
  }

  if (descriptions.length === 0) return null;

  return descriptions.join('\n');
}
