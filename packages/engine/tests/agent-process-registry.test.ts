import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { AgentProcessRegistry } from '../src/tools/AgentProcessRegistry.js';
import { AgentEventBus } from '../src/events/EventBus.js';
import type { EngineEvent } from '@agentx/shared';

describe('AgentProcessRegistry — Process Supervisor', () => {
  it('proactively emits a process_status_changed(crashed) event when a tracked process exits nonzero, without waiting for a poll', async () => {
    const registry = new AgentProcessRegistry();
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));
    registry.registerSessionEventBus('session-1', bus);

    const child = spawn('sh', ['-c', 'echo boom 1>&2; exit 3']);
    registry.track(child, {
      command: 'sh -c "echo boom 1>&2; exit 3"',
      sessionId: 'session-1',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });
    if (child.pid) {
      child.stderr?.on('data', (d: Buffer) => registry.appendLog(child.pid!, d.toString()));
    }

    await new Promise<void>((resolve) => child.on('close', () => setTimeout(resolve, 20)));

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

    const child = spawn('sh', ['-c', 'sleep 30']);
    registry.track(child, {
      command: 'sleep 30',
      sessionId: 'session-2',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeTruthy();
    registry.kill(child.pid!, 'SIGTERM');

    await new Promise<void>((resolve) => child.on('close', () => setTimeout(resolve, 20)));

    const statusEvent = events.find((e) => e.type === 'process_status_changed');
    expect(statusEvent).toBeTruthy();
    expect((statusEvent as { status: string }).status).toBe('exited');
  });

  it('does not emit for sessions with no registered event bus', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawn('sh', ['-c', 'exit 0']);
    registry.track(child, {
      command: 'exit 0',
      sessionId: 'unregistered-session',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });
    // Should simply not throw with no bus registered.
    await new Promise<void>((resolve) => child.on('close', () => setTimeout(resolve, 20)));
    expect(registry.get(child.pid!)).toBeUndefined();
  });

  it('unregisterSessionEventBus stops further notifications for that session', async () => {
    const registry = new AgentProcessRegistry();
    const bus = new AgentEventBus();
    const events: EngineEvent[] = [];
    bus.on((e) => events.push(e));
    registry.registerSessionEventBus('session-3', bus);
    registry.unregisterSessionEventBus('session-3');

    const child = spawn('sh', ['-c', 'exit 1']);
    registry.track(child, {
      command: 'exit 1',
      sessionId: 'session-3',
      scopePath: '/tmp',
      cwd: '/tmp',
      detached: false,
    });

    await new Promise<void>((resolve) => child.on('close', () => setTimeout(resolve, 20)));
    expect(events.find((e) => e.type === 'process_status_changed')).toBeUndefined();
  });

  it('getBySession returns only processes for the specified session', async () => {
    const registry = new AgentProcessRegistry();
    const child1 = spawn('sh', ['-c', 'sleep 5']);
    const child2 = spawn('sh', ['-c', 'sleep 5']);
    registry.track(child1, { command: 'sleep 5', sessionId: 'sess-a', scopePath: '/tmp', cwd: '/tmp', detached: false });
    registry.track(child2, { command: 'sleep 5', sessionId: 'sess-b', scopePath: '/tmp', cwd: '/tmp', detached: false });

    const sessA = registry.getBySession('sess-a');
    expect(sessA.length).toBe(1);
    expect(sessA[0]!.sessionId).toBe('sess-a');

    registry.kill(child1.pid!);
    registry.kill(child2.pid!);
    await new Promise<void>((r) => setTimeout(r, 100));
  });

  it('kill() terminates a tracked process and marks it as stopping', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawn('sh', ['-c', 'sleep 30']);
    registry.track(child, { command: 'sleep 30', sessionId: 'sess-k', scopePath: '/tmp', cwd: '/tmp', detached: false });

    await new Promise((r) => setTimeout(r, 50));
    const killed = registry.kill(child.pid!);
    expect(killed).toBe(true);

    await new Promise<void>((r) => child.on('close', () => setTimeout(r, 20)));
    expect(registry.get(child.pid!)).toBeUndefined();
  });

  it('detached processes are not killed by kill() of a different PID', async () => {
    const registry = new AgentProcessRegistry();
    const child = spawn('sh', ['-c', 'sleep 30'], { detached: true });
    child.unref();
    registry.track(child, { command: 'sleep 30', sessionId: 'sess-d', scopePath: '/tmp', cwd: '/tmp', detached: true });

    await new Promise((r) => setTimeout(r, 50));
    // Killing a non-existent PID should return false, not affect the detached process
    const killed = registry.kill(999999);
    expect(killed).toBe(false);

    // The detached process should still be tracked
    expect(registry.get(child.pid!)).toBeTruthy();

    // Clean up
    registry.kill(child.pid!);
    await new Promise<void>((r) => child.on('close', () => setTimeout(r, 20)));
  });
});
