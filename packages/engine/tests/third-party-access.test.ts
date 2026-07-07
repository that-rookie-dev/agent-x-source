import { describe, expect, it } from 'vitest';
import {
  detectMentionedCatalogProviders,
  detectThirdPartyServiceIntent,
  resolveThirdPartyAccess,
} from '../src/integrations/third-party-access.js';

describe('third-party-access', () => {
  const emptySnapshot = { connected: [], unavailable: [] };
  const catalog = [
    { id: 'gmail', name: 'Gmail' },
    { id: 'notion', name: 'Notion' },
    { id: 'slack', name: 'Slack' },
  ];

  it('resolves integration required for email without connections', () => {
    const result = resolveThirdPartyAccess({
      userText: 'check my emails',
      snapshot: emptySnapshot,
      catalog,
    });
    expect(result.promptHint).toContain('INTEGRATION REQUIRED');
    expect(result.policy?.blockLocalExploration).toBe(true);
  });

  it('detects catalog provider mentions with account language', () => {
    const ids = detectMentionedCatalogProviders('sync my notion workspace account', catalog);
    expect(ids).toContain('notion');
  });

  it('does not flag local coding requests', () => {
    expect(detectThirdPartyServiceIntent('refactor the auth module')).toBeNull();
    const result = resolveThirdPartyAccess({
      userText: 'fix the typescript error in src/api.ts',
      snapshot: emptySnapshot,
      catalog,
    });
    expect(result.policy).toBeUndefined();
  });

  it('degrades when handlers exist but registry has no integration tools', () => {
    const result = resolveThirdPartyAccess({
      userText: 'check my gmail inbox',
      snapshot: {
        connected: [{
          providerId: 'gmail',
          name: 'Gmail',
          toolCount: 2,
          handlersReady: true,
        }],
        unavailable: [],
      },
      catalog,
      registeredIntegrationToolIds: [],
    });
    expect(result.promptHint).toContain('INTEGRATION DEGRADED');
    expect(result.promptHint).not.toContain('INTEGRATION SERVICE');
  });

  it('emits service hint only when tools are in registry', () => {
    const result = resolveThirdPartyAccess({
      userText: 'check my gmail inbox',
      snapshot: {
        connected: [{
          providerId: 'gmail',
          name: 'Gmail',
          toolCount: 2,
          handlersReady: true,
        }],
        unavailable: [],
      },
      catalog,
      registeredIntegrationToolIds: ['integration__gmail__search_emails'],
    });
    expect(result.promptHint).toContain('INTEGRATION SERVICE');
    expect(result.promptHint).toContain('integration__gmail__search_emails');
  });
});
