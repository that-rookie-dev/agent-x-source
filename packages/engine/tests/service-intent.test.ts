import { describe, expect, it } from 'vitest';
import { detectThirdPartyServiceIntent } from '../src/integrations/third-party-access.js';

describe('service-intent', () => {
  it('detects email and gmail inbox queries', () => {
    expect(detectThirdPartyServiceIntent('are there any unread emails in my gmail?')?.category).toBe('email');
    expect(detectThirdPartyServiceIntent('check my emails and let me know about it')?.providerIds).toContain('gmail');
  });

  it('does not flag local file or coding requests', () => {
    expect(detectThirdPartyServiceIntent('read src/index.ts')).toBeNull();
    expect(detectThirdPartyServiceIntent('fix the bug in my react app')).toBeNull();
    expect(detectThirdPartyServiceIntent('what is quantum computing')).toBeNull();
  });

  it('detects slack and notion service requests', () => {
    expect(detectThirdPartyServiceIntent('post a message to slack')?.category).toBe('slack');
    expect(detectThirdPartyServiceIntent('find my notion page about roadmap')?.category).toBe('notion');
  });
});
