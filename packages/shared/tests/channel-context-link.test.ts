import { describe, expect, it } from 'vitest';
import { channelSessionIdForBinding } from '../src/utils/channel-session.js';
import {
  mergeChannelLinkedMessages,
  resolveChannelLinkedContextSessionId,
  resolveChannelResumeStateSessionId,
} from '../src/utils/channel-context-link.js';

describe('channel context link', () => {
  it('resolves linked desktop session for per-channel ids', () => {
    const telegram = channelSessionIdForBinding('telegram');
    const slack = channelSessionIdForBinding('slack');
    expect(resolveChannelLinkedContextSessionId(telegram, 'parent-1')).toBe('parent-1');
    expect(resolveChannelLinkedContextSessionId(slack, 'parent-2')).toBe('parent-2');
    expect(resolveChannelLinkedContextSessionId(telegram, null)).toBeNull();
    expect(resolveChannelLinkedContextSessionId('desktop-sess', 'parent-1')).toBeNull();
  });

  it('routes resume state to linked parent per channel', () => {
    expect(resolveChannelResumeStateSessionId(channelSessionIdForBinding('telegram'), 'parent-1')).toBe('parent-1');
    expect(resolveChannelResumeStateSessionId(channelSessionIdForBinding('slack'), null)).toBe('__channel__:slack');
  });

  it('merges linked then channel messages for continuation', () => {
    const merged = mergeChannelLinkedMessages(
      [{ role: 'user', content: 'gold rate automation' }],
      [{ role: 'user', content: 'try again' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.content).toBe('gold rate automation');
    expect(merged[1]?.content).toBe('try again');
  });
});
