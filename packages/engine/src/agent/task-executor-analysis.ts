/**
 * Project analysis, runtime management, context management, and memory
 * helpers extracted from TaskExecutor.ts (REFACTOR-4).
 */
import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig, SessionEvent } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { TaskPlan, TaskStep, FailureRecord } from './TaskExecutor.js';
import { tryShellExec, extractJsonObject, extractJsonArray, ANALYSIS_SYSTEM_PROMPT } from './task-executor-helpers.js';

/** Slice of TaskExecutor required by the analysis helpers. */
export interface AnalysisContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  sessionId: string;
  /** Mutable step success count. */
  stepSuccesses: number;
  /** Mutable step failure count. */
  stepFailures: number;
  /** Mutable dynamic max replans. */
  dynamicMaxReplans: number;
  /** Original model id (for failover restore). */
  originalModel: string;
  /** Set of already-tried fallback models. */
  usedFallbackModels: Set<string>;
  /** Mutable chunk counter. */
  chunkCounter: number;
  /** Optional snapshot store. */
  store?: { saveTaskSnapshot: (s: unknown) => void; getTaskSnapshot: (sessionId: string) => Record<string, unknown> | null; deleteTaskSnapshot: (sessionId: string) => void };
  /** Persist state callback. */
  persistState: (plan: TaskPlan, failureHistory: unknown[]) => void;
  /** Emit event callback. */
  emitEvent: (event: Record<string, unknown>) => void;
  /** Emit session event callback. */
  emitSessionEvent: (event: Omit<SessionEvent, 'sessionId' | 'sequence' | 'timestamp'>) => void;
}

// ─── Project analysis ───

export async function analyzeProject(
  ctx: AnalysisContext,
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

// ─── Runtime management ───

export async function ensureRuntimes(
  ctx: AnalysisContext,
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

async function installRuntime(
  ctx: AnalysisContext,
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

export async function ensureDependencies(ctx: AnalysisContext): Promise<void> {
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

// ─── Self-tuning ───

export function selfTune(ctx: AnalysisContext, maxReplans: number): void {
  const total = ctx.stepSuccesses + ctx.stepFailures;
  if (total < 3) return;

  const failRate = ctx.stepFailures / total;
  if (failRate > 0.5 && ctx.dynamicMaxReplans < 6) {
    ctx.dynamicMaxReplans = Math.min(6, ctx.dynamicMaxReplans + 1);
    getLogger().info('TASK_EXECUTOR', `Self-tuned: increased max replans to ${ctx.dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
  } else if (failRate < 0.15 && ctx.dynamicMaxReplans > maxReplans) {
    ctx.dynamicMaxReplans = Math.max(maxReplans, ctx.dynamicMaxReplans - 1);
    getLogger().info('TASK_EXECUTOR', `Self-tuned: decreased max replans to ${ctx.dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
  }
}

// ─── Subtask suggestion ───

export async function suggestNewSubtasks(
  ctx: AnalysisContext,
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

// ─── Context management ───

export async function checkContext(ctx: AnalysisContext, plan: TaskPlan): Promise<void> {
  const messages = ctx.agent['messages'] as Array<{ role?: string }> | undefined;
  if (!messages) return;

  ctx.chunkCounter = plan.steps.filter(s => s.status === 'completed').length;
  if (ctx.chunkCounter > 0 && ctx.chunkCounter % 15 === 0) {
    getLogger().info('TASK_EXECUTOR', `Session chunking at ${ctx.chunkCounter} completed steps — persisting checkpoint`);
    if (ctx.store?.saveTaskSnapshot) {
      ctx.persistState(plan, []);
    }
  }

  if (messages.length > 40 || (ctx.agent as unknown as { compactContext?: () => Promise<void> })['compactContext']) {
    const compactContext = (ctx.agent as unknown as { compactContext?: () => Promise<void> })['compactContext'];
    if (compactContext && typeof compactContext === 'function') {
      try {
        await compactContext.call(ctx.agent);
        getLogger().info('TASK_EXECUTOR', 'Adaptive context compaction triggered');
      } catch {
        // Best-effort
      }
    }

    if (messages.length > 80) {
      const systemMsgs = messages.filter((m) => m.role === 'system');
      const recentMsgs = messages.filter((m) => m.role !== 'system').slice(-20);
      (ctx.agent as { messages: unknown[] })['messages'] = [...systemMsgs, ...recentMsgs];
      getLogger().info('TASK_EXECUTOR', `Force-pruned messages to ${systemMsgs.length + recentMsgs.length}`);
    }
  }

  // Restore original model if we were on a fallback and the error is far enough back
  if (ctx.usedFallbackModels.size > 0 && ctx.config.provider.activeModel !== ctx.originalModel) {
    const lastFailIndex = plan.steps.findLastIndex(s => s.status === 'failed');
    const lastSuccessIndex = plan.steps.findLastIndex(s => s.status === 'completed');
    if (lastSuccessIndex > (lastFailIndex ?? -1) + 2) {
      getLogger().info('TASK_EXECUTOR', `Restoring original model: ${ctx.originalModel}`);
      const agent = ctx.agent as { switchModel?: (model: string) => void };
      if (typeof agent.switchModel === 'function') {
        agent.switchModel(ctx.originalModel);
        ctx.config.provider.activeModel = ctx.originalModel;
      }
    }
  }
}

// ─── Memory persistence ───

export async function saveTaskMemory(ctx: AnalysisContext, plan: TaskPlan): Promise<void> {
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  if (completedSteps === 0) return;

  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const memoryResult = await generateText({
    model,
    system: `Extract learnings from this completed task. Return JSON:
{
  "projectType": "detected project type",
  "patterns": ["coding patterns used"],
  "painPoints": ["issues encountered"],
  "keyFiles": ["files created or modified"],
  "suggestions": ["what to do differently next time"]
}`,
    prompt: `Goal: ${plan.goal}\n\nSteps:\n${plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.description}`).join('\n')}\n\nExtract learnings.`,
    temperature: 0.2,
    maxRetries: 1,
  });

  try {
    const memoryDir = '.agentx';
    await tryShellExec(ctx.agent, `mkdir -p "${memoryDir}"`);
    const existing = await tryShellExec(ctx.agent, `cat "${memoryDir}/memories.json" 2>/dev/null || echo "[]"`);
    let memories: unknown[] = [];
    try { memories = JSON.parse(existing); } catch { memories = []; }
    memories.push(JSON.parse(memoryResult.text));
    if (memories.length > 20) memories = memories.slice(-20);
    await tryShellExec(ctx.agent, `node -e "require('fs').writeFileSync('${memoryDir}/memories.json', ${JSON.stringify(JSON.stringify(memories))})"`);
  } catch {
    // Best-effort
  }
}

// ─── Quality scoring ───

export function computeQualityScore(
  ctx: AnalysisContext,
  plan: TaskPlan,
  verification: { achieved: boolean; reason: string; gaps?: string[] },
): number {
  const totalSteps = plan.steps.length;
  if (totalSteps === 0) return 0;

  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const completionRatio = completed / totalSteps;

  const failureRatio = ctx.stepFailures / Math.max(1, ctx.stepSuccesses + ctx.stepFailures);
  const reliabilityScore = Math.max(0, 1 - failureRatio);

  const gapPenalty = (verification.gaps?.length || 0) * 10;
  const achievedBonus = verification.achieved ? 20 : 0;

  const baseScore = Math.round((completionRatio * 40) + (reliabilityScore * 40) + achievedBonus - gapPenalty);
  return Math.max(0, Math.min(100, baseScore));
}

// ─── Model failover ───

export async function tryModelFailover(ctx: AnalysisContext): Promise<boolean> {
  const agent = ctx.agent as {
    isModelGrounded?: (model: string) => boolean;
    trialModel?: (model: string) => Promise<boolean>;
    switchModel?: (model: string) => void;
  };

  const fallbackModels: string[] = [
    'gemini-2.0-flash',
    'claude-3-haiku-20240307',
    'gpt-4o-mini',
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'gemini-2.0-pro-exp',
  ];

  for (const fb of fallbackModels) {
    if (ctx.usedFallbackModels.has(fb)) continue;
    if (agent.isModelGrounded?.(fb)) {
      getLogger().info('TASK_EXECUTOR', `Skipping grounded fallback model: ${fb}`);
      continue;
    }
    ctx.usedFallbackModels.add(fb);

    try {
      getLogger().info('TASK_EXECUTOR', `Trying fallback model: ${fb}`);
      if (typeof agent.trialModel === 'function') {
        const available = await agent.trialModel(fb);
        if (!available) {
          getLogger().warn('TASK_EXECUTOR', `Fallback model ${fb} is not available`);
          continue;
        }
      }
      if (typeof agent.switchModel === 'function') {
        agent.switchModel(fb);
        ctx.config.provider.activeModel = fb;
        getLogger().info('TASK_EXECUTOR', `Switched to fallback model: ${fb}`);
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

// ─── Goal visual processing ───

export async function processGoalVisuals(ctx: AnalysisContext, goal: string): Promise<string | null> {
  const imageRefs: string[] = [];
  const imgRe = /["']?([\w./-]+\.(?:png|jpg|jpeg|gif|bmp|webp|svg|fig|sketch|xd|psd))["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(goal)) !== null) {
    if (m[1]) imageRefs.push(m[1]);
  }
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

// ─── Utility helpers ───

export function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function hasGhAvailable(ctx: AnalysisContext): Promise<boolean> {
  const result = await tryShellExec(ctx.agent, 'which gh 2>/dev/null && echo "found" || echo "notfound"');
  return result.trim().includes('found');
}

export function forceSaveState(ctx: AnalysisContext, goal: string): boolean {
  try {
    const snapshot = {
      taskId: ctx.sessionId,
      goal,
      planState: JSON.stringify({ steps: [], currentStepIndex: 0, goal }),
      stepIndex: 0,
      failureHistory: '[]',
      created_at: new Date().toISOString(),
    };
    ctx.store?.saveTaskSnapshot(snapshot);
    return true;
  } catch {
    return false;
  }
}

// ─── State persistence ───

export function persistState(
  ctx: AnalysisContext,
  plan: TaskPlan,
  failureHistory: FailureRecord[],
): void {
  if (!ctx.store) return;
  ctx.store.saveTaskSnapshot({
    sessionId: ctx.sessionId,
    taskId: plan.id,
    stepIndex: plan.currentStepIndex,
    goal: plan.goal,
    planState: JSON.stringify({
      id: plan.id,
      goal: plan.goal,
      steps: plan.steps,
      currentStepIndex: plan.currentStepIndex,
      createdAt: plan.createdAt,
      updatedAt: new Date().toISOString(),
    }),
    failureHistory: JSON.stringify(failureHistory),
  });
}

export function restoreState(
  stored: Record<string, unknown>,
): { plan: TaskPlan; failureHistory: FailureRecord[] } | null {
  try {
    const planState = JSON.parse(stored['plan_state'] as string);
    if (!planState || !planState.steps) return null;
    const plan: TaskPlan = {
      id: planState.id,
      goal: planState.goal,
      steps: planState.steps,
      currentStepIndex: planState.currentStepIndex || 0,
      createdAt: planState.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const failureHistory: FailureRecord[] = JSON.parse((stored['failure_history'] as string) || '[]');
    return { plan, failureHistory };
  } catch {
    return null;
  }
}

// ─── Progress emission ───

export function emitProgress(
  ctx: AnalysisContext,
  plan: TaskPlan,
  stepIndex: number,
  phase: string,
): void {
  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;
  ctx.emitEvent({ type: 'task_progress', phase, stepIndex, completed, total });
  ctx.emitSessionEvent({
    type: 'task_progress',
    payload: {
      taskId: plan.id,
      goal: plan.goal,
      phase,
      stepIndex,
      completedSteps: completed,
      totalSteps: total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
  });
}
