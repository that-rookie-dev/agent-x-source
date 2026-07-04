import { describe, it, expect } from 'vitest';
import { ProgressiveDisclosure, shouldDisclose, getCoreTools, createBridgeTools, resolveBridgeToolCall } from '../src/tools/ProgressiveDisclosure.js';
import type { ToolDefinition } from '@agentx/shared';

const makeTool = (id: string): ToolDefinition => ({
  id, name: id, description: `Tool ${id}`, modelDescription: `Does ${id}`,
  category: 'ai_meta', riskLevel: 'low', schema: { type: 'object', properties: {} },
  composable: false, source: 'builtin',
});

describe('ProgressiveDisclosure', () => {
  it('returns false when under threshold', () => {
    expect(shouldDisclose(30)).toBe(false);
  });

  it('returns true when over threshold', () => {
    expect(shouldDisclose(50)).toBe(true);
  });

  it('identifies core tools by pattern', () => {
    const tools = [makeTool('file_read'), makeTool('shell_exec'), makeTool('deploy_k8s')];
    const core = getCoreTools(tools);
    expect(core.map((t) => t.id)).toContain('file_read');
    expect(core.map((t) => t.id)).toContain('shell_exec');
    expect(core.map((t) => t.id)).not.toContain('deploy_k8s');
  });

  it('creates three bridge tools', () => {
    const bridges = createBridgeTools();
    expect(bridges).toHaveLength(3);
    const names = bridges.map((b) => b.id);
    expect(names).toContain('tool_search');
    expect(names).toContain('tool_describe');
    expect(names).toContain('tool_call');
  });

  it('resolves tool_call to actual tool', () => {
    const tools = [makeTool('file_read')];
    const result = resolveBridgeToolCall('tool_call', { tool: 'file_read', arguments: { path: 'test.ts' } }, tools);
    expect(result.resolved).toBeTruthy();
    expect(result.resolved!.id).toBe('file_read');
  });

  it('returns error for unknown tool in tool_call', () => {
    const result = resolveBridgeToolCall('tool_call', { tool: 'nonexistent', arguments: {} }, []);
    expect(result.resolved).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('resolves tool_describe for known tool', () => {
    const tools = [makeTool('file_read')];
    const result = resolveBridgeToolCall('tool_describe', { tool: 'file_read' }, tools);
    expect(result.resolvedArgs['schema']).toBeTruthy();
  });
});
