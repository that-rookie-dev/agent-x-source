import { describe, it, expect } from 'vitest';
import { ClarificationHandler } from '../../../src/adapter/ClarificationHandler';

describe('ClarificationHandler', () => {
  it('handle does nothing when no engine attached', async () => {
    const handler = new ClarificationHandler();
    await handler.handle({ question: 'test', options: ['a', 'b'], allowFreeform: true });
  });

  it('dispose does not throw', () => {
    const handler = new ClarificationHandler();
    expect(() => handler.dispose()).not.toThrow();
  });
});
