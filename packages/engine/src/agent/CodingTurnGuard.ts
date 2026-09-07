import type { EngineEvent } from '@agentx/shared';
import type { ToolLedger } from './ToolLedger.js';
import type { CategoryResult } from '../prompt/CategoryDetector.js';
import type { TaskStateManager } from './TaskStateManager.js';
import { VerificationResultParser, type VerificationResult } from './VerificationResultParser.js';
import { isKnownVerificationCommand } from './ToolchainAdapters.js';

/**
 * Runtime enforcement for coding/development turns.
 *
 * Guards:
 * 1. Read-before-write: file_write is blocked unless file_read was called on the same path this turn.
 * 2. Verification gate: after file_write in a coding turn, the model must run build/test and it must PASS.
 * 3. Safety gate: git push, git reset --hard, rm -rf, and similar destructive ops require explicit approval.
 * 4. Build-fix loop: if verification fails, inject a fix-and-retry instruction (up to maxRetries).
 */
export class CodingTurnGuard {
  private ledger: ToolLedger;
  private emit: (event: EngineEvent) => void;
  private taskState: TaskStateManager | null;
  private verifier: VerificationResultParser;
  private filesWrittenThisTurn = new Set<string>();
  private verificationGateArmed = false;
  private verificationPassed = false;
  private lastVerificationResult: VerificationResult | null = null;
  private buildFixAttempts = 0;
  private readonly maxBuildFixRetries = 3;

  constructor(ledger: ToolLedger, emit: (event: EngineEvent) => void, taskState?: TaskStateManager) {
    this.ledger = ledger;
    this.emit = emit;
    this.taskState = taskState ?? null;
    this.verifier = new VerificationResultParser();
  }

  setTaskState(taskState: TaskStateManager): void {
    this.taskState = taskState;
  }

  resetForTurn(): void {
    this.filesWrittenThisTurn.clear();
    this.verificationGateArmed = false;
    this.verificationPassed = false;
    this.lastVerificationResult = null;
    this.buildFixAttempts = 0;
  }

  /**
   * Check if a tool call should be allowed. Returns null if allowed, or an error message to inject.
   */
  checkToolCall(
    toolId: string,
    args: Record<string, unknown>,
    category: CategoryResult | null,
  ): string | null {
    if (!category) return null;
    const isCodingTurn = category.primary === 'coding' || category.primary === 'edge';

    // ── Read-before-write guard ──
    if (toolId === 'file_write' && isCodingTurn) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path && !this.hasReadFile(path)) {
        this.emit({ type: 'read_before_write_blocked', filePath: path, reason: 'file_read not called on this path before file_write' });
        return `BLOCKED: You must call file_read on "${path}" before writing to it. Read the file first, then make your edit.`;
      }
    }

    // ── Safety gate for destructive operations ──
    if (isCodingTurn) {
      const blocked = this.checkDestructiveOp(toolId, args);
      if (blocked) {
        this.emit({ type: 'safety_gate_blocked', operation: blocked.operation, reason: blocked.reason });
        return blocked.message;
      }
    }

    return null;
  }

  /**
   * Called after a tool execution (success or failure). Arms the verification gate if
   * needed, and parses build/test output for real verification.
   *
   * Verification parsing runs regardless of the tool call's own `success` flag: a *failing*
   * build/test command (nonzero exit code) is exactly the case the gate exists to catch, and
   * previously being gated on `success === true` meant a failed `mvn test`/`npm test`/etc.
   * never updated `lastVerificationResult` at all, silently leaving stale (or no) verification
   * state in place instead of recording the failure and arming the build-fix loop.
   *
   * @param exitCode Process exit code when available (see `VerificationResultParser.parse`),
   *   used as the authoritative, language-agnostic pass/fail signal.
   */
  onToolExecuted(
    toolId: string,
    success: boolean,
    args: Record<string, unknown>,
    category: CategoryResult | null,
    exitCode?: number,
  ): void {
    if (!category) return;
    const isCodingTurn = category.primary === 'coding' || category.primary === 'edge';

    // Track file reads
    if (toolId === 'file_read' && success) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path) this.taskState?.recordFileRead(path);
    }

    // Track file writes — arm verification gate
    if (toolId === 'file_write' && success && isCodingTurn) {
      const path = typeof args?.path === 'string' ? args.path : 'unknown';
      this.filesWrittenThisTurn.add(path);
      this.verificationGateArmed = true;
      this.verificationPassed = false;
      this.taskState?.recordFileWrite(path);
      this.emit({ type: 'verification_gate_triggered', filePath: path, reason: 'file_write in coding turn — run build/test before finishing' });
    }

    // Real verification: parse build/test command output — run for both successful and
    // failed tool calls, since a failed build/test is the primary signal this gate must catch.
    if (isCodingTurn) {
      const result = this.verifier.parse(toolId, this.getLastToolOutput(toolId), args, exitCode);
      if (result.ran) {
        this.lastVerificationResult = result;
        if (result.errorType === 'test' || /\btest\b/i.test(result.command)) {
          this.taskState?.recordTest(result.success);
        } else {
          this.taskState?.recordBuild(result.success);
        }

        if (result.success) {
          this.verificationPassed = true;
          this.verificationGateArmed = false;
        } else {
          // Build/test failed — arm the build-fix loop
          this.verificationPassed = false;
          this.buildFixAttempts++;
          this.taskState?.recordError(result.errorSummary ?? 'Build/test failed');
        }
      }
    }

    this.taskState?.recordTool(toolId);
  }

  /**
   * Returns a system message to inject if the verification gate is armed and the model
   * hasn't run a successful build/test yet. Includes build-fix loop instructions.
   */
  getVerificationReminder(): string | null {
    if (!this.verificationGateArmed) return null;
    if (this.verificationPassed) return null;

    // Build-fix loop: if the last verification failed, inject fix instructions
    if (this.lastVerificationResult && !this.lastVerificationResult.success) {
      if (this.buildFixAttempts > this.maxBuildFixRetries) {
        return `[VERIFICATION GATE] Build/test has failed ${this.buildFixAttempts} times. Stop retrying. Summarize the errors for the user and ask how they would like to proceed.`;
      }
      const fixInstruction = this.verifier.formatFixInstruction(this.lastVerificationResult);
      if (fixInstruction) {
        return `${fixInstruction}\n\nAttempt ${this.buildFixAttempts} of ${this.maxBuildFixRetries}.`;
      }
    }

    // Default: haven't run any verification yet
    if (this.hasRunBuildOrTest()) return null;
    return '[VERIFICATION GATE] You have written files this turn but have not run a build, lint, or test command. Run the project build or test suite before declaring the task complete.';
  }

  /**
   * HARD GATE: Returns true if the turn must NOT be allowed to finish yet because
   * verification is required but hasn't passed. The caller must inject a forced
   * continuation message and re-run the model with tools.
   *
   * This is the structural enforcement that prevents the model from claiming
   * success without proof. Unlike getVerificationReminder (which is a nudge),
   * this gate BLOCKS the turn from ending.
   */
  mustBlockFinish(): boolean {
    if (!this.verificationGateArmed) return false;
    if (this.verificationPassed) return false;
    // Don't block if we've exceeded retry attempts — let the model report failure
    if (this.buildFixAttempts > this.maxBuildFixRetries) return false;
    return true;
  }

  /**
   * Returns the forced continuation message for the hard gate. This message
   * instructs the model to run specific verification commands before it can
   * finish. It includes endpoint testing instructions if the task involves
   * a server/API.
   */
  getForcedVerificationMessage(): string {
    const parts: string[] = [
      '[VERIFICATION REQUIRED — you cannot finish this turn yet]',
      'You wrote code but have NOT verified it works. You MUST do ALL of the following before finishing:',
      '',
      '1. Run the build command (e.g. shell_exec "npm run build" or "mvn -B compile"). If it fails, fix the errors and rebuild.',
      '2. Run the test command (e.g. shell_exec "npm test" or "mvn -B test"). If tests fail, fix them.',
    ];

    // Check if any tool call this turn involved a server/API keyword
    const ledgerEntries = this.ledger.getEntries();
    const hasEndpointTask = ledgerEntries.some((e) => {
      const text = `${e.command ?? ''} ${e.output ?? ''}`.toLowerCase();
      return /endpoint|api|server|http|port|spring|flask|express|fastapi|uvicorn|tomcat/.test(text);
    });

    if (hasEndpointTask) {
      parts.push(
        '3. Start the server using terminal_start (NOT shell_background — you need to read the output).',
        '4. Wait 3 seconds, then use terminal_read to check the server started successfully.',
        '5. If the server crashed, READ the logs with terminal_read, fix the error, rebuild, and restart.',
        '6. Send an actual HTTP request to the endpoint using shell_exec (e.g. shell_exec "curl -s http://localhost:PORT/api/endpoint").',
        '7. Verify the response is valid JSON (or expected format) and NOT a stub, placeholder, or error message.',
        '8. Kill the terminal with terminal_kill when done.',
      );
    } else {
      parts.push('3. If the task involves a running application, start it and test it end-to-end.');
    }

    parts.push(
      '',
      'Do NOT claim the task is complete, done, or working until you have done ALL of the above.',
      'Do NOT output a summary yet — call the verification tools first.',
      '"It compiles" is NOT proof. "The process started" is NOT proof. Only a successful build + test + runtime check is proof.',
    );

    if (this.lastVerificationResult && !this.lastVerificationResult.success) {
      parts.push(
        '',
        `The last verification attempt FAILED:\n${this.lastVerificationResult.errorSummary ?? 'Unknown error'}`,
        'Fix the error and re-run the verification.',
      );
    }

    return parts.join('\n');
  }

  private hasReadFile(path: string): boolean {
    const normalized = this.normalizePath(path);
    // Check tool ledger for this turn
    if (this.ledger.getEntries().some(
      (e) => e.name === 'file_read' && e.success && this.normalizePath(e.path ?? '') === normalized,
    )) return true;
    // Check task state for cross-turn reads
    return this.taskState?.hasReadFile(path) ?? false;
  }

  private hasRunBuildOrTest(): boolean {
    const buildTools = ['shell_exec', 'bash', 'run_command', 'execute', 'build', 'build_check', 'terminal_start', 'terminal_read'];
    // Any known toolchain's build/test/lint/typecheck command counts as "an attempt was made" —
    // whether it passed or failed is tracked separately via `lastVerificationResult`. A ledger
    // entry with `success: false` still counts here (it was still an attempt), which is what
    // lets a *failed* build correctly route to the build-fix-loop message below instead of the
    // generic "you haven't verified anything yet" reminder.
    // Also counts terminal_start/terminal_read as verification attempts (server debugging).
    // Also counts curl/http_request against localhost as endpoint verification.
    return this.ledger.getEntries().some((e) => {
      if (!buildTools.includes(e.name)) return false;
      // `build`/`build_check` always run a build/test/check for whatever toolchain they detect
      // (see `tools/builtin/build.ts`) even though they don't carry a raw shell command string —
      // treat them as an implicit verification attempt.
      if (e.name === 'build' || e.name === 'build_check') return true;
      // terminal_start/terminal_read count as verification (server debugging)
      if (e.name === 'terminal_start' || e.name === 'terminal_read') return true;
      // For shell_exec, check if it's a known verification command OR a curl/http request to localhost
      if (e.command) {
        if (isKnownVerificationCommand(e.command)) return true;
        // curl/http requests to localhost count as endpoint verification
        if (/curl\s+.*localhost|curl\s+.*127\.0\.0\.1|http_request.*localhost/i.test(e.command)) return true;
      }
      return false;
    });
  }

  private getLastToolOutput(toolId: string): string {
    const entries = this.ledger.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.name === toolId) return entries[i]!.output;
    }
    return '';
  }

  private checkDestructiveOp(toolId: string, args: Record<string, unknown>): { operation: string; reason: string; message: string } | null {
    const command = typeof args?.command === 'string' ? args.command : '';

    if (toolId === 'git_commit' || toolId === 'git_push') {
      if (/push|push\s+--force|push\s+-f/.test(command)) {
        return {
          operation: 'git push',
          reason: 'git push requires explicit user approval during coding turns',
          message: 'BLOCKED: Do not push to git without explicit user approval. Ask the user if they want to push.',
        };
      }
    }

    if (/\bgit\s+reset\s+--hard\b/.test(command)) {
      return {
        operation: 'git reset --hard',
        reason: 'git reset --hard is irreversible during coding turns',
        message: 'BLOCKED: git reset --hard is irreversible. Ask the user for explicit approval before running it.',
      };
    }

    if (/\brm\s+-rf\b/.test(command)) {
      return {
        operation: 'rm -rf',
        reason: 'rm -rf is destructive during coding turns',
        message: 'BLOCKED: rm -rf is destructive. Ask the user for explicit approval before running it.',
      };
    }

    return null;
  }

  private normalizePath(p: string): string {
    return p.replace(/\/+$/g, '').replace(/\\/g, '/').toLowerCase();
  }
}
