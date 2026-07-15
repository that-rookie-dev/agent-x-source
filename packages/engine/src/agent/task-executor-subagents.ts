import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { TaskStep, TaskPlan } from './TaskExecutor.js';
import {
  VERIFY_SYSTEM_PROMPT,
  FINAL_VERIFY_SYSTEM_PROMPT,
  extractJsonObject,
  tryShellExec,
} from './task-executor-helpers.js';

/**
 * Context required by the extracted sub-agent & verification functions.
 */
export interface SubAgentContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
}

/**
 * Execute a single step by sending a prompt to the agent.
 */
export async function executeStep(agent: Agent, step: TaskStep, goal: string): Promise<string> {
  let stepPrompt = `Continuing the task: "${goal}"\n\nCurrent step: ${step.description}\nExpected outcome: ${step.expectedOutcome}\n\nExecute this step now.`;
  if (step.repoPath) {
    const repoContext = await tryShellExec(agent,
      `ls "${step.repoPath}/" 2>/dev/null && echo "--- repo exists ---" || echo "--- cloning ---" && git clone "$(git remote get-url origin 2>/dev/null)" "${step.repoPath}" 2>/dev/null && echo "--- done ---" || echo "--- using existing ---"`,
    );
    stepPrompt = `Working in repo: ${step.repoPath}\n${repoContext.slice(0, 500)}\n\n${stepPrompt}\n\nEnsure all file operations use the absolute path "${step.repoPath}".`;
  }
  const message = await agent.sendMessage(stepPrompt);
  return message.content;
}

/**
 * Verify a step result against its expected outcome.
 */
export async function verify(
  ctx: SubAgentContext,
  step: TaskStep,
  result: string,
): Promise<{ passed: boolean; reason: string }> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const verifyResult = await generateText({
    model,
    system: VERIFY_SYSTEM_PROMPT,
    prompt: `Step: ${step.description}\nExpected: ${step.expectedOutcome}\n\nResult:\n${result.slice(0, 3000)}`,
    temperature: 0.1,
    maxRetries: 1,
  });

  const parsed = extractJsonObject<{ passed: boolean; reason: string }>(verifyResult.text);
  if (parsed) {
    return { passed: Boolean(parsed.passed), reason: parsed.reason || 'No reason given' };
  }

  const passed = /"passed"\s*:\s*true/i.test(verifyResult.text);
  return { passed, reason: passed ? 'Step completed' : 'Verification failed to parse, assuming failure' };
}

/**
 * Final goal verification: check if the overall goal was achieved.
 */
export async function verifyGoal(
  ctx: SubAgentContext,
  goal: string,
  plan: TaskPlan,
): Promise<{ achieved: boolean; reason: string; gaps?: string[] }> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const stepsSummary = plan.steps.map((s, i) =>
    `${i + 1}. ${s.description} — ${s.status}${s.result ? ': ' + s.result.slice(0, 200) : ''}`,
  ).join('\n');

  const verifyResult = await generateText({
    model,
    system: FINAL_VERIFY_SYSTEM_PROMPT,
    prompt: `Original goal: ${goal}\n\nCompleted steps:\n${stepsSummary}\n\nWas the goal fully achieved?`,
    temperature: 0.1,
    maxRetries: 1,
  });

  const parsed = extractJsonObject<{ achieved: boolean; reason: string; gaps?: string[] }>(verifyResult.text);
  if (parsed) {
    return {
      achieved: Boolean(parsed.achieved),
      reason: parsed.reason || 'No reason given',
      gaps: parsed.gaps || [],
    };
  }

  return { achieved: false, reason: 'Failed to parse verification result', gaps: [] };
}

/**
 * Hallucination guardrail: cross-reference factual claims in step output
 * against tool execution results. Detects fabricated content.
 */
export async function verifyFacts(
  ctx: SubAgentContext,
  step: TaskStep,
  result: string,
): Promise<{ passed: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  const mentionedFiles = result.match(/["'`]?([\w./-]+\.[\w]{1,8})["'`]?/g) || [];
  for (const f of mentionedFiles.slice(0, 10)) {
    const clean = f.replace(/["'`]/g, '');
    const exists = await tryShellExec(ctx.agent, `test -f "${clean}" && echo "y" || echo "n"`);
    if (exists.trim() !== 'y' && !clean.startsWith('http') && !/^\d+\.\d+/.test(clean)) {
      warnings.push(`Claimed file "${clean}" may not exist — verify`);
    }
  }

  const statClaims = result.match(/(\d+%|[\d,]+ (?:users|requests|items|records|errors|lines|files|rows))/gi);
  if (statClaims && statClaims.length > 2) {
    const hasSource = /(?:according to|source|from|based on|measured|observed|found|returned|output)/i.test(result);
    if (!hasSource) {
      warnings.push(`${statClaims.length} statistical claims without verifiable source context`);
    }
  }

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
    passed: warnings.length < 3,
    warnings,
  };
}

/**
 * Try to switch to a fallback model if the primary model fails.
 * Uses a prioritized chain: fastest/cheapest first, most capable last.
 */
export async function tryModelFailover(
  ctx: SubAgentContext,
  usedFallbackModels: Set<string>,
): Promise<boolean> {
  const fallbackModels: string[] = [
    'gemini-2.0-flash',
    'claude-3-haiku-20240307',
    'gpt-4o-mini',
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'gemini-2.0-pro-exp',
  ];

  for (const fb of fallbackModels) {
    if (usedFallbackModels.has(fb)) continue;
    if (ctx.agent.isModelGrounded(fb)) {
      getLogger().info('TASK_EXECUTOR', `Skipping grounded fallback model: ${fb}`);
      continue;
    }
    usedFallbackModels.add(fb);

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
