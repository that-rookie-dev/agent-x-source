/**
 * Terminal tools tests — verifies the terminal_start/terminal_read/terminal_send/
 * terminal_kill/terminal_list tools work correctly for live debugging.
 *
 * Live PTY cases are skipped on Windows: node-pty's ConPTY helper aborts the
 * vitest worker in GitHub Actions (`AttachConsole failed`) even when assertions pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerminalManager } from '../../src/tools/TerminalManager.js';
import { terminalStart, terminalRead, terminalKill, terminalList } from '../../src/tools/builtin/terminal.js';
import type { ToolExecutionContext } from '@agentx/shared';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manager = TerminalManager.getInstance();
const isWin = process.platform === 'win32';
const linger = isWin ? 'ping -n 31 127.0.0.1 >nul' : 'sleep 30';
const lingerShort = isWin ? 'ping -n 6 127.0.0.1 >nul' : 'sleep 5';
const echoMarker = 'echo test output 12345';
const echoRead = 'echo read test output';

function waitForExit(session: { isAlive: () => boolean; onExit: (listener: (info: { exitCode: number; pid: number }) => void) => () => void }, timeoutMs = 4000): Promise<void> {
  if (!session.isAlive()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for terminal exit')), timeoutMs);
    session.onExit(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForOutput(
  getText: () => string | Promise<string>,
  needle: string,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now();
  let text = '';
  while (Date.now() - start < timeoutMs) {
    text = await getText();
    if (text.includes(needle)) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`did not see ${JSON.stringify(needle)} in output: ${JSON.stringify(text)}`);
}

function makeContext(scopePath: string, sessionId = 'test-session'): ToolExecutionContext {
  return {
    sessionId,
    scopePath,
    voiceTurn: false,
  } as ToolExecutionContext;
}

describe.skipIf(process.platform === 'win32')('TerminalManager', () => {
  it('starts a terminal and tracks it', async () => {
    const session = manager.start({
      command: 'echo hello',
      cwd: tmpdir(),
      sessionId: 'test-session',
    });
    expect(session.id).toMatch(/^term-/);
    expect(session.pid).toBeGreaterThan(0);

    await waitForExit(session);

    const info = session.toInfo();
    expect(info.command).toBe('echo hello');
    expect(info.alive).toBe(false);

    // Clean up
    manager.kill(session.id);
  });

  it('lists terminals by session', async () => {
    const session = manager.start({
      command: lingerShort,
      cwd: tmpdir(),
      sessionId: 'test-list-session',
    });

    const list = manager.listBySession('test-list-session');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(session.id);

    manager.kill(session.id);
  });

  it('captures output', async () => {
    const session = manager.start({
      command: echoMarker,
      cwd: tmpdir(),
      sessionId: 'test-output-session',
    });

    await waitForOutput(
      () => `${session.getFullOutput()}\n${session.getTail(20)}`,
      'test output 12345',
    );

    manager.kill(session.id);
  });

  it('kills a terminal', async () => {
    const session = manager.start({
      command: linger,
      cwd: tmpdir(),
      sessionId: 'test-kill-session',
    });

    expect(session.isAlive()).toBe(true);
    manager.kill(session.id);

    // Give it a moment to die
    await new Promise((r) => setTimeout(r, 500));
    expect(session.isAlive()).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('terminal tools', () => {
  const testSessionId = 'terminal-tools-test';

  beforeEach(() => {
    // Clean up any leftover terminals
    manager.killBySession(testSessionId);
  });

  afterEach(() => {
    manager.killBySession(testSessionId);
  });

  it('terminal_start starts a command and returns terminalId', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    const result = await terminalStart({ command: 'echo hello' }, ctx);

    expect(result.success).toBe(true);
    expect(result.metadata?.terminalId).toMatch(/^term-/);
    expect(result.metadata?.pid).toBeGreaterThan(0);
  });

  it('terminal_read returns output in tail mode', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    const startResult = await terminalStart({ command: echoRead }, ctx);
    const terminalId = startResult.metadata!.terminalId as string;

    const output = await waitForOutput(async () => {
      const result = await terminalRead({ terminalId, mode: 'full' }, ctx);
      return result.output ?? '';
    }, 'read test output');
    expect(output).toContain('read test output');
  });

  it('terminal_list shows active terminals', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    // Kill any leftover terminals first
    manager.killBySession(testSessionId);
    await new Promise((r) => setTimeout(r, 100));
    await terminalStart({ command: lingerShort, label: 'test-sleep' }, ctx);

    const listResult = await terminalList({}, ctx);
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('test-sleep');
    expect(listResult.metadata?.terminals.length).toBeGreaterThanOrEqual(1);
  });

  it('terminal_kill kills a terminal', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    const startResult = await terminalStart({ command: linger }, ctx);
    const terminalId = startResult.metadata!.terminalId as string;

    const killResult = await terminalKill({ terminalId }, ctx);
    expect(killResult.success).toBe(true);
    expect(killResult.output).toContain('killed');
  });
});

describe('terminal tools validation', () => {
  const testSessionId = 'terminal-tools-validation';

  it('rejects commands outside scope', async () => {
    const ctx = makeContext(join(tmpdir(), 'scoped'), testSessionId);
    const result = await terminalStart({ command: 'rm -rf /etc' }, ctx);
    expect(result.success).toBe(false);
  });

  it('terminal_read returns error for unknown terminalId', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    const result = await terminalRead({ terminalId: 'nonexistent' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_FOUND');
  });
});
