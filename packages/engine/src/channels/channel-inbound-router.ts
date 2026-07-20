import type { Agent } from '../agent/Agent.js';

export type ChannelInboundAgentResolver = (channelId: string) => Agent | null;

let resolver: ChannelInboundAgentResolver | null = null;

export function setChannelInboundAgentResolver(fn: ChannelInboundAgentResolver | null): void {
  resolver = fn;
}

export function resolveChannelInboundAgent(channelId: string, fallback: Agent | null): Agent | null {
  try {
    return resolver?.(channelId) ?? fallback;
  } catch {
    return fallback;
  }
}
