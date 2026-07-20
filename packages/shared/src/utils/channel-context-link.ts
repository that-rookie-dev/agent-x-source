import { isChannelSessionId } from './channel-session.js';

export interface ChannelLinkedMessage {
  role?: string;
  content?: string;
  parts?: unknown;
}

/** Desktop session linked for context when inbound traffic uses a channel session. */
export function resolveChannelLinkedContextSessionId(
  channelSessionId: string,
  linkedSessionId?: string | null,
): string | null {
  if (!isChannelSessionId(channelSessionId)) return null;
  const linked = linkedSessionId?.trim();
  return linked || null;
}

/** Merge linked desktop history before channel messages for continuation resolution. */
export function mergeChannelLinkedMessages(
  linkedMessages: ChannelLinkedMessage[],
  channelMessages: ChannelLinkedMessage[],
): ChannelLinkedMessage[] {
  if (linkedMessages.length === 0) return channelMessages;
  if (channelMessages.length === 0) return linkedMessages;
  return [...linkedMessages, ...channelMessages];
}

/** Resume/outstanding-task persistence from channel surface targets the linked desktop session. */
export function resolveChannelResumeStateSessionId(
  channelSessionId: string,
  linkedSessionId?: string | null,
): string {
  const linked = resolveChannelLinkedContextSessionId(channelSessionId, linkedSessionId);
  return linked ?? channelSessionId;
}
