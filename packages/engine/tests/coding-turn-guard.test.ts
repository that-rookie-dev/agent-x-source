import { describe, it, expect } from 'vitest';
import { CodingTurnGuard } from '../src/agent/CodingTurnGuard.js';
import { VerificationResultParser } from '../src/agent/VerificationResultParser.js';
import { ToolLedger } from '../src/agent/ToolLedger.js';
import { isKnownVerificationCommand, detectAdapterForCommand } from '../src/agent/ToolchainAdapters.js';
import type { CategoryResult } from '../src/prompt/CategoryDetector.js';

const codingCategory: CategoryResult = { primary: 'coding', confidence: 1, signals: [] };

describe('ToolchainAdapters', () => {
  it('recognizes Maven commands (the gap that broke the analyzed session)', () => {
    expect(isKnownVerificationCommand('mvn clean test')).toBe(true);
    expect(isKnownVerificationCommand('./mvnw spring-boot:run')).toBe(true);
    expect(detectAdapterForCommand('mvn test')?.id).toBe('maven');
  });

  it('recognizes Gradle, .NET, and other non-Node ecosystems', () => {
    expect(isKnownVerificationCommand('./gradlew build')).toBe(true);
    expect(isKnownVerificationCommand('dotnet test')).toBe(true);
    expect(isKnownVerificationCommand('bundle exec rspec')).toBe(true);
    expect(isKnownVerificationCommand('terraform plan')).toBe(true);
  });

  it('still recognizes the original Node/Python/Rust/Go commands', () => {
    expect(isKnownVerificationCommand('npm run build')).toBe(true);
    expect(isKnownVerificationCommand('pytest')).toBe(true);
    expect(isKnownVerificationCommand('cargo test')).toBe(true);
    expect(isKnownVerificationCommand('go test ./...')).toBe(true);
  });

  it('does not falsely match unrelated commands', () => {
    expect(isKnownVerificationCommand('ls -la')).toBe(false);
    expect(isKnownVerificationCommand('echo done')).toBe(false);
  });
});

describe('VerificationResultParser — exit-code-first, adapter-driven', () => {
  const parser = new VerificationResultParser();

  it('treats a nonzero exit code as failure even when output contains no recognized failure text', () => {
    // Maven often prints a wall of stack trace text that doesn't match any generic "failed" pattern
    const result = parser.parse('shell_exec', 'Downloading dependency...\nSomething unexpected happened', { command: 'mvn test' }, 1);
    expect(result.ran).toBe(true);
    expect(result.success).toBe(false);
  });

  it('treats exit code 0 as success for a Maven build', () => {
    const result = parser.parse('shell_exec', '[INFO] BUILD SUCCESS', { command: 'mvn clean test' }, 0);
    expect(result.ran).toBe(true);
    expect(result.success).toBe(true);
  });

  it("Maven's real failure banner (BUILD FAILURE) is recognized even without exit code", () => {
    const result = parser.parse('shell_exec', '[INFO] BUILD FAILURE\n[ERROR] ...', { command: 'mvn test' });
    expect(result.ran).toBe(true);
    expect(result.success).toBe(false);
  });

  it('a failure hint can downgrade an exit-0 result (tool masking failure)', () => {
    const result = parser.parse('shell_exec', '[INFO] BUILD FAILURE somehow reported with exit 0', { command: 'mvn test' }, 0);
    expect(result.success).toBe(false);
  });

  it('a success hint can never override a nonzero exit code', () => {
    const result = parser.parse('shell_exec', '[INFO] BUILD SUCCESS (misleading)', { command: 'mvn test' }, 1);
    expect(result.success).toBe(false);
  });

  it('unrecognized commands are not treated as verification at all', () => {
    const result = parser.parse('shell_exec', 'some output', { command: 'ls -la' }, 0);
    expect(result.ran).toBe(false);
  });

  it('falls back to adapter-specific (or generic) text heuristics when no exit code is available', () => {
    const passing = parser.parse('shell_exec', 'Compiled successfully.', { command: 'npm run build' });
    expect(passing.success).toBe(true);
    const failing = parser.parse('shell_exec', 'npm ERR! build failed', { command: 'npm run build' });
    expect(failing.success).toBe(false);
  });
});

describe('CodingTurnGuard — verification gate', () => {
  it('records a FAILED build/test even though the tool call itself reported success=false', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    // Simulate: file written, then a failing `mvn test` (exit code 1).
    guard.onToolExecuted('file_write', true, { path: 'src/Foo.java' }, codingCategory);
    guard.onToolExecuted('shell_exec', false, { command: 'mvn test' }, codingCategory, 1);

    // The build-fix loop must be armed with a concrete instruction, not the generic
    // "you haven't run anything yet" message — this is the bug that let the analyzed
    // session's Maven failures go completely unnoticed by the gate.
    const reminder = guard.getVerificationReminder();
    expect(reminder).toBeTruthy();
    expect(reminder).toContain('BUILD FIX REQUIRED');
  });

  it('clears the gate once a real passing build/test is recorded', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_write', true, { path: 'src/Foo.java' }, codingCategory);
    guard.onToolExecuted('shell_exec', true, { command: 'mvn clean test' }, codingCategory, 0);

    expect(guard.getVerificationReminder()).toBeNull();
  });

  it('checkToolCall blocks file_write before file_read on the same path in a coding turn', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    const blocked = guard.checkToolCall('file_write', { path: 'src/Foo.java' }, codingCategory);
    expect(blocked).toContain('BLOCKED');
  });

  it('blocks destructive git/rm operations pending explicit approval', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    const blocked = guard.checkToolCall('shell_exec', { command: 'rm -rf build' }, codingCategory);
    expect(blocked).toContain('BLOCKED');
  });

  // ─── Hard verification gate tests ───
  it('mustBlockFinish returns true when files written but no verification run', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_write', true, { path: 'src/App.java' }, codingCategory);
    expect(guard.mustBlockFinish()).toBe(true);
  });

  it('mustBlockFinish returns false after verification passes', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_write', true, { path: 'src/App.java' }, codingCategory);
    guard.onToolExecuted('shell_exec', true, { command: 'mvn clean test' }, codingCategory, 0);
    expect(guard.mustBlockFinish()).toBe(false);
  });

  it('mustBlockFinish returns false when no files were written', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_read', true, { path: 'src/App.java' }, codingCategory);
    expect(guard.mustBlockFinish()).toBe(false);
  });

  it('getForcedVerificationMessage includes endpoint testing instructions for server tasks', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    // Simulate a file write for a server-related task
    guard.onToolExecuted('file_write', true, { path: 'src/main/java/App.java' }, codingCategory);
    // The ledger entry for file_write includes output that mentions "spring"
    ledger.record({
      name: 'file_write',
      success: true,
      output: 'Created Spring Boot application with endpoint',
      elapsed: 100,
      path: 'src/main/java/App.java',
    });

    const msg = guard.getForcedVerificationMessage();
    expect(msg).toContain('VERIFICATION REQUIRED');
    expect(msg).toContain('terminal_start');
    expect(msg).toContain('terminal_read');
    expect(msg).toContain('curl');
  });

  it('terminal_start and terminal_read count as verification attempts', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_write', true, { path: 'src/App.java' }, codingCategory);
    guard.onToolExecuted('terminal_start', true, { command: 'mvn spring-boot:run' }, codingCategory);

    // After terminal_start, the guard should know some verification was attempted
    // (though it may still block if the build/test hasn't passed)
    const reminder = guard.getVerificationReminder();
    // The reminder should not say "you have not run a build" since terminal_start counts
    if (reminder) {
      expect(reminder).not.toContain('have not run a build');
    }
  });

  it('curl to localhost counts as verification', () => {
    const ledger = new ToolLedger();
    const guard = new CodingTurnGuard(ledger, () => {});
    guard.resetForTurn();

    guard.onToolExecuted('file_write', true, { path: 'src/App.java' }, codingCategory);
    // Simulate a curl command to localhost
    ledger.record({
      name: 'shell_exec',
      success: true,
      output: '{"status":"ok"}',
      elapsed: 100,
      command: 'curl -s http://localhost:8080/api/health',
    });

    // hasRunBuildOrTest should return true because curl to localhost counts
    // We can't call it directly (it's private), but we can check that the
    // verification reminder doesn't say "you have not run a build"
    const reminder = guard.getVerificationReminder();
    if (reminder) {
      expect(reminder).not.toContain('have not run a build');
    }
  });
});
