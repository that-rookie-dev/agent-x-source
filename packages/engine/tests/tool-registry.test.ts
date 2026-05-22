import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition } from '@agentx/shared';

const mockTool: ToolDefinition = {
  id: 'file_read',
  name: 'file_read',
  description: 'Read a file',
  modelDescription: 'Read the contents of a file at the given path',
  category: 'filesystem',
  riskLevel: 'low',
  schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  composable: true,
  source: 'builtin',
};

const anotherTool: ToolDefinition = {
  id: 'shell_exec',
  name: 'shell_exec',
  description: 'Execute a shell command',
  modelDescription: 'Run a shell command and return its output',
  category: 'shell_process',
  riskLevel: 'high',
  schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  composable: true,
  source: 'builtin',
};

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    expect(registry.has('file_read')).toBe(true);
    expect(registry.get('file_read')).toEqual(mockTool);
  });

  it('returns undefined for unregistered tools', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('lists all tools', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    registry.register(anotherTool);

    const list = registry.list();
    expect(list).toHaveLength(2);
  });

  it('filters by category', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    registry.register(anotherTool);

    const fsList = registry.listByCategory('filesystem');
    expect(fsList).toHaveLength(1);
    expect(fsList[0]!.id).toBe('file_read');
  });

  it('filters by risk level', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    registry.register(anotherTool);

    const high = registry.listByRiskLevel('high');
    expect(high).toHaveLength(1);
    expect(high[0]!.id).toBe('shell_exec');
  });

  it('converts to schemas for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    const schemas = registry.toSchemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.type).toBe('function');
    expect(schemas[0]!.function.name).toBe('file_read');
  });
});
