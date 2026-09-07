/**
 * Terminal tools for the Engineering Crew — enables live debugging by providing
 * persistent PTY-backed terminal sessions the agent can interact with.
 *
 * Tools:
 *   terminal_start  — start a command in a persistent terminal
 *   terminal_read   — read output from a terminal (with offset or tail)
 *   terminal_send   — send input to a running terminal
 *   terminal_kill   — kill a terminal session
 *   terminal_list   — list active terminals for the session
 *   log_tail        — tail a log file (for reading app log files)
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { TerminalManager } from '../TerminalManager.js';
import { validateCommandScope } from '../shell-security.js';

const manager = TerminalManager.getInstance();

/** Start a command in a persistent PTY terminal. */
export async function terminalStart(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };

  const cwd = args['cwd']
    ? resolve(context.scopePath, args['cwd'] as string)
    : context.scopePath;

  const scopeErr = validateCommandScope(command, context.scopePath, cwd);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };

  const label = (args['label'] as string) ?? undefined;
  const env = args['env'] as Record<string, string> | undefined;

  try {
    const session = manager.start({
      command,
      cwd,
      sessionId: context.sessionId,
      env: env as Record<string, string> | undefined,
      label,
    });

    // Wait a brief moment for initial output
    await new Promise((r) => setTimeout(r, 500));

    const info = session.toInfo();
    return {
      success: true,
      output: `Terminal started (ID: ${info.id}, PID: ${info.pid})\nCommand: ${command}\nCwd: ${cwd}\nInitial output:\n${session.getTail(30)}`,
      metadata: {
        terminalId: info.id,
        pid: info.pid,
        command: info.command,
        cwd: info.cwd,
        alive: info.alive,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: `Failed to start terminal: ${(error as Error).message}`,
      error: 'SPAWN_ERROR',
    };
  }
}

/** Read output from a terminal session. */
export async function terminalRead(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const terminalId = args['terminalId'] as string;
  if (!terminalId) return { success: false, output: 'terminalId is required', error: 'VALIDATION_ERROR' };

  const session = manager.get(terminalId);
  if (!session) return { success: false, output: `Terminal ${terminalId} not found`, error: 'NOT_FOUND' };

  const mode = (args['mode'] as string) ?? 'tail';
  const maxChars = (args['maxChars'] as number) ?? 20_000;

  if (mode === 'tail') {
    const maxLines = (args['maxLines'] as number) ?? 80;
    const tail = session.getTail(maxLines);
    return {
      success: true,
      output: tail || '(no output yet)',
      metadata: {
        terminalId: session.id,
        alive: session.isAlive(),
        exitCode: session.getExitCode(),
        outputLength: session.toInfo().outputLength,
      },
    };
  }

  if (mode === 'full') {
    const output = session.getFullOutput(maxChars);
    return {
      success: true,
      output: output || '(no output yet)',
      metadata: {
        terminalId: session.id,
        alive: session.isAlive(),
        exitCode: session.getExitCode(),
        outputLength: session.toInfo().outputLength,
      },
    };
  }

  if (mode === 'since') {
    const offset = (args['offset'] as number) ?? 0;
    const result = session.getOutputSince(offset);
    return {
      success: true,
      output: result.data || '(no new output)',
      metadata: {
        terminalId: session.id,
        offset: result.offset,
        totalLength: result.totalLength,
        alive: session.isAlive(),
        exitCode: session.getExitCode(),
      },
    };
  }

  return { success: false, output: `Unknown mode: ${mode}`, error: 'VALIDATION_ERROR' };
}

/** Send input to a running terminal. */
export async function terminalSend(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const terminalId = args['terminalId'] as string;
  const text = args['text'] as string;
  if (!terminalId) return { success: false, output: 'terminalId is required', error: 'VALIDATION_ERROR' };
  if (text === undefined || text === null) return { success: false, output: 'text is required', error: 'VALIDATION_ERROR' };

  const session = manager.get(terminalId);
  if (!session) return { success: false, output: `Terminal ${terminalId} not found`, error: 'NOT_FOUND' };
  if (!session.isAlive()) return { success: false, output: `Terminal ${terminalId} is not alive`, error: 'NOT_ALIVE' };

  try {
    session.sendInput(text);
    // Wait a brief moment for output
    await new Promise((r) => setTimeout(r, 300));
    return {
      success: true,
      output: `Input sent. Recent output:\n${session.getTail(20)}`,
      metadata: { terminalId: session.id, alive: session.isAlive() },
    };
  } catch (error) {
    return {
      success: false,
      output: `Failed to send input: ${(error as Error).message}`,
      error: 'SEND_ERROR',
    };
  }
}

/** Kill a terminal session. */
export async function terminalKill(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const terminalId = args['terminalId'] as string;
  if (!terminalId) return { success: false, output: 'terminalId is required', error: 'VALIDATION_ERROR' };

  const session = manager.get(terminalId);
  if (!session) return { success: false, output: `Terminal ${terminalId} not found`, error: 'NOT_FOUND' };

  const ok = manager.kill(terminalId);
  return {
    success: ok,
    output: ok ? `Terminal ${terminalId} killed` : `Failed to kill terminal ${terminalId}`,
    metadata: { terminalId, exitCode: session.getExitCode() },
  };
}

/** List active terminals for the current session. */
export async function terminalList(
  _args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const terminals = manager.listBySession(context.sessionId);
  if (terminals.length === 0) {
    return { success: true, output: 'No active terminals' };
  }

  const lines = terminals.map((t) => {
    const status = t.alive ? 'RUNNING' : `EXIT(${t.exitCode})`;
    return `  ${t.id} | PID ${t.pid} | ${status} | ${t.label}`;
  });

  return {
    success: true,
    output: `Active terminals (${terminals.length}):\n${lines.join('\n')}`,
    metadata: { terminals },
  };
}

/** Tail a log file — read the last N lines of a file. */
export async function logTail(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = args['path'] as string;
  if (!filePath) return { success: false, output: 'path is required', error: 'VALIDATION_ERROR' };

  const resolved = resolve(context.scopePath, filePath);
  if (!resolved.startsWith(context.scopePath)) {
    return { success: false, output: 'Path resolves outside scope', error: 'SCOPE_VIOLATION' };
  }

  const maxLines = (args['maxLines'] as number) ?? 100;
  const offset = (args['offset'] as number) ?? 0;

  try {
    const stats = await stat(resolved);
    if (!stats.isFile()) {
      return { success: false, output: `Not a file: ${resolved}`, error: 'NOT_FOUND' };
    }

    // For offset-based reading (tailing new content), read from byte offset
    if (offset > 0) {
      const { createReadStream } = await import('node:fs');
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve2, reject2) => {
        const stream = createReadStream(resolved, { start: offset, encoding: 'utf-8' });
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve2());
        stream.on('error', reject2);
      });
      const data = Buffer.concat(chunks).toString('utf-8');
      return {
        success: true,
        output: data || '(no new content)',
        metadata: {
          path: resolved,
          offset,
          size: stats.size,
          newBytes: data.length,
        },
      };
    }

    // For tail mode, read the whole file and take last N lines
    const content = await readFile(resolved, 'utf-8');
    const allLines = content.split('\n');
    const tailLines = allLines.slice(-maxLines);
    return {
      success: true,
      output: tailLines.join('\n'),
      metadata: {
        path: resolved,
        size: stats.size,
        totalLines: allLines.length,
        returnedLines: tailLines.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: `Failed to read log file: ${(error as Error).message}`,
      error: 'READ_ERROR',
    };
  }
}
