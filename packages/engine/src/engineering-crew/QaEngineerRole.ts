import { exec } from 'node:child_process';
import { getLogger } from '@agentx/shared';
import { CrewRole } from './CrewRole.js';
import type { EngineeringCrewMessage, TaskList, Task, TestDocument, RunResult, VerificationOutcome, CrewTopic } from './types.js';
import { broadcastMessage, MAX_PHASE_RETRIES, MAX_TEST_ROUNDS } from './types.js';
import { detectAdaptersForProject } from '../agent/ToolchainAdapters.js';
import { VerificationResultParser } from '../agent/VerificationResultParser.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';
import type { ProjectRepo } from './ProjectRepo.js';
import { TerminalManager } from '../tools/TerminalManager.js';

const FALLBACK_MARKERS = [
  /not\s+configured/i,
  /not\s+implemented/i,
  /is\s+a\s+stub/i,
  /placeholder/i,
  /fallback\s+response/i,
  /coming\s+soon/i,
  /todo:?\s*implement/i,
];

interface CommandRunResult { exitCode: number | null; output: string }

// #7: Async version — doesn't block the event loop during long build/test commands
export async function runCommandAsync(command: string, cwd: string, timeoutMs = 300_000): Promise<CommandRunResult> {
  if (isBlockedCommand(command)) {
    getLogger().warn('ENGINEERING_CREW', `Blocked dangerous QA command: ${command}`);
    return { exitCode: 1, output: `Command blocked by safety policy: ${command}` };
  }
  return new Promise((resolve) => {
    exec(command, { cwd, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as { code?: number; message?: string };
        resolve({
          exitCode: typeof e.code === 'number' ? e.code : 1,
          output: [stdout, stderr, e.message].filter(Boolean).join('\n').trim(),
        });
      } else {
        resolve({ exitCode: 0, output: (stdout ?? '').trim() });
      }
    });
  });
}

/** Reject commands that could destroy data or escape the project workspace. */
function isBlockedCommand(command: string): boolean {
  const dangerousPatterns = [
    /\brm\s+-[rf].*\b\/[\s;]/i,
    /\brm\s+-[rf].*\s+\//i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /[>|]\s*\/dev\/[sh]d[a-z]/i,
    /\bcurl\s+.*\s*\|\s*(ba)?sh/i,
    /\bwget\s+.*\s*\|\s*(ba)?sh/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bpoweroff\b/i,
  ];
  return dangerousPatterns.some((re) => re.test(command));
}

/** Only allow runtime endpoint checks against local servers. */
function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * QA Engineer role — mirrors MetaGPT's `QaEngineer`
 * (repos/metagpt/metagpt/roles/qa_engineer.py).
 *
 * Watches `code_summarized` (produced by Engineer) and implements the three-step QA action
 * sequence (mirrors MetaGPT's `QaEngineer._act` which dispatches on message type):
 *
 * 1. **WriteTest** — write test code for each changed source file.
 * 2. **RunCode** — run the tests and capture results.
 * 3. **DebugError** — if tests fail, attempt to debug and fix the test code.
 *
 * This loop runs up to `MAX_TEST_ROUNDS` times (mirrors MetaGPT's `test_round_allowed = 5`).
 * After the loop, deterministic verification (build/test commands, runtime checks) runs
 * against the acceptance criteria, and the result is published as `phase_verified` or
 * `phase_failed`.
 *
 * SOP pipeline step:
 *   ... → WriteCode → SummarizeCode → **WriteTest → RunCode → DebugError** → ...
 *
 * The QaEngineer is deny-listed from file-write/edit tools for the verification judgment
 * sub-agent (see `subagent-types.ts`) so it can only report — it structurally cannot "fix"
 * the code it's grading. The DebugError action writes to test files only, not source files.
 */
export class QaEngineerRole extends CrewRole {
  readonly name = 'QaEngineer';
  protected readonly watchedTopics: Set<CrewTopic> = new Set(['code_summarized', 'phase_failed']);

  private testRound = 0;

  constructor(
    private readonly spawner: SubAgentSpawner,
    private readonly cwd: string,
    private readonly repo?: ProjectRepo,
  ) {
    super();
  }

  protected async act(messages: EngineeringCrewMessage[]): Promise<void> {
    const latest = messages[messages.length - 1]!;
    const taskList = latest.artifact as TaskList | undefined;
    if (!taskList) return;

    const toVerify = taskList.tasks.filter((t) => t.status === 'in_progress' && t.codeDocument);
    if (toVerify.length === 0) return;

    // Run WriteTest → RunCode → DebugError for each task in parallel
    await Promise.all(toVerify.map((task) => this.verifyTask(task, taskList)));
  }

  private async verifyTask(task: Task, taskList: TaskList): Promise<void> {
    getLogger().info('ENGINEERING_CREW', `QaEngineer verifying task "${task.title}" (${task.id})`);

    // ─── WriteTest → RunCode → DebugError loop (mirrors QaEngineer._act) ───
    this.testRound = 0;
    while (this.testRound < MAX_TEST_ROUNDS) {
      // WriteTest
      const testDoc = await this.writeTest(task);
      task.testDocument = testDoc;
      if (this.repo) {
        await this.repo.saveTest(testDoc.filename, testDoc.content).catch(() => {});
      }

      // RunCode
      const runResult = await this.runCode(task);
      task.runResult = runResult;

      if (runResult.passed) {
        break;
      }

      // DebugError
      this.testRound++;
      if (this.testRound < MAX_TEST_ROUNDS) {
        getLogger().info('ENGINEERING_CREW', `QaEngineer debugging test failure for "${task.title}" (round ${this.testRound})`);
        const debugged = await this.debugError(task, runResult);
        if (debugged) {
          task.testDocument = debugged;
          if (this.repo) {
            await this.repo.saveTest(debugged.filename, debugged.content).catch(() => {});
          }
          // Re-run
          const rerunResult = await this.runCode(task);
          task.runResult = rerunResult;
          if (rerunResult.passed) break;
        }
      }
    }

    // ─── Deterministic verification (build/test commands, runtime checks) ───
    const outcomes: VerificationOutcome[] = [];
    const infraOutcomes = await this.runBuildAndTest(task);
    outcomes.push(...infraOutcomes);
    const runtimeOutcomes = await this.runRuntimeChecks(task);
    outcomes.push(...runtimeOutcomes);

    const coveredCriteria = new Set(runtimeOutcomes.map((o) => o.criterion));
    const remaining = task.acceptanceCriteria.filter((c) => !coveredCriteria.has(c));

    for (const criterion of remaining) {
      if (this.isBuildOrTestCriterion(criterion)) {
        const infraPassed = infraOutcomes.every((o) => o.passed);
        outcomes.push({
          criterion,
          passed: infraPassed,
          detail: infraPassed ? 'Build/test passed' : 'Build/test failed',
        });
        continue;
      }
      // LLM judgment for semantic criteria
      const judgment = await this.runJudgmentCheck(task, criterion);
      outcomes.push(judgment);
    }

    task.verification = outcomes;
    const allPassed = outcomes.length > 0 && outcomes.every((o) => o.passed);

    if (allPassed) {
      task.status = 'verified';
      this.publish(broadcastMessage('phase_verified', this.name, `Task "${task.title}" verified.`, taskList));
      return;
    }

    task.status = 'failed';
    task.retryCount = (task.retryCount ?? 0) + 1;
    const failureSummary = outcomes.filter((o) => !o.passed).map((o) => `- ${o.criterion}: ${o.detail}`).join('\n');

    if (task.retryCount > MAX_PHASE_RETRIES) {
      this.publish(broadcastMessage(
        'unknown_escalated',
        this.name,
        `Task "${task.title}" failed verification ${task.retryCount} times and needs human input:\n${failureSummary}`,
        taskList,
      ));
      return;
    }

    // ─── Root-cause analysis: research the failure and propose a specific fix ───
    // This is the critical proactiveness fix. Instead of just saying "phase failed",
    // the QaEngineer analyzes the error logs, researches the root cause, and sends
    // the Engineer a detailed fix proposal. This prevents the loop where the Engineer
    // just re-implements the same broken code.
    const failedOutcomes = outcomes.filter((o) => !o.passed);
    const hasRuntimeErrors = failedOutcomes.some((o) => o.output && o.output.length > 50);
    if (hasRuntimeErrors) {
      const rootCause = await this.analyzeRootCause(task, failedOutcomes);
      if (rootCause) {
        task.implementationNotes = `ROOT CAUSE ANALYSIS from QA (round ${task.retryCount}):\n${rootCause}`;
        this.publish(broadcastMessage(
          'phase_failed',
          this.name,
          `Task "${task.title}" failed verification:\n${failureSummary}\n\nRoot cause analysis:\n${rootCause}`,
          taskList,
        ));
        return;
      }
    }

    this.publish(broadcastMessage('phase_failed', this.name, `Task "${task.title}" failed verification:\n${failureSummary}`, taskList));
  }

  /**
   * Root-cause analysis — uses the LLM to analyze verification failures (especially
   * runtime errors with server logs) and produce a specific, actionable fix proposal.
   *
   * This is what was missing in the b2f6 session: the agent saw
   * "DYNAMIC_UPDATE_SLICE ... Failed to allocate tensors" but said "this is a known
   * model issue, can't be fixed" instead of researching that maxNumTokens=1536 is
   * required for Gemma-4's sliding window.
   *
   * The analysis is attached to the task's implementationNotes so the Engineer can
   * see exactly what to change when it picks up the phase_failed message.
   */
  private async analyzeRootCause(task: Task, failedOutcomes: VerificationOutcome[]): Promise<string | null> {
    const errorDetails = failedOutcomes
      .filter((o) => o.output && o.output.length > 0)
      .map((o) => `Criterion: ${o.criterion}\nError: ${o.detail}\nLogs:\n${(o.output ?? '').slice(0, 3000)}`)
      .join('\n---\n');

    if (!errorDetails) return null;

    const instruction = `You are a senior QA Engineer performing root-cause analysis on a verification failure. The Engineering Crew's build/test/runtime verification has failed. Your job is to:

1. Analyze the error logs and identify the SPECIFIC root cause (not just "it failed").
2. Research what the error means — many runtime errors have known fixes (e.g. wrong config values, missing dependencies, incorrect API usage).
3. Propose a SPECIFIC, ACTIONABLE fix that the Engineer can implement. Include exact file paths, line numbers, config changes, or API corrections.

Task: "${task.title}"
Code file: ${task.codeDocument?.filename ?? 'unknown'}

Verification failures:
"""
${errorDetails}
"""

Current code (if available):
"""
${task.codeDocument?.content.slice(0, 4000) ?? '(not available)'}
"""

Respond in this format:
ROOT CAUSE: <one paragraph explaining the specific root cause>
FIX: <specific, actionable steps to fix it — file paths, config values, API changes, etc.>
EVIDENCE: <why this fix will work — cite the error message, documentation, or API signature>`;

    try {
      const result = await this.spawner.spawnAndWait(instruction, ['file_read', 'web_search', 'shell_exec', 'terminal_start', 'terminal_read', 'terminal_kill', 'log_tail'], 'qa_engineer', 300_000);
      const text = result.output.trim();
      if (text && text.length > 20) {
        getLogger().info('ENGINEERING_CREW', `QaEngineer root-cause analysis for "${task.title}":\n${text.slice(0, 500)}`);
        return text;
      }
    } catch (e) {
      getLogger().warn('ENGINEERING_CREW', `Root-cause analysis failed: ${(e as Error).message}`);
    }
    return null;
  }

  // ─── WriteTest action (mirrors QaEngineer._write_test) ───
  private async writeTest(task: Task): Promise<TestDocument> {
    if (!task.codeDocument) {
      return { filename: `test_${task.id}.js`, content: '// no code to test', language: 'javascript', codeFilename: task.filename ?? task.id };
    }
    getLogger().info('ENGINEERING_CREW', `QaEngineer writing test for "${task.filename ?? task.id}"`);

    const instruction = `You are the QA Engineer on a software engineering team. Write a test for the following code.

Task: "${task.title}"
Acceptance criteria:
${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

Code to test (file: ${task.codeDocument.filename}):
"""
${task.codeDocument.content.slice(0, 4000)}
"""

Write a test file that verifies the acceptance criteria. The test should:
- Be in the same language as the code
- Use the project's existing test framework (or a standard one if none detected)
- Actually test the behavior described in the acceptance criteria — not just "it compiles" or "it runs"
- Include EDGE CASE tests: empty input, invalid input, boundary conditions, error paths
- Be runnable with a standard command (e.g. npm test, pytest, go test, mvn test)
- For API endpoints, test with actual HTTP requests (not just function calls) if possible

After writing the test, use shell_exec to RUN it and confirm it passes. If it fails, fix the test and re-run.

Output only the test file content, nothing else.`;

    const result = await this.spawner.spawnAndWait(instruction, ['file_read', 'file_write', 'file_edit', 'shell_exec', 'terminal_start', 'terminal_read', 'terminal_kill', 'web_search'], 'qa_engineer', 300_000);
    // #8: Language-aware test filename generation
    const testFilename = generateTestFilename(task.codeDocument.filename, task.codeDocument.language);
    return {
      filename: testFilename,
      content: result.output,
      language: task.codeDocument.language,
      codeFilename: task.codeDocument.filename,
    };
  }

  // ─── RunCode action (mirrors QaEngineer._run_code) ───
  private async runCode(task: Task): Promise<RunResult> {
    if (!task.testDocument || !task.codeDocument) {
      return { testFilename: '', codeFilename: '', output: 'no test or code file', exitCode: 1, passed: false, summary: 'missing files' };
    }

    // Try to run the test using detected toolchain
    const commands = this.resolveTestCommand(task);
    if (commands.length === 0) {
      // Fallback: use build/test from adapter detection
      const buildOutcomes = await this.runBuildAndTest(task);
      const passed = buildOutcomes.every((o) => o.passed);
      return {
        testFilename: task.testDocument.filename,
        codeFilename: task.codeDocument.filename,
        output: buildOutcomes.map((o) => o.detail).join('\n'),
        exitCode: passed ? 0 : 1,
        passed,
        summary: passed ? 'tests passed' : 'tests failed',
      };
    }

    let lastResult: { exitCode: number | null; output: string } | null = null;
    for (const command of commands) {
      const result = await runCommandAsync(command, this.cwd);
      lastResult = result;
      if (result.exitCode === 0) {
        return {
          testFilename: task.testDocument.filename,
          codeFilename: task.codeDocument.filename,
          output: result.output,
          exitCode: result.exitCode,
          passed: true,
          summary: 'tests passed',
        };
      }
    }

    // All commands failed — return the result of the last attempted command
    return {
      testFilename: task.testDocument.filename,
      codeFilename: task.codeDocument.filename,
      output: lastResult?.output ?? 'no test command ran',
      exitCode: lastResult?.exitCode ?? null,
      passed: false,
      summary: lastResult?.exitCode != null ? `tests failed (exit ${lastResult.exitCode})` : 'tests failed',
    };
  }

  // ─── DebugError action (mirrors QaEngineer._debug_error) ───
  private async debugError(task: Task, runResult: RunResult): Promise<TestDocument | null> {
    if (!task.testDocument) return null;

    const instruction = `You are the QA Engineer debugging a test failure.

Test file: ${task.testDocument.filename}
Test content:
"""
${task.testDocument.content.slice(0, 3000)}
"""

Test output:
"""
${runResult.output.slice(0, 2000)}
"""

Fix the test so it passes. Output only the corrected test file content, nothing else.
If the test is correct and the issue is in the source code, say "SOURCE_BUG" and explain what needs to change.`;

    const result = await this.spawner.spawnAndWait(instruction, ['file_read'], 'qa_engineer', 300_000);

    if (result.output.startsWith('SOURCE_BUG')) {
      getLogger().info('ENGINEERING_CREW', `QaEngineer detected source bug in "${task.title}" — sending back to Engineer with details`);
      // #11: Extract the source bug explanation and attach it to the task's implementationNotes
      // so the Engineer can see what needs to change when it picks up the phase_failed message.
      const bugExplanation = result.output.slice(0, 2000);
      task.implementationNotes = `SOURCE_BUG detected by QA:\n${bugExplanation}`;
      return null;
    }

    return {
      ...task.testDocument,
      content: result.output,
    };
  }

  // ─── Deterministic verification helpers (from existing VerifierRole) ───
  private async runBuildAndTest(task: Task): Promise<VerificationOutcome[]> {
    const outcomes: VerificationOutcome[] = [];
    const parser = new VerificationResultParser();
    const commands = this.resolveCommands(task);

    if (!commands.build && !commands.test) {
      outcomes.push({
        criterion: 'Build/test verification',
        passed: false,
        detail: 'No build/test command available — no explicit command in the task and no known ToolchainAdapter detected for this project.',
      });
      return outcomes;
    }

    const commandOrder = ['build', 'test'] as const;
    for (const label of commandOrder) {
      const command = commands[label];
      if (!command) continue;
      const { exitCode, output } = await runCommandAsync(command, this.cwd);
      const result = parser.parse('shell_exec', output, { command }, exitCode ?? undefined);
      const success = result.success;
      outcomes.push({
        criterion: `${label} passes`,
        passed: success,
        detail: result.errorSummary ?? (success ? 'passed' : 'failed'),
        command,
        exitCode: exitCode ?? undefined,
        output: output.slice(0, 1000),
      });
      // If build fails, don't run tests — they won't be meaningful
      if (!success && label === 'build') break;
    }
    return outcomes;
  }

  private async runRuntimeChecks(task: Task): Promise<VerificationOutcome[]> {
    const outcomes: VerificationOutcome[] = [];

    // #9: If any acceptance criterion references an HTTP endpoint, try to start the
    // application server first. The server is started in a persistent terminal so
    // we can READ the logs back for debugging. This handles the common "build an
    // app with endpoint X" pattern.
    const hasEndpointCriteria = task.acceptanceCriteria.some((c) =>
      /(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/|\/)/i.test(c),
    );
    let serverHandle: { kill: () => void; terminalId: string; readLogs: () => string } | null = null;
    if (hasEndpointCriteria) {
      serverHandle = await this.tryStartServer(task);
    }

    try {
      for (const criterion of task.acceptanceCriteria) {
        const urlMatch = criterion.match(/(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/[^\s]+)/i);
        if (!urlMatch) continue;
        const method = urlMatch[1]!.toUpperCase();
        const url = urlMatch[2]!;
        if (!isLocalUrl(url)) {
          outcomes.push({
            criterion,
            passed: false,
            detail: 'External endpoint checks are not allowed for safety; only 127.0.0.1 or localhost are permitted.',
          });
          continue;
        }
        try {
          const response = await fetch(url, { method, signal: AbortSignal.timeout(15_000) });
          const text = await response.text();
          const isFallback = FALLBACK_MARKERS.some((re) => re.test(text));
          outcomes.push({
            criterion,
            passed: response.ok && !isFallback,
            detail: isFallback
              ? `Endpoint returned a fallback/stub response: "${text.slice(0, 200)}"`
              : `Endpoint returned ${response.status}: "${text.slice(0, 200)}"`,
            command: `${method} ${url}`,
            exitCode: response.status,
            output: text.slice(0, 500),
          });
        } catch (e) {
          // If we have server logs, include them in the error detail — this is
          // the critical diagnostic information that lets the Engineer fix the
          // root cause instead of guessing.
          const serverLogs = serverHandle?.readLogs() ?? '';
          const errorMsg = e instanceof Error ? e.message : String(e);
          outcomes.push({
            criterion,
            passed: false,
            detail: serverLogs
              ? `Endpoint not reachable: ${errorMsg}\n\nServer logs (last 200 lines):\n${serverLogs}`
              : `Endpoint not reachable: ${errorMsg}`,
            command: `${method} ${url}`,
            output: serverLogs.slice(0, 2000),
          });
        }
      }
    } finally {
      // Kill the server process after verification
      if (serverHandle) {
        try { serverHandle.kill(); } catch { /* best-effort */ }
      }
    }
    return outcomes;
  }

  /**
   * #9: Try to start the application server for runtime endpoint verification.
   * Uses TerminalManager so the crew can READ the server's stdout/stderr back —
   * this is the critical capability that was missing. Without reading logs, the
   * crew cannot diagnose startup failures, tensor allocation errors, port
   * conflicts, or any other runtime issue.
   *
   * Returns a handle with the terminal ID and a kill function.
   */
  private async tryStartServer(task: Task): Promise<{ kill: () => void; terminalId: string; readLogs: () => string } | null> {
    const adapters = detectAdaptersForProject(this.cwd);
    let startCommand: string | null = null;

    // Check for explicit run command in the task
    if (task.codeDocument?.filename) {
      // Look for run command hints in acceptance criteria
      for (const c of task.acceptanceCriteria) {
        const runMatch = c.match(/run\s+(?:with\s+)?[`"]?([^\s"`"]+)[`"]?/i);
        if (runMatch) {
          startCommand = runMatch[1]!;
          break;
        }
      }
    }

    // Detect from project type
    if (!startCommand) {
      for (const adapter of adapters) {
        switch (adapter.id) {
          case 'npm': startCommand = 'npm start'; break;
          case 'pnpm': startCommand = 'pnpm start'; break;
          case 'yarn': startCommand = 'yarn start'; break;
          case 'maven': startCommand = 'mvn -B spring-boot:run'; break;
          case 'gradle': startCommand = './gradlew bootRun'; break;
          case 'cargo': startCommand = 'cargo run'; break;
          case 'go': startCommand = 'go run .'; break;
          case 'pytest': startCommand = 'python -m uvicorn main:app --port 8000'; break;
        }
        if (startCommand) break;
      }
    }

    if (!startCommand) return null;

    // Find the URL we need to probe for readiness (first endpoint criterion)
    const targetUrl = this.extractEndpointUrl(task.acceptanceCriteria);

    // #7: Only start a server for local endpoint checks
    if (targetUrl && !isLocalUrl(targetUrl)) {
      getLogger().info('ENGINEERING_CREW', `Not starting server for non-local endpoint ${targetUrl}`);
      return null;
    }

    getLogger().info('ENGINEERING_CREW', `QaEngineer starting server in terminal: ${startCommand}`);
    const manager = TerminalManager.getInstance();
    const session = manager.start({
      command: startCommand,
      cwd: this.cwd,
      sessionId: `qa-engineer-${task.id}`,
      label: `Server: ${startCommand}`,
    });
    const terminalId = session.id;

    // Wait for the server to become ready by polling the target URL
    // AND reading terminal output for errors
    if (targetUrl) {
      const ready = await this.waitForServerReadyWithLogs(session, targetUrl, 30_000);
      if (!ready) {
        const logs = session.getTail(80);
        getLogger().warn('ENGINEERING_CREW', `Server did not become ready at ${targetUrl} within 30s. Terminal logs:\n${logs}`);
        manager.kill(terminalId);
        return null;
      }
    } else {
      // No target URL known; fall back to a short fixed wait
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return {
      kill: () => manager.kill(terminalId),
      terminalId,
      readLogs: () => session.getTail(200),
    };
  }

  /**
   * Wait for server readiness by polling the URL AND watching terminal logs
   * for fatal errors. If the terminal shows an error pattern (crash, exception,
   * port in use, tensor allocation failure, etc.), return false immediately
   * with the error context — don't waste the full timeout polling a dead server.
   */
  private async waitForServerReadyWithLogs(
    session: { isAlive: () => boolean; getTail: (n: number) => string },
    url: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!isLocalUrl(url)) return false;
    const deadline = Date.now() + timeoutMs;
    const interval = 500;
    const fatalErrorPatterns = [
      /Exception in thread/i,
      /Failed to start/i,
      /Web server failed to start/i,
      /Port \d+ was already in use/i,
      /APPLICATION FAILED TO START/i,
      /Failed to allocate tensors/i,
      /DYNAMIC_UPDATE_SLICE/i,
      /fatal error/i,
      /panic:/i,
      /Address already in use/i,
      /Cannot find module/i,
      /Module not found/i,
      /SyntaxError:/i,
      /ImportError:/i,
      /BUILD FAILURE/i,
      /COMPILATION ERROR/i,
    ];

    while (Date.now() < deadline) {
      // If the terminal process died, no point waiting
      if (!session.isAlive()) {
        return false;
      }

      // Check logs for fatal errors
      const logs = session.getTail(30);
      for (const pattern of fatalErrorPatterns) {
        if (pattern.test(logs)) {
          getLogger().warn('ENGINEERING_CREW', `Fatal error detected in server logs: ${pattern.source}`);
          return false;
        }
      }

      // Check if the server is responding
      try {
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2_000) });
        if (response.ok || response.status < 500) return true;
      } catch { /* not ready yet */ }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return false;
  }

  private extractEndpointUrl(criteria: string[]): string | null {
    for (const c of criteria) {
      const m = c.match(/(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/[^\s]+)/i);
      if (m) return m[2]!;
    }
    return null;
  }

  private async runJudgmentCheck(task: Task, criterion: string): Promise<VerificationOutcome> {
    const instruction = `You are an independent QA Engineer reviewing another engineer's work. You do NOT trust their self-report — check for yourself whether the criterion below is genuinely met in the current project at "${this.cwd}".

The Engineer's summary (for context only, do not take it at face value):
"""
${task.implementationNotes ?? '(none provided)'}
"""

Acceptance criterion to check: "${criterion}"

Answer strictly in this format, one line:
PASS: ${criterion} — <one-line evidence>
FAIL: ${criterion} — <one-line reason>`;

    const result = await this.spawner.spawnAndWait(instruction, [], 'verifier', 300_000);
    const text = result.output.trim();
    if (/^PASS/i.test(text)) {
      return { criterion, passed: true, detail: text.slice(0, 500) };
    }
    return { criterion, passed: false, detail: text.slice(0, 500) };
  }

  private isBuildOrTestCriterion(criterion: string): boolean {
    const lower = criterion.toLowerCase();
    return lower.includes('build') || lower.includes('test') || lower.includes('compile') || lower.includes('lint') || lower.includes('typecheck');
  }

  private resolveCommands(task: Task): { build?: string; test?: string } {
    if (task.codeDocument?.filename) {
      // Check for explicit commands in the task's expected commands
    }
    const adapters = detectAdaptersForProject(this.cwd);
    const defaultCommand: Record<string, { build?: string; test?: string }> = {
      npm: { build: 'npm run build', test: 'npm test' },
      pnpm: { build: 'pnpm run build', test: 'pnpm test' },
      yarn: { build: 'yarn build', test: 'yarn test' },
      maven: { build: 'mvn -B package -DskipTests', test: 'mvn -B test' },
      gradle: { build: './gradlew build -x test', test: './gradlew test' },
      cargo: { build: 'cargo build', test: 'cargo test' },
      go: { build: 'go build ./...', test: 'go test ./...' },
      pytest: { test: 'python -m pytest' },
    };
    for (const adapter of adapters) {
      const cmd = defaultCommand[adapter.id];
      if (cmd) return cmd;
    }
    return {};
  }

  private resolveTestCommand(_task: Task): string[] {
    const commands: string[] = [];
    const adapters = detectAdaptersForProject(this.cwd);
    for (const adapter of adapters) {
      switch (adapter.id) {
        case 'npm': commands.push('npm test'); break;
        case 'pnpm': commands.push('pnpm test'); break;
        case 'yarn': commands.push('yarn test'); break;
        case 'pytest': commands.push('python -m pytest'); break;
        case 'cargo': commands.push('cargo test'); break;
        case 'go': commands.push('go test ./...'); break;
        case 'maven': commands.push('mvn -B test'); break;
        case 'gradle': commands.push('./gradlew test'); break;
      }
    }
    return commands;
  }
}

// #8: Language-aware test filename generation — respects each ecosystem's conventions
export function generateTestFilename(codeFilename: string, language: string): string {
  const base = codeFilename.replace(/^src\//, '');
  const ext = codeFilename.split('.').pop()?.toLowerCase() ?? '';

  switch (language) {
    case 'java':
    case 'kotlin': {
      // Java/Kotlin: *Test.java in src/test/java/ (mirrors package structure)
      const name = base.replace(/\.\w+$/, '');
      return `src/test/java/${name}Test.${ext}`;
    }
    case 'python': {
      // Python: test_*.py in tests/
      const name = base.replace(/\.py$/, '').replace(/^src\//, '');
      return `tests/test_${name}.py`;
    }
    case 'go': {
      // Go: *_test.go in the same directory as the source file
      return codeFilename.replace(/\.go$/, '_test.go');
    }
    case 'rust': {
      // Rust: tests are inline (#[cfg(test)]) or in tests/ directory
      const name = base.replace(/\.rs$/, '').replace(/^src\//, '');
      return `tests/${name}_test.rs`;
    }
    case 'ruby': {
      // Ruby: *_spec.rb in spec/
      const name = base.replace(/\.rb$/, '').replace(/^src\//, '');
      return `spec/${name}_spec.rb`;
    }
    case 'php': {
      // PHP: *Test.php in tests/
      const name = base.replace(/\.php$/, '').replace(/^src\//, '');
      return `tests/${name}Test.php`;
    }
    case 'csharp': {
      // C#: *Tests.cs in Tests/ project
      const name = base.replace(/\.\w+$/, '');
      return `Tests/${name}Tests.cs`;
    }
    case 'swift': {
      // Swift: *Tests.swift in Tests/
      const name = base.replace(/\.swift$/, '');
      return `Tests/${name}Tests.swift`;
    }
    case 'typescript':
    case 'javascript':
    default: {
      // JS/TS: file.test.ext in tests/ (default convention)
      const name = base.replace(/\.([^.]+)$/, '.test.$1');
      return `tests/${name}`;
    }
  }
}
