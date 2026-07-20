import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { isPermissionExemptTool } from '../src/tools/permissions/exempt-tools.js';
import { channelSessionIdForBinding } from '@agentx/shared';

describe('automation tool permissions', () => {
  it('exempts automation_register and automation_list from interactive prompts', () => {
    expect(isPermissionExemptTool('automation_register')).toBe(true);
    expect(isPermissionExemptTool('automation_list')).toBe(true);
    expect(isPermissionExemptTool('automation_cancel')).toBe(false);
  });

  it('does not prompt for automation_register on channel sessions', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'automation_register',
      name: 'Register Automation',
      description: 'Register',
      modelDescription: 'Register',
      category: 'scheduler',
      riskLevel: 'medium',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
    });

    const executor = new ToolExecutor(registry, process.cwd());
    executor.registerHandler('automation_register', async () => ({ success: true, output: 'ok' }));

    const channelHandler = vi.fn(async () => 'deny' as const);
    executor.setChannelPermissionRequestHandler(channelHandler);

    const result = await executor.execute(
      'automation_register',
      {},
      channelSessionIdForBinding('telegram'),
    );
    expect(result.success).toBe(true);
    expect(channelHandler).not.toHaveBeenCalled();
  });

  it('prompts for automation_cancel on channel sessions', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'automation_cancel',
      name: 'Cancel Automation',
      description: 'Cancel',
      modelDescription: 'Cancel',
      category: 'scheduler',
      riskLevel: 'medium',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
    });

    const executor = new ToolExecutor(registry, process.cwd());
    executor.registerHandler('automation_cancel', async () => ({ success: true, output: 'ok' }));

    const channelHandler = vi.fn(async () => 'allow_once' as const);
    executor.setChannelPermissionRequestHandler(channelHandler);

    const result = await executor.execute(
      'automation_cancel',
      {},
      channelSessionIdForBinding('telegram'),
    );
    expect(result.success).toBe(true);
    expect(channelHandler).toHaveBeenCalledTimes(1);
  });
});
