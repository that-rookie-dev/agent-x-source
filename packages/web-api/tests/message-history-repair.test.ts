import { describe, expect, it } from 'vitest';
import { healOrphanedUserMessages } from '../src/message-history-repair.js';

describe('healOrphanedUserMessages', () => {
  it('re-inserts a missing user turn before an orphaned assistant reply from checkpoints', () => {
    const user = {
      id: 'user-1',
      role: 'user',
      content: 'Plan a winter time vacation for my family',
    };
    const assistant = {
      id: 'asst-1',
      role: 'assistant',
      content: 'Wait—Siva, I need to pump the brakes here. That feedback flag got me wrong.',
    };

    const healed = healOrphanedUserMessages(
      [assistant],
      [[user, assistant]],
    );

    expect(healed).toHaveLength(2);
    expect(healed[0]?.role).toBe('user');
    expect(healed[0]?.content).toContain('winter time vacation');
    expect(healed[1]?.role).toBe('assistant');
  });

  it('leaves valid user/assistant pairs unchanged', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: 'hi there' },
    ];
    const healed = healOrphanedUserMessages(messages, []);
    expect(healed).toBe(messages);
  });
});
