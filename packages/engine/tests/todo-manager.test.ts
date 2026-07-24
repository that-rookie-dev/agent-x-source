import { describe, expect, it, vi } from 'vitest';
import { TodoManager } from '../src/agent/TodoManager.js';
import { todoWrite } from '../src/tools/builtin/todo.js';
import { registerSessionTodoManager, unregisterSessionTodoManager } from '../src/tools/TodoAccess.js';

function makeBus() {
  return { emit: vi.fn() } as unknown as ConstructorParameters<typeof TodoManager>[0];
}

describe('TodoManager', () => {
  it('allows multiple in_progress items for parallel streams', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    mgr.replaceAll([
      { title: 'A', status: 'in-progress' },
      { title: 'B', status: 'in-progress' },
      { title: 'C', status: 'not-started' },
    ]);
    const items = mgr.getItems();
    expect(items.filter((i) => i.status === 'in-progress')).toHaveLength(2);
  });

  it('auto-starts first pending item when replaceAll has no in_progress', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    mgr.replaceAll([
      { title: 'A', status: 'not-started' },
      { title: 'B', status: 'not-started' },
    ]);
    expect(mgr.getItems()[0]?.status).toBe('in-progress');
    expect(mgr.getItems()[1]?.status).toBe('not-started');
  });

  it('bumps revision on each update', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    const r0 = mgr.getRevision();
    mgr.replaceAll([{ title: 'A', status: 'in-progress' }]);
    const r1 = mgr.getRevision();
    mgr.updateItem(1, { status: 'completed' });
    expect(r1).toBeGreaterThan(r0);
    expect(mgr.getRevision()).toBeGreaterThan(r1);
  });

  it('findItem matches by title when id is missing', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    mgr.replaceAll([{ title: 'Research topic', status: 'in-progress' }]);
    expect(mgr.findItem({ title: 'research topic' })?.id).toBe(1);
  });

  it('ensureActiveWork promotes a parallel wave when nothing is in_progress', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    mgr.replaceAll([
      { title: 'A', status: 'completed' },
      { title: 'B', status: 'not-started' },
      { title: 'C', status: 'not-started' },
      { title: 'D', status: 'not-started' },
    ]);
    // replaceAll auto-starts first pending — clear to simulate a stuck idle checklist
    mgr.updateItem(2, { status: 'not-started' });
    expect(mgr.getItems().every((i) => i.status !== 'in-progress' || i.id === 2)).toBeTruthy();
    // Force idle: mark any in_progress back to not-started
    for (const item of mgr.getItems()) {
      if (item.status === 'in-progress') mgr.updateItem(item.id, { status: 'not-started' });
    }
    mgr.ensureActiveWork(2);
    const active = mgr.getItems().filter((i) => i.status === 'in-progress');
    expect(active).toHaveLength(2);
    expect(mgr.hasIncomplete()).toBe(true);
  });

  it('clears the entire batch when every item is completed', () => {
    const bus = makeBus();
    const mgr = new TodoManager(bus, 'sess');
    mgr.replaceAll([
      { title: 'A', status: 'in-progress' },
      { title: 'B', status: 'not-started' },
    ]);
    mgr.updateItem(1, { status: 'completed' });
    expect(mgr.getItems()).toHaveLength(2);
    mgr.updateItem(2, { status: 'completed' });
    expect(mgr.getItems()).toHaveLength(0);
    const lastEmit = (bus.emit as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { items: unknown[] };
    expect(lastEmit.items).toEqual([]);
  });

  it('does not reopen completed items when replaceAll is all completed', () => {
    const mgr = new TodoManager(makeBus(), 'sess');
    mgr.replaceAll([
      { title: 'A', status: 'completed' },
      { title: 'B', status: 'completed' },
    ]);
    expect(mgr.getItems()).toHaveLength(0);
  });
});

describe('todoWrite merge', () => {
  it('updates by title when merge:true and id omitted', async () => {
    const mgr = new TodoManager(makeBus(), 'sess-a');
    registerSessionTodoManager('sess-a', mgr);
    try {
      await todoWrite({
        merge: false,
        todos: [
          { content: 'Step one', status: 'in_progress' },
          { content: 'Step two', status: 'pending' },
        ],
      }, { sessionId: 'sess-a', scopePath: '/tmp' } as never);

      const result = await todoWrite({
        merge: true,
        todos: [
          { content: 'Step one', status: 'completed' },
          { content: 'Step two', status: 'in_progress' },
        ],
      }, { sessionId: 'sess-a', scopePath: '/tmp' } as never);

      expect(result.success).toBe(true);
      const items = mgr.getItems();
      expect(items).toHaveLength(2);
      expect(items[0]?.status).toBe('completed');
      expect(items[1]?.status).toBe('in-progress');
      expect(result.output).toContain('NEXT:');
    } finally {
      unregisterSessionTodoManager('sess-a');
    }
  });

  it('parses todos JSON string args', async () => {
    const mgr = new TodoManager(makeBus(), 'sess-b');
    registerSessionTodoManager('sess-b', mgr);
    try {
      const result = await todoWrite({
        merge: false,
        todos: JSON.stringify([{ content: 'Only', status: 'in_progress' }]),
      }, { sessionId: 'sess-b', scopePath: '/tmp' } as never);
      expect(result.success).toBe(true);
      expect(mgr.getItems()).toHaveLength(1);
    } finally {
      unregisterSessionTodoManager('sess-b');
    }
  });
});
