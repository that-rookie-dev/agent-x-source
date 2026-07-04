import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { CHANNEL_SESSION_ID } from '@agentx/shared';
import { getChannelPermissionBridge } from '../../channels/channel-permission-bridge.js';

export async function channelPermissions(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (context.sessionId !== CHANNEL_SESSION_ID) {
    return { success: false, output: 'channel_permissions is only available on messaging channel sessions.', error: 'CHANNEL_ONLY' };
  }

  const bridge = getChannelPermissionBridge(context.sessionId);
  if (!bridge) {
    return { success: false, output: 'Channel permission bridge is not available.', error: 'NO_BRIDGE' };
  }

  const action = String(args['action'] ?? 'list').toLowerCase();
  if (action === 'list' || action === 'show') {
    return { success: true, output: bridge.list() };
  }

  if (action === 'revoke') {
    const revokeAll = args['revoke_all'] === true || args['all'] === true;
    const toolsRaw = args['tools'];
    const tools = Array.isArray(toolsRaw)
      ? toolsRaw.map((t) => String(t))
      : typeof toolsRaw === 'string'
        ? toolsRaw.split(/[,\s]+/).filter(Boolean)
        : undefined;
    return { success: true, output: bridge.revoke(tools, revokeAll) };
  }

  return {
    success: false,
    output: 'Unknown action. Use action: "list" or "revoke" (with tools[] or revoke_all:true).',
    error: 'INVALID_ACTION',
  };
}
