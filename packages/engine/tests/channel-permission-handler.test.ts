import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { CHANNEL_SESSION_ID, channelSessionIdForBinding } from '@agentx/shared';

describe('channel permission handler routing', () => {
  it('uses channel handler for __channel__ session without replacing UI handler', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'shell_exec',
      name: 'Shell',
      description: 'Run shell',
      modelDescription: 'Run shell',
      category: 'shell',
      riskLevel: 'medium',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
    });

    const executor = new ToolExecutor(registry, process.cwd());
    executor.registerHandler('shell_exec', async () => ({ success: true, output: 'ok' }));

    const uiHandler = vi.fn(async () => 'deny' as const);
    const channelHandler = vi.fn(async () => 'allow_once' as const);
    executor.setPermissionRequestHandler(uiHandler);
    executor.setChannelPermissionRequestHandler(channelHandler);

    const result = await executor.execute('shell_exec', {}, CHANNEL_SESSION_ID);
    expect(result.success).toBe(true);
    expect(channelHandler).toHaveBeenCalledTimes(1);
    expect(uiHandler).not.toHaveBeenCalled();

    uiHandler.mockClear();
    channelHandler.mockClear();
    const uiResult = await executor.execute('shell_exec', {}, 'normal-session');
    expect(uiResult.success).toBe(false);
    expect(uiHandler).toHaveBeenCalledTimes(1);
    expect(channelHandler).not.toHaveBeenCalled();
  });

  it('uses channel handler for per-channel super-sessions when messaging mode is on', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'shell_exec',
      name: 'Shell',
      description: 'Run shell',
      modelDescription: 'Run shell',
      category: 'shell',
      riskLevel: 'medium',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
    });

    const executor = new ToolExecutor(registry, process.cwd());
    executor.registerHandler('shell_exec', async () => ({ success: true, output: 'ok' }));

    const uiHandler = vi.fn(async () => 'deny' as const);
    const channelHandler = vi.fn(async () => 'allow_once' as const);
    executor.setPermissionRequestHandler(uiHandler);
    executor.setChannelPermissionRequestHandler(channelHandler);
    executor.setMessagingPermissionMode(true);

    const slackSession = channelSessionIdForBinding('slack');
    const result = await executor.execute('shell_exec', {}, slackSession);
    expect(result.success).toBe(true);
    expect(channelHandler).toHaveBeenCalledTimes(1);
    expect(uiHandler).not.toHaveBeenCalled();
  });
});
