import { getLogger } from '@agentx/shared';
import { detectAdapterForCommand, isKnownVerificationCommand } from './ToolchainAdapters.js';

export interface VerificationResult {
  ran: boolean;
  success: boolean;
  command: string;
  output: string;
  errorType?: 'compile' | 'test' | 'lint' | 'typecheck' | 'runtime' | 'unknown';
  errorSummary?: string;
}

/**
 * Parses build/test/lint tool calls to determine whether verification actually passed —
 * not just that a command was run.
 *
 * Language-agnostic by design: toolchain recognition is delegated to the shared
 * `ToolchainAdapters` registry (see that file's header comment), and the **process exit
 * code is the primary pass/fail signal** for any command in any language — exit codes are
 * universal across every ecosystem, unlike free-text output banners. Text-pattern hints
 * (from the matched adapter, or the generic fallback patterns below) are only a secondary
 * heuristic for tools that don't reliably signal failure via exit code.
 */
export class VerificationResultParser {
  /** Generic fallback hints used when no specific adapter matched the command. */
  private static readonly GENERIC_SUCCESS_PATTERNS: RegExp[] = [
    /build\s+success/i,
    /compiled\s+successfully/i,
    /✓.*\bpassed\b/i,
    /all\s+tests\s+passed/i,
    /\b\d+\s+passing\b/i,
    /test\s+result:\s*ok\b/i,
    /no\s+issues?\s+found/i,
    /compilation\s+successful/i,
  ];

  private static readonly GENERIC_FAILURE_PATTERNS: RegExp[] = [
    /error:\s+/i,
    /\bFAILED\b/i,
    /\b\d+\s+failing\b/i,
    /\b\d+\s+failures?\b/i,
    /test\s+result:\s*fail/i,
    /compilation\s+failed/i,
    /build\s+failed/i,
    /cannot\s+find\s+module/i,
    /syntax\s+error/i,
    /unresolved\s+import/i,
    /command\s+not\s+found/i,
    /panic:/i,
    /traceback\b/i,
  ];

  /**
   * Analyze a tool call to determine if it was a verification command and whether it passed.
   *
   * @param exitCode Process exit code when available (e.g. from `shell_exec`'s
   *   `ToolResult.metadata.exitCode`). When provided, this is authoritative for pass/fail —
   *   text patterns are only consulted for `errorType`/`errorSummary` classification, or as a
   *   fallback when no exit code was captured.
   */
  parse(toolId: string, toolOutput: string, args?: Record<string, unknown>, exitCode?: number): VerificationResult {
    const command = this.extractCommand(toolId, args);
    if (!command) {
      return { ran: false, success: false, command: '', output: toolOutput };
    }

    if (!this.isVerificationCommand(command)) {
      return { ran: false, success: false, command, output: toolOutput };
    }

    const output = toolOutput;
    const adapter = detectAdapterForCommand(command);
    const successHints = adapter?.successHints ?? VerificationResultParser.GENERIC_SUCCESS_PATTERNS;
    const failureHints = adapter?.failureHints ?? VerificationResultParser.GENERIC_FAILURE_PATTERNS;
    const hasSuccessHint = successHints.some((p) => p.test(output));
    const hasFailureHint = failureHints.some((p) => p.test(output));

    let success: boolean;
    if (exitCode !== undefined) {
      // Exit code is authoritative and language-agnostic. A failure hint can still downgrade
      // an exit-0 result (some tools exit 0 on partial failure); a success hint can never
      // override a nonzero exit code.
      success = exitCode === 0 && !hasFailureHint;
    } else {
      // No exit code captured (older tool integrations, or tools invoked outside shell_exec) —
      // fall back to text heuristics only. Failure hints take precedence when both match.
      success = hasSuccessHint && !hasFailureHint;
    }

    const errorType = success ? undefined : this.classifyError(command, output);
    const errorSummary = success ? undefined : this.extractErrorSummary(output);

    getLogger().info(
      'VERIFICATION',
      `Command: ${command}, adapter: ${adapter?.id ?? 'generic'}, exitCode: ${exitCode ?? 'n/a'}, success: ${success}, errorType: ${errorType ?? 'none'}`,
    );

    return { ran: true, success, command, output, errorType, errorSummary };
  }

  private extractCommand(_toolId: string, args?: Record<string, unknown>): string {
    if (!args) return '';
    const cmd = typeof args['command'] === 'string' ? args['command']
      : typeof args['cmd'] === 'string' ? args['cmd']
      : '';
    return cmd;
  }

  private isVerificationCommand(command: string): boolean {
    return isKnownVerificationCommand(command);
  }

  private classifyError(command: string, output: string): VerificationResult['errorType'] {
    const adapter = detectAdapterForCommand(command);
    if (adapter?.id === 'eslint' || adapter?.id === 'mypy-ruff-flake8') return 'lint';
    if (/error\s+TS\d+/.test(output) || /\btsc\b/i.test(command)) return 'typecheck';
    if (/\btest\b/i.test(command) || /\bTests?\s+run\b/i.test(output)) return 'test';
    if (/\bbuild\b|\bcompile\b/i.test(command)) return 'compile';
    if (/panic:|traceback|exception/i.test(output)) return 'runtime';
    return 'unknown';
  }

  private extractErrorSummary(output: string): string {
    const lines = output.split('\n');
    const errorLines = lines.filter((l) =>
      /error|Error|ERROR|FAILED|failed|panic|traceback/i.test(l),
    );
    if (errorLines.length === 0) return output.slice(0, 300);
    return errorLines.slice(0, 5).join('\n').slice(0, 500);
  }

  /**
   * Generate a fix-and-retry instruction for the build-fix loop.
   */
  formatFixInstruction(result: VerificationResult): string {
    if (result.success) return '';
    const errorType = result.errorType ?? 'unknown';
    const summary = result.errorSummary ?? 'Unknown error';
    return `[BUILD FIX REQUIRED] The ${errorType} verification failed with:\n${summary}\nFix the error and re-run: ${result.command}`;
  }
}
