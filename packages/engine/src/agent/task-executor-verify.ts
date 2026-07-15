import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { TaskStep } from './TaskExecutor.js';
import { DEBUG_SYSTEM_PROMPT, VERIFY_SYSTEM_PROMPT, FINAL_VERIFY_SYSTEM_PROMPT, extractJsonObject, tryShellExec } from './task-executor-helpers.js';
import type { TaskPlan } from './TaskExecutor.js';

/**
 * Context required by the extracted verification & debugging functions.
 * Only includes the properties/methods actually used by these functions.
 */
export interface VerifyDebugContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  conventions: string[];
  ensureDependencies(): Promise<void>;
  checkRegressions(
    commands: Array<{ cmd: string; timeout: number }>,
    gitManager?: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> },
  ): Promise<string | null>;
}

export async function lintStepConventions(ctx: VerifyDebugContext, step: TaskStep, result: string): Promise<string> {
  if (ctx.conventions.length === 0) return result;

  // Check if the step mentions file modifications that could violate conventions
  const fileRefs = /\.(ts|js|tsx|jsx|py|rs|go|css|scss|json|md|html|vue|svelte)\b/i.test(result) ||
    /(created|modified|wrote|updated|added|generated)\s/i.test(result);
  if (!fileRefs) return result;

  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const lintResult = await generateText({
    model,
    system: `You are a code convention enforcer. Given project conventions and the step result, identify any convention violations.

Project conventions:
${ctx.conventions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return a JSON object:
{
  "violations": ["description of each violation"],
  "fixInstructions": "specific instructions to fix the violations"
}

If no violations, return { "violations": [] }.`,
    prompt: `Step: ${step.description}\n\nStep result:\n${result.slice(0, 3000)}`,
    temperature: 0.1,
    maxRetries: 1,
  });

  const lintParsed = extractJsonObject<{ violations: string[]; fixInstructions: string }>(lintResult.text);
  if (!lintParsed || !lintParsed.violations || lintParsed.violations.length === 0) return result;

  getLogger().warn('TASK_EXECUTOR', `Convention violations detected: ${lintParsed.violations.join('; ')}`);

  // Auto-fix via agent
  const fixPrompt = `Fix the following convention violations in the work done for step "${step.description}":\n\n${lintParsed.violations.map((v, i) => `${i + 1}. ${v}`).join('\n')}\n\nInstructions: ${lintParsed.fixInstructions}`;
  const fixResponse = await ctx.agent.sendMessage(fixPrompt);
  return `${result}\n\n[Convention fixes applied]\n${fixResponse.content}`;
}

export async function runDebugCycle(ctx: VerifyDebugContext, step: TaskStep, result: string, goal: string): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }> {
  // Detect if the step produced code that needs building/testing
  const hasCodeArtifacts = /\.(ts|js|tsx|jsx|py|rs|go|c|cpp|java|rb|php|swift|kt)\b/.test(result) ||
    /(created|modified|wrote|updated|added|generated)\s.*\.\w+/.test(result) ||
    /```[\w]*\n/.test(result);

  if (!hasCodeArtifacts) return { passed: true, lastOutput: result, fixCount: 0 };

  // Extract file names from step result for targeted test generation
  const mentionedFiles = extractFileNames(result);

  // Check for common build/test commands
  const testCommands = [
    { check: 'npm test', file: 'package.json', cmd: 'npm test 2>&1', timeout: 60000 },
    { check: 'pnpm test', file: 'package.json', cmd: 'pnpm test 2>&1', timeout: 60000 },
    { check: 'cargo test', file: 'Cargo.toml', cmd: 'cargo test 2>&1', timeout: 120000 },
    { check: 'go test', file: 'go.mod', cmd: 'go test ./... 2>&1', timeout: 120000 },
    { check: 'pytest', file: 'pyproject.toml', cmd: 'python -m pytest 2>&1', timeout: 60000 },
    { check: 'npm run build', file: 'package.json', cmd: 'npm run build 2>&1', timeout: 60000 },
    { check: 'pnpm build', file: 'package.json', cmd: 'pnpm build 2>&1', timeout: 60000 },
    { check: 'tsc', file: 'tsconfig.json', cmd: 'npx tsc --noEmit 2>&1', timeout: 60000 },
  ];

  const applicableCommands: Array<{ cmd: string; timeout: number }> = [];
  const fileExists = await Promise.all(
    testCommands.map((tc) => tryShellExec(ctx.agent, `test -f "${tc.file}" && echo "y" || echo "n"`)),
  );
  for (let ti = 0; ti < testCommands.length; ti++) {
    if (fileExists[ti]!.trim() === 'y') applicableCommands.push({ cmd: testCommands[ti]!.cmd, timeout: testCommands[ti]!.timeout });
  }

  // Phase 0: Auto-install dependencies if missing
  await ctx.ensureDependencies();

  // Phase 1: Run existing build/test commands
  let lastOutput = result;
  let fixCount = 0;

  if (applicableCommands.length > 0) {
    for (let fixAttempt = 0; fixAttempt < 3; fixAttempt++) {
      let allPassed = true;
      let allOutput = '';

      for (const ac of applicableCommands) {
        const output = await tryShellExec(ctx.agent, ac.cmd);
        allOutput += `\n[${ac.cmd}]\n${output}`;
        if (output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('not ok')) {
          allPassed = false;
        }
      }

      if (allPassed) {
        fixCount = fixAttempt;
        lastOutput = allOutput;
        // Regression check: run full test suite to catch regressions
        const gitManager = ctx.agent['gitManager'] as { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined;
        const regressionResult = await ctx.checkRegressions(applicableCommands, gitManager);
        if (regressionResult) {
          lastOutput += `\n[Regression suite] ${regressionResult}`;
        }
        break;
      }

      // Build/test failed — analyze and fix
      if (fixAttempt < 2) {
        getLogger().info('TASK_EXECUTOR', `Debug attempt ${fixAttempt + 1}: analyzing build failure`);
        const model = createAiSdkModel(ctx.config, ctx.apiKey);
        const debugResult = await generateText({
          model,
          system: DEBUG_SYSTEM_PROMPT,
          prompt: `Goal: ${goal}\nStep: ${step.description}\n\nBuild/test output:\n${allOutput.slice(0, 4000)}\n\nAnalyze the failure and fix it.`,
          temperature: 0.3,
          maxRetries: 1,
        });

        const fixPrompt = `The following build/test failed for step "${step.description}":\n\n${allOutput.slice(0, 3000)}\n\nFix the issues. The debug analysis says:\n\n${debugResult.text.slice(0, 1000)}`;
        lastOutput = (await ctx.agent.sendMessage(fixPrompt)).content;
        fixCount = fixAttempt + 1;
      }
    }

    // If existing tests still fail after all attempts, report failure
    if (fixCount >= 3) {
      const allOutput = await Promise.all(applicableCommands.map(ac => tryShellExec(ctx.agent, ac.cmd)));
      return {
        passed: false,
        error: `Build/test still failing after 3 fix attempts. Last output: ${allOutput.join('\n').slice(0, 500)}`,
        lastOutput,
        fixCount: 3,
      };
    }
  }

  // Phase 2: Generate and run tests for new/modified files (if none exist yet)
  if (mentionedFiles.length > 0 && applicableCommands.length === 0) {
    getLogger().info('TASK_EXECUTOR', `No existing test suite found — generating tests for ${mentionedFiles.length} file(s)`);
    const testGenResult = await generateAndRunTests(ctx, mentionedFiles, step, goal);
    if (!testGenResult.passed) {
      getLogger().warn('TASK_EXECUTOR', `Generated tests failed: ${testGenResult.error?.slice(0, 200)}`);
      return testGenResult;
    }
    lastOutput = testGenResult.lastOutput;
    fixCount += testGenResult.fixCount;
  }

  return { passed: true, lastOutput, fixCount };
}

export function extractFileNames(result: string): string[] {
  const files: string[] = [];
  const fileRe = /(?:created|modified|wrote|updated|added|generated)\s+["']?([\w./-]+\.(?:ts|js|tsx|jsx|py|rs|go|c|cpp|java|rb|php|swift|kt))["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(result)) !== null) {
    if (m[1] && !files.includes(m[1])) files.push(m[1]);
  }
  return files.slice(0, 10);
}

export async function generateAndRunTests(
  ctx: VerifyDebugContext,
  files: string[], step: TaskStep, goal: string,
): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  let lastOutput = '';
  let fixCount = 0;

  for (const file of files) {
    // Read the source file to generate relevant tests
    const sourceContent = await tryShellExec(ctx.agent, `cat "${file}" 2>/dev/null || echo ""`);
    if (!sourceContent.trim()) continue;

    const testFilePath = inferTestPath(file);

    const genResult = await generateText({
      model,
      system: `You are a test generation expert. Given a source file, generate a test file for it.
Use the appropriate test framework for the language (Jest/Vitest for TS/JS, pytest for Python, Go test, etc.).
Return ONLY the test file content. No markdown, no explanation.`,
      prompt: `Source file: ${file}\n\nSource content:\n${sourceContent.slice(0, 4000)}\n\nGoal context: ${goal}\nStep: ${step.description}\n\nGenerate a comprehensive test file at path: ${testFilePath}`,
      temperature: 0.2,
      maxRetries: 1,
    });

    if (!genResult.text.trim()) continue;

    // Write the test file
    const writeResult = await tryShellExec(ctx.agent, `cat > "${testFilePath}" << 'TESTEOF'\n${genResult.text}\nTESTEOF`);
    if (writeResult.includes('error')) {
      // Fallback: write via node
      await tryShellExec(ctx.agent, `node -e "require('fs').writeFileSync('${testFilePath.replace(/'/g, "\\'")}', ${JSON.stringify(genResult.text)})"`);
    }

    lastOutput += `\n[Test generated] ${testFilePath}`;

    // Try to run the generated test
    const testRunner = inferTestRunner(file);
    if (testRunner) {
      const testOutput = await tryShellExec(ctx.agent, `${testRunner} 2>&1`);
      lastOutput += `\n${testOutput.slice(0, 1000)}`;

      if (testOutput.toLowerCase().includes('error') || testOutput.toLowerCase().includes('fail')) {
        // One fix attempt for generated tests
        if (fixCount < 1) {
          const fixResult = await generateText({
            model,
            system: 'Fix the test file. Return ONLY the corrected file content.',
            prompt: `Test file ${testFilePath} has failures:\n\n${testOutput.slice(0, 2000)}\n\nFix the test file.`,
            temperature: 0.2,
            maxRetries: 1,
          });
          if (fixResult.text.trim()) {
            await tryShellExec(ctx.agent, `node -e "require('fs').writeFileSync('${testFilePath.replace(/'/g, "\\'")}', ${JSON.stringify(fixResult.text)})"`);
            const retryOutput = await tryShellExec(ctx.agent, `${testRunner} 2>&1`);
            lastOutput += `\n[Retry] ${retryOutput.slice(0, 500)}`;
            fixCount++;
          }
        }
      }
    }
  }

  return { passed: true, lastOutput, fixCount };
}

export function inferTestPath(file: string): string {
  const base = file.replace(/\.\w+$/, '');
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return `${base}.test.ts`;
  if (file.endsWith('.js') || file.endsWith('.jsx')) return `${base}.test.js`;
  if (file.endsWith('.py')) return `test_${base.replace(/.*\//, '')}.py`;
  if (file.endsWith('.rs')) return `${base}_test.rs`;
  if (file.endsWith('.go')) return `${base}_test.go`;
  return `${base}_test${file.match(/\.\w+$/)?.[0] || '.test'}`;
}

export function inferTestRunner(file: string): string | null {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'npx vitest run 2>&1 || npx jest 2>&1';
  if (file.endsWith('.js') || file.endsWith('.jsx')) return 'npx jest 2>&1';
  if (file.endsWith('.py')) return 'python -m pytest 2>&1';
  if (file.endsWith('.rs')) return 'cargo test 2>&1';
  if (file.endsWith('.go')) return 'go test ./... 2>&1';
  return null;
}

// ─── Step verification ───

export interface VerifyContext {
  config: AgentXConfig;
  apiKey?: string;
  agent: Agent;
}

export async function verifyStep(
  ctx: VerifyContext,
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

// ─── Goal verification ───

export async function verifyGoal(
  ctx: VerifyContext,
  goal: string,
  plan: TaskPlan,
): Promise<{ achieved: boolean; reason: string; gaps?: string[] }> {
  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const stepsSummary = plan.steps.map((s, i) =>
    `${i + 1}. ${s.description} — ${s.status}${s.result ? ': ' + s.result.slice(0, 200) : ''}`
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

// ─── Fact verification (hallucination guardrail) ───

export async function verifyFacts(
  ctx: VerifyContext,
  step: TaskStep,
  result: string,
): Promise<{ passed: boolean; warnings: string[] }> {
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

  // Cross-reference with step result claims
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
