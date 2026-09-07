/**
 * Terminal tools tests — verifies the terminal_start/terminal_read/terminal_send/
 * terminal_kill/terminal_list tools work correctly for live debugging.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerminalManager } from '../../src/tools/TerminalManager.js';
import { terminalStart, terminalRead, terminalSend, terminalKill, terminalList } from '../../src/tools/builtin/terminal.js';
import type { ToolExecutionContext } from '@agentx/shared';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manager = TerminalManager.getInstance();

function makeContext(scopePath: string, sessionId = 'test-session'): ToolExecutionContext {
  return {
    sessionId,
    scopePath,
    voiceTurn: false,
  } as ToolExecutionContext;
}

describe('TerminalManager', () => {
  it('starts a terminal and tracks it', async () => {
    const session = manager.start({
      command: 'echo hello',
      cwd: tmpdir(),
      sessionId: 'test-session',
    });
    expect(session.id).toMatch(/^term-/);
    expect(session.pid).toBeGreaterThan(0);
    expect(session.isAlive()).toBe(true);

    // Wait for it to finish
    await new Promise((r) => setTimeout(r, 500));

    const info = session.toInfo();
    expect(info.command).toBe('echo hello');
    expect(info.alive).toBe(false);

    // Clean up
    manager.kill(session.id);
  });

  it('lists terminals by session', async () => {
    const session = manager.start({
      command: 'sleep 2',
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
      command: 'sh -c "sleep 0.3 && echo test output 12345"',
      cwd: tmpdir(),
      sessionId: 'test-output-session',
    });

    // Wait for output
    await new Promise((r) => setTimeout(r, 1000));

    const tail = session.getTail(10);
    expect(tail).toContain('test output 12345');

    manager.kill(session.id);
  });

  it('kills a terminal', async () => {
    const session = manager.start({
      command: 'sleep 30',
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

describe('terminal tools', () => {
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
    const startResult = await terminalStart({ command: 'sh -c "sleep 0.3 && echo read test output"' }, ctx);
    const terminalId = startResult.metadata!.terminalId as string;

    // Wait for output
    await new Promise((r) => setTimeout(r, 1000));

    const readResult = await terminalRead({ terminalId, mode: 'tail' }, ctx);
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain('read test output');
  });

  it('terminal_list shows active terminals', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    // Kill any leftover terminals first
    manager.killBySession(testSessionId);
    await new Promise((r) => setTimeout(r, 100));
    await terminalStart({ command: 'sleep 5', label: 'test-sleep' }, ctx);

    const listResult = await terminalList({}, ctx);
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('test-sleep');
    expect(listResult.metadata?.terminals.length).toBeGreaterThanOrEqual(1);
  });

  it('terminal_kill kills a terminal', async () => {
    const ctx = makeContext(tmpdir(), testSessionId);
    const startResult = await terminalStart({ command: 'sleep 10' }, ctx);
    const terminalId = startResult.metadata!.terminalId as string;

    const killResult = await terminalKill({ terminalId }, ctx);
    expect(killResult.success).toBe(true);
    expect(killResult.output).toContain('killed');
  });

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
