import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { AgentProcessRegistry } from '../src/tools/AgentProcessRegistry.js';
import { AgentEventBus } from '../src/events/EventBus.js';
import type { EngineEvent } from '@agentx/shared';

function spawnNode(script: string, opts?: { detached?: boolean }): ChildProcess {
  return spawn(process.execPath, ['-e', script], {
    detached: opts?.detached,
    stdio: opts?.detached ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });
}

function waitForClose(child: ChildProcess, timeoutMs = 4000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for process close')), timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      setTimeout(resolve, 20);
    });
  });
}

describe('AgentProcessRegistry — Process Supervisor', () => {
  it('proactively emits a process_status_changed(crashed) event when a tracked process exits nonzero, without waiting for a poll', async () => {
    const registry = new AgentProcessRegistry();
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));
    registry.registerSessionEventBus('session-1', bus);

    const child = spawnNode("process.stderr.write('boom\\n'); process.exit(3)");
    registry.track(child, {
      command: 'node -e exit 3',
      sessionId: 'session-1',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });
    if (child.pid) {
      child.stderr?.on('data', (d: Buffer) => registry.appendLog(child.pid!, d.toString()));
    }

    await waitForClose(child);

    const crashEvent = events.find((e) => e.type === 'process_status_changed');
    expect(crashEvent).toBeTruthy();
    expect((crashEvent as { status: string }).status).toBe('crashed');
    expect((crashEvent as { exitCode: number }).exitCode).toBe(3);
    expect((crashEvent as { logTail?: string }).logTail).toContain('boom');
  });

  it('reports a deliberate kill() as exited, not crashed', async () => {
    const registry = new AgentProcessRegistry();
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));
    registry.registerSessionEventBus('session-2', bus);

    const child = spawnNode('setTimeout(() => {}, 30000)');
    registry.track(child, {
      command: 'node sleeper',
      sessionId: 'session-2',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeTruthy();
    const closed = waitForClose(child);
    registry.kill(child.pid!, 'SIGTERM');
    await closed;

    const statusEvent = events.find((e) => e.type === 'process_status_changed');
    expect(statusEvent).toBeTruthy();
    expect((statusEvent as { status: string }).status).toBe('exited');
  });

  it('does not emit for sessions with no registered event bus', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawnNode('process.exit(0)');
    registry.track(child, {
      command: 'exit 0',
      sessionId: 'unregistered-session',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });
    await waitForClose(child);
    expect(registry.get(child.pid!)).toBeUndefined();
  });

  it('unregisterSessionEventBus stops further notifications for that session', async () => {
    const registry = new AgentProcessRegistry();
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));
    registry.registerSessionEventBus('session-3', bus);
    registry.unregisterSessionEventBus('session-3');

    const child = spawnNode('process.exit(1)');
    registry.track(child, {
      command: 'exit 1',
      sessionId: 'session-3',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });

    await waitForClose(child);
    expect(events.find((e) => e.type === 'process_status_changed')).toBeUndefined();
  });

  it('getBySession returns only processes for the specified session', async () => {
    const registry = new AgentProcessRegistry();
    const child1 = spawnNode('setTimeout(() => {}, 30000)');
    const child2 = spawnNode('setTimeout(() => {}, 30000)');
    registry.track(child1, { command: 'sleep a', sessionId: 'sess-a', scopePath: '/tmp', cwd: '/tmp', detached: false });
    registry.track(child2, { command: 'sleep b', sessionId: 'sess-b', scopePath: '/tmp', cwd: '/tmp', detached: false });

    const sessA = registry.getBySession('sess-a');
    expect(sessA.length).toBe(1);
    expect(sessA[0]!.sessionId).toBe('sess-a');

    const closed = Promise.all([waitForClose(child1), waitForClose(child2)]);
    registry.kill(child1.pid!);
    registry.kill(child2.pid!);
    await closed;
  });

  it('kill() terminates a tracked process and marks it as stopping', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawnNode('setTimeout(() => {}, 30000)');
    registry.track(child, { command: 'node sleeper', sessionId: 'sess-k', scopePath: '/tmp', cwd: '/tmp', detached: false });

    await new Promise((r) => setTimeout(r, 50));
    const closed = waitForClose(child);
    const killed = registry.kill(child.pid!);
    expect(killed).toBe(true);

    await closed;
    expect(registry.get(child.pid!)).toBeUndefined();
  });

  it('detached processes are not killed by kill() of a different PID', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawnNode('setTimeout(() => {}, 30000)', { detached: true });
    child.unref();
    registry.track(child, { command: 'node sleeper', sessionId: 'sess-d', scopePath: '/tmp', cwd: '/tmp', detached: true });

    await new Promise((r) => setTimeout(r, 50));
    const killed = registry.kill(999999);
    expect(killed).toBe(false);

    expect(registry.get(child.pid!)).toBeTruthy();

    const closed = waitForClose(child);
    registry.kill(child.pid!);
    await closed;
  });
});
