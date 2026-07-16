import { describe, expect, it } from 'vitest';
import {
  integrationToolsForProvider,
  reconcileIntegrationHintWithActiveTools,
  resolveProviderToolAvailability,
} from '../src/integrations/integration-tool-availability.js';

describe('integration-tool-availability', () => {
  it('lists tools for any MCP provider id prefix', () => {
    const ids = [
      'integration__gmail__search_emails',
      'integration__notion__query_database',
      'integration__my-custom-mcp__list_items',
      'file_read',
    ];
    expect(integrationToolsForProvider(ids, 'gmail')).toEqual(['integration__gmail__search_emails']);
    expect(integrationToolsForProvider(ids, 'notion')).toEqual(['integration__notion__query_database']);
    expect(integrationToolsForProvider(ids, 'my-custom-mcp')).toEqual(['integration__my-custom-mcp__list_items']);
  });

  it('requires handlers and registry tools for toolsReady', () => {
    expect(resolveProviderToolAvailability(
      { providerId: 'slack', handlersReady: false },
      ['integration__slack__post_message'],
    )).toMatchObject({ toolsReady: false, degradedReason: 'no_handlers' });

    expect(resolveProviderToolAvailability(
      { providerId: 'slack', handlersReady: true },
      [],
    )).toMatchObject({ toolsReady: false, degradedReason: 'no_registry_tools' });

    expect(resolveProviderToolAvailability(
      { providerId: 'slack', handlersReady: true },
      ['integration__slack__post_message'],
    )).toMatchObject({ toolsReady: true, availableToolIds: ['integration__slack__post_message'] });
  });

  it('downgrades SERVICE hints when tools are filtered from the active toolset', () => {
    const hint = [
      '[INTEGRATION SERVICE] Notion MCP is connected for this third-party app request.',
      'Active tools this turn: integration__notion__search.',
      'Call one of these tools now — only use names from your active toolset.',
    ].join(' ');
    const policy = {
      hintKind: 'service' as const,
      reason: 'test',
      providerIds: ['notion'],
      blockLocalExploration: true,
    };

    const reconciled = reconcileIntegrationHintWithActiveTools(hint, policy, ['file_read', 'web_search']);
    expect(reconciled.hint).toContain('INTEGRATION DEGRADED');
    expect(reconciled.hint).toContain('active toolset');
    expect(reconciled.policy?.hintKind).toBe('degraded');
  });

  it('refreshes active tool list after permission filtering', () => {
    const hint = '[INTEGRATION SERVICE] Gmail MCP is connected. Active tools this turn: integration__gmail__send_email, integration__gmail__read_email.';
    const policy = {
      hintKind: 'service' as const,
      reason: 'test',
      providerIds: ['gmail'],
      blockLocalExploration: true,
    };

    const reconciled = reconcileIntegrationHintWithActiveTools(
      hint,
      policy,
      ['integration__gmail__read_email', 'file_read'],
    );
    expect(reconciled.hint).toContain('integration__gmail__read_email');
    expect(reconciled.hint).not.toContain('send_email');
    expect(reconciled.policy?.hintKind).toBe('service');
  });
});
