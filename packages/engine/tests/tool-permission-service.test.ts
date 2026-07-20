import { describe, expect, it } from 'vitest';
import { ToolPermissionService } from '../src/services/tool/ToolPermissionService.js';
import { PermissionManager } from '../src/tools/permissions/PermissionManager.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition, PermissionRule, PermissionHandlerResult } from '@agentx/shared';
import type { ToolPermissionHost } from '../src/services/tool/ToolPermissionService.js';

function buildHost(overrides?: Partial<ToolPermissionHost>): ToolPermissionHost {
  const registry = new ToolRegistry();
  const manager = new PermissionManager();
  return {
    getPermissionManager: () => manager,
    getRegistry: () => registry,
    getPermissionRequestHandler: () => undefined,
    getChannelPermissionRequestHandler: () => undefined,
    getPermissionPromptHook: () => undefined,
    getAlwaysPromptPermissions: () => false,
    getMessagingPermissionMode: () => false,
    getInboundSourceChannel: () => null,
    getSessionRules: () => [],
    getAgentPermissions: () => [],
    getUserConfigRules: () => [],
    ...overrides,
  };
}

function sampleTool(): ToolDefinition {
  return {
    id: 'write_file',
    name: 'write_file',
    description: 'write',
    modelDescription: 'write',
    category: 'filesystem',
    riskLevel: 'high',
    schema: { type: 'object', properties: {} },
    composable: false,
    source: 'builtin',
  };
}

describe('ToolPermissionService', () => {
  it('denies when rule is deny', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'deny' } as PermissionRule,
      ],
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('MODE_RESTRICTED');
  });

  it('allows when rule explicitly allows', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'allow' } as PermissionRule,
      ],
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow');
  });

  it('prompts and returns allow_once', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => 'allow_once';
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => handler,
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow_once');
  });

  it('prompts and grants allow_always', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => 'allow_always';
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getPermissionRequestHandler: () => handler,
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow_always');
    expect(manager.check('write_file', '/project/file.txt')).toBe('allow_always');
  });

  it('prompts and returns instructed denial', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => ({
      type: 'instruct',
      instruction: 'Do not write this file',
    });
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => handler,
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('PERMISSION_INSTRUCTED');
    expect(result.instruction).toBe('Do not write this file');
  });

  it('skips prompt for exempt read-only tools', async () => {
    const registry = new ToolRegistry();
    registry.register({
      ...sampleTool(),
      id: 'web_search',
      name: 'web_search',
      riskLevel: 'low',
    });
    const service = new ToolPermissionService();
    const host = buildHost({ getRegistry: () => registry });

    const result = await service.requestPermission(host, 'web_search', {}, 'session', '*');
    expect(result.decision).toBe('allow');
  });

  it('caches existing allow_always grants', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    manager.grant('write_file', 'allow_always', '/project/file.txt');
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getPermissionRequestHandler: () => async () => 'allow_once',
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow');
  });

  it('denies risky tools when no permission handler is wired (fail closed)', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => undefined,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'ask' } as PermissionRule,
      ],
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('PERMISSION_DENIED');
  });
});
