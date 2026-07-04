export interface ChannelPermissionBridge {
  list: () => string;
  revoke: (tools?: string[], revokeAll?: boolean) => string;
}

const bridges = new Map<string, ChannelPermissionBridge>();

export function registerChannelPermissionBridge(sessionId: string, bridge: ChannelPermissionBridge): void {
  bridges.set(sessionId, bridge);
}

export function unregisterChannelPermissionBridge(sessionId: string): void {
  bridges.delete(sessionId);
}

export function getChannelPermissionBridge(sessionId: string): ChannelPermissionBridge | null {
  return bridges.get(sessionId) ?? null;
}
