import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { TaskStep, TaskPlan, FailureRecord } from './TaskExecutor.js';
import {
  ANALYSIS_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  extractJsonArray,
  extractJsonObject,
  tryShellExec,
} from './task-executor-helpers.js';

/**
 * Context required by the extracted planning & decomposition functions.
 */
export interface PlanningContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
}

/**
 * Analyze the project environment and domain for a given goal.
 */
export async function analyzeProject(
  ctx: PlanningContext,
  goal: string,
): Promise<{ projectType: string; techStack: string[]; conventions: string[]; keyFiles: string[]; risks: string[] } | null> {
  try {
    const filesToCheck = ['package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'Dockerfile', 'Makefile', '.gitignore', 'composer.json', 'CMakeLists.txt'];
    const found: string[] = [];
    for (const file of filesToCheck) {
      const output = await tryShellExec(ctx.agent, `test -f "${file}" && echo "exists" || echo "not found"`);
      if (output.trim() === 'exists') found.push(file);
    }

    if (found.length > 0) {
      let projectContext = `Detected files: ${found.join(', ')}\n\n`;
      if (found.includes('package.json')) {
        const pkg = await tryShellExec(ctx.agent, 'cat package.json 2>/dev/null | head -100');
        projectContext += `package.json:\n${pkg.slice(0, 2000)}\n\n`;
      }
      if (found.includes('tsconfig.json')) {
        const tsconfig = await tryShellExec(ctx.agent, 'cat tsconfig.json 2>/dev/null | head -50');
        projectContext += `tsconfig.json:\n${tsconfig.slice(0, 1000)}\n\n`;
      }

      const model = createAiSdkModel(ctx.config, ctx.apiKey);
      const result = await generateText({
        model,
        system: ANALYSIS_SYSTEM_PROMPT,
        prompt: `User goal: ${goal}\n\nProject context:\n${projectContext}\n\nAnalyze this project and the goal.`,
        temperature: 0.2,
        maxRetries: 1,
      });

      const parsed = extractJsonObject<{ projectType: string; techStack: string[]; conventions: string[]; keyFiles: string[]; risks: string[] }>(result.text);
      if (parsed) {
        return {
          projectType: parsed.projectType || 'existing',
          techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
          conventions: Array.isArray(parsed.conventions) ? parsed.conventions : [],
          keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles : found,
          risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decompose a goal prompt into an array of task steps.
 */
export async function decompose(ctx: PlanningContext, prompt: string): Promise<TaskStep[]> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const result = await generateText({
    model,
    system: PLAN_SYSTEM_PROMPT,
    prompt,
    temperature: 0.3,
    maxRetries: 2,
  });

  const parsed = extractJsonArray(result.text);
  if (!parsed || parsed.length === 0) {
    getLogger().warn('TASK_EXECUTOR', 'Failed to parse plan JSON, using single-step fallback');
    return [{
      id: crypto.randomUUID(),
      description: prompt.slice(0, 200),
      expectedOutcome: 'Goal completed successfully',
      status: 'pending' as const,
    }];
  }

  return parsed.map((s, i) => ({
    id: crypto.randomUUID(),
    description: (s['description'] as string) || `Step ${i + 1}`,
    expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
    status: 'pending' as const,
    repoPath: (s['repoPath'] as string) || undefined,
  }));
}

/**
 * Validate and clean up plan steps (ensure IDs, filter invalid deps).
 */
export function validatePlanSteps(steps: TaskStep[]): TaskStep[] {
  if (steps.length === 0) return steps;
  const stepIds = new Set(steps.map(s => s.id));
  const valid: TaskStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!step.id) step.id = crypto.randomUUID();
    if (!step.description || step.description.trim().length < 3) continue;
    if (step.dependencies) {
      step.dependencies = step.dependencies.filter(d => stepIds.has(d) && d !== step.id);
    }
    if (step.parallel) {
      step.parallel = true;
    }
    valid.push(step);
  }

  return valid.length > 0 ? valid : steps.slice(0, 1);
}

/**
 * Mid-plan re-evaluation: check if the plan needs adjustment.
 */
export async function midPlanReevaluation(ctx: PlanningContext, plan: TaskPlan, goal: string): Promise<void> {
  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  if (completedCount < 3) return;
  if (completedCount % 3 !== 0) return;

  getLogger().info('TASK_EXECUTOR', `Mid-plan re-evaluation at step ${completedCount}`);
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const stepsSummary = plan.steps.map((s, i) =>
    `${i + 1}. ${s.description} — ${s.status}${s.result ? ': ' + s.result.slice(0, 100) : ''}`,
  ).join('\n');

  const reEvalResult = await generateText({
    model,
    system: `You are a plan reviewer. Given the original goal, current progress, and remaining steps, determine if the plan needs adjustment.
Return JSON: { "needsAdjustment": boolean, "reason": "...", "suggestedChanges": ["..."] }
If the plan is on track, return {"needsAdjustment": false}.`,
    prompt: `Original goal: ${goal}\n\nProgress so far:\n${stepsSummary}\n\nRemaining steps:\n${plan.steps.slice(completedCount).map((s, i) => `${i + 1}. ${s.description}`).join('\n')}\n\nDoes the plan need adjustment?`,
    temperature: 0.2,
    maxRetries: 1,
  });

  const parsed = extractJsonObject<{ needsAdjustment: boolean; reason: string; suggestedChanges: string[] }>(reEvalResult.text);
  if (parsed?.needsAdjustment) {
    getLogger().info('TASK_EXECUTOR', `Mid-plan adjustment: ${parsed.reason}`);
  }
}

/**
 * Generate an alternative approach for a failed step.
 */
export async function generateAlternativeApproach(
  ctx: PlanningContext,
  step: TaskStep,
  failureReason: string,
  lastResult: string,
  goal: string,
): Promise<string> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const altResult = await generateText({
    model,
    system: `You are a creative problem solver. The current approach to a step failed. Generate 1-2 alternative approaches.
Return JSON: { "approaches": [{"description": "...", "rationale": "..."}] }
Focus on fundamentally different approaches — not minor tweaks.`,
    prompt: `Goal: ${goal}\n\nFailed step: ${step.description}\nFailure: ${failureReason}\nLast attempt output: ${lastResult.slice(0, 1000)}\n\nWhat alternative approach should be tried next?`,
    temperature: 0.5,
    maxRetries: 1,
  });

  const parsed = extractJsonObject<{ approaches: Array<{ description: string; rationale: string }> }>(altResult.text);
  if (parsed?.approaches?.length) {
    return parsed.approaches.map(a => `  - ${a.description} (${a.rationale})`).join('\n');
  }
  return '';
}

/**
 * Suggest new sub-tasks after a step completes.
 */
export async function suggestNewSubtasks(
  ctx: PlanningContext,
  plan: TaskPlan,
  step: TaskStep,
  goal: string,
): Promise<TaskStep[]> {
  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  if (completedCount < 2) return [];

  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const result = await generateText({
    model,
    system: `You are a project manager. Given the goal, current plan, and just-completed step, determine if new sub-tasks are needed.

Return a JSON array of additional steps, or empty array if none needed.
Each step: { "description": "...", "expectedOutcome": "..." }

Only add steps that are genuinely necessary — don't over-engineer.`,
    prompt: `Goal: ${goal}\n\nCompleted steps: ${plan.steps.filter(s => s.status === 'completed').map((s, idx) => `\n${idx + 1}. ${s.description}`).join('')}\n\nJust completed: ${step.description}\nResult: ${(step.result || '').slice(0, 500)}\n\nAre there any new sub-tasks that this step uncovered?`,
    temperature: 0.2,
    maxRetries: 1,
  });

  const parsed = extractJsonArray(result.text);
  if (!parsed || parsed.length === 0) return [];
  return parsed.map(s => ({
    id: crypto.randomUUID(),
    description: (s['description'] as string) || 'Additional sub-task',
    expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
    status: 'pending' as const,
    repoPath: (s['repoPath'] as string) || undefined,
  }));
}

/**
 * Ensure required runtimes are installed based on detected tech stack.
 */
export async function ensureRuntimes(
  ctx: PlanningContext,
  conventions: { techStack: string[]; projectType: string } | null,
): Promise<void> {
  if (!conventions) return;
  const techStack = conventions.techStack || [];
  if (techStack.length === 0) return;

  const runtimeMap: Array<{ check: string; install: string; name: string; marker: string }> = [];

  if (techStack.some(t => /node|javascript|typescript|js|ts/i.test(t))) {
    runtimeMap.push({ check: 'node --version 2>&1', install: '', name: 'Node.js', marker: 'node' });
    runtimeMap.push({ check: 'npm --version 2>&1', install: '', name: 'npm', marker: 'npm' });
  }
  if (techStack.some(t => /python|pytest|django|flask/i.test(t))) {
    runtimeMap.push({ check: 'python3 --version 2>&1 || python --version 2>&1', install: '', name: 'Python', marker: 'python' });
    runtimeMap.push({ check: 'pip3 --version 2>&1 || pip --version 2>&1', install: '', name: 'pip', marker: 'pip' });
  }
  if (techStack.some(t => /rust|cargo/i.test(t))) {
    runtimeMap.push({ check: 'rustc --version 2>&1', install: '', name: 'Rust', marker: 'rust' });
    runtimeMap.push({ check: 'cargo --version 2>&1', install: '', name: 'Cargo', marker: 'cargo' });
  }
  if (techStack.some(t => /go|golang/i.test(t))) {
    runtimeMap.push({ check: 'go version 2>&1', install: '', name: 'Go', marker: 'go' });
  }

  for (const rt of runtimeMap) {
    const output = await tryShellExec(ctx.agent, rt.check);
    if (output.trim().toLowerCase().includes('not found') || output.trim().toLowerCase().includes('command not found') || !output.trim()) {
      getLogger().warn('TASK_EXECUTOR', `Missing runtime: ${rt.name}. Attempting auto-install...`);
      await installRuntime(ctx, rt);
    } else {
      getLogger().info('TASK_EXECUTOR', `Runtime ${rt.name}: ${output.trim().split('\n')[0]}`);
    }
  }
}

/**
 * Install a specific runtime.
 */
export async function installRuntime(
  ctx: PlanningContext,
  rt: { check: string; install: string; name: string; marker: string },
): Promise<void> {
  const cmds: string[] = [];
  switch (rt.marker) {
    case 'node':
      cmds.push('curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - 2>&1 || true');
      cmds.push('apt-get install -y nodejs 2>&1 || brew install node 2>&1 || true');
      break;
    case 'npm':
      cmds.push('npm install -g npm@latest 2>&1 || true');
      break;
    case 'python':
      cmds.push('apt-get install -y python3 python3-pip 2>&1 || brew install python 2>&1 || true');
      break;
    case 'pip':
      cmds.push('python3 -m ensurepip --upgrade 2>&1 || python -m ensurepip --upgrade 2>&1 || true');
      break;
    case 'rust':
      cmds.push('curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>&1 && source "$HOME/.cargo/env" || true');
      break;
    case 'cargo':
      cmds.push('curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>&1 && source "$HOME/.cargo/env" || true');
      break;
    case 'go':
      cmds.push('apt-get install -y golang-go 2>&1 || brew install go 2>&1 || true');
      break;
  }
  for (const cmd of cmds) {
    await tryShellExec(ctx.agent, cmd);
  }
  const verify = await tryShellExec(ctx.agent, rt.check);
  if (verify.trim() && !verify.toLowerCase().includes('not found')) {
    getLogger().info('TASK_EXECUTOR', `Successfully installed ${rt.name}: ${verify.trim().split('\n')[0]}`);
  } else {
    getLogger().warn('TASK_EXECUTOR', `Failed to install ${rt.name}. Continuing anyway.`);
  }
}

/**
 * Ensure project dependencies are installed (node_modules, Python venv).
 */
export async function ensureDependencies(ctx: PlanningContext): Promise<void> {
  const hasNodeModules = await tryShellExec(ctx.agent, 'test -d "node_modules" && echo "y" || echo "n"');
  if (hasNodeModules.trim() !== 'y') {
    const hasPackageJson = await tryShellExec(ctx.agent, 'test -f "package.json" && echo "y" || echo "n"');
    if (hasPackageJson.trim() === 'y') {
      getLogger().info('TASK_EXECUTOR', 'node_modules not found — running npm install');
      await tryShellExec(ctx.agent, 'npm install 2>&1 || pnpm install 2>&1 || yarn install 2>&1');
    }
  }
  const hasVenv = await tryShellExec(ctx.agent, 'test -d ".venv" || test -d "venv" || test -d "env" && echo "y" || echo "n"');
  if (hasVenv.trim() !== 'y') {
    const hasPyproject = await tryShellExec(ctx.agent, 'test -f "pyproject.toml" || test -f "requirements.txt" && echo "y" || echo "n"');
    if (hasPyproject.trim() === 'y') {
      getLogger().info('TASK_EXECUTOR', 'Python venv not found — creating and installing deps');
      await tryShellExec(ctx.agent, 'python3 -m venv .venv 2>&1 && source .venv/bin/activate && pip install -r requirements.txt 2>&1 || true');
    }
  }
}

// ─── Build batches ───

export function buildBatches(plan: TaskPlan): TaskStep[][] {
  const batches: TaskStep[][] = [];
  let currentBatch: TaskStep[] = [];

  for (const step of plan.steps) {
    if (step.parallel) {
      currentBatch.push(step);
    } else {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
      }
      batches.push([step]);
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

// ─── Replan ───

export async function replan(
  ctx: PlanningContext,
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
