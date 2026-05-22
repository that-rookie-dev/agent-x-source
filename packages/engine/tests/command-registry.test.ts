import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../src/commands/CommandRegistry.js';
import type { CommandInterface } from '../src/commands/CommandInterface.js';

const mockCommand: CommandInterface = {
  name: 'test',
  description: 'A test command',
  aliases: ['t'],
  async execute() {
    return { success: true, action: 'none' };
  },
};

const anotherCommand: CommandInterface = {
  name: 'other',
  description: 'Another command',
  async execute() {
    return { success: true, action: 'none' };
  },
};

describe('CommandRegistry', () => {
  it('registers and retrieves commands', () => {
    const registry = new CommandRegistry();
    registry.register(mockCommand);

    expect(registry.has('test')).toBe(true);
    expect(registry.get('test')).toBe(mockCommand);
  });

  it('retrieves by alias', () => {
    const registry = new CommandRegistry();
    registry.register(mockCommand);

    expect(registry.has('t')).toBe(true);
    expect(registry.get('t')).toBe(mockCommand);
  });

  it('returns undefined for unknown commands', () => {
    const registry = new CommandRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all registered commands', () => {
    const registry = new CommandRegistry();
    registry.register(mockCommand);
    registry.register(anotherCommand);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.name)).toContain('test');
    expect(list.map((c) => c.name)).toContain('other');
  });

  it('getNames returns all command names', () => {
    const registry = new CommandRegistry();
    registry.register(mockCommand);
    registry.register(anotherCommand);

    const names = registry.getNames();
    expect(names).toContain('test');
    expect(names).toContain('other');
  });
});
