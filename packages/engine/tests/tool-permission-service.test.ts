import { describe, expect, it, vi } from 'vitest';
import { ToolPermissionService, summarizeToolAction } from '../src/services/tool/ToolPermissionService.js';
import { PermissionManager } from '../src/tools/permissions/PermissionManager.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition, PermissionRule, PermissionHandlerResult } from '@agentx/shared';
import type { ToolPermissionHost, PermissionOutcomeEmit } from '../src/services/tool/ToolPermissionService.js';

function buildHost(overrides?: Partial<ToolPermissionHost>): ToolPermissionHost {
  const registry = new ToolRegistry();
  const manager = new PermissionManager();
  return {
    getPermissionManager: () => manager,
    getRegistry: () => registry,
    getPermissionRequestHandler: () => undefined,
    getChannelPermissionRequestHandler: () => undefined,
    getPermissionPromptHook: () => undefined,
    getAlwaysPromptPermissions: () => false,
    getMessagingPermissionMode: () => false,
    getInboundSourceChannel: () => null,
    getSessionRules: () => [],
    getAgentPermissions: () => [],
    getUserConfigRules: () => [],
    ...overrides,
  };
}

function sampleTool(): ToolDefinition {
  return {
    id: 'write_file',
    name: 'write_file',
    description: 'write',
    modelDescription: 'write',
    category: 'filesystem',
    riskLevel: 'high',
    schema: { type: 'object', properties: {} },
    composable: false,
    source: 'builtin',
  };
}

describe('ToolPermissionService', () => {
  it('denies when rule is deny', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'deny' } as PermissionRule,
      ],
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('MODE_RESTRICTED');
  });

  it('allows when rule explicitly allows', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'allow' } as PermissionRule,
      ],
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow');
  });

  it('clarify-first then prompts and returns allow_once', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => 'allow_once';
    const outcomes: PermissionOutcomeEmit[] = [];
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => handler,
      requestActionConsent: async () => ({ proceed: true, answer: 'Yes' }),
      grantToolConsent: () => {},
      emitPermissionOutcome: (o) => outcomes.push(o),
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow_once');
    expect(outcomes.some((o) => o.decision === 'allow_once')).toBe(true);
  });

  it('declines when user says No on clarify-first questionnaire', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    let prompted = 0;
    const outcomes: PermissionOutcomeEmit[] = [];
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => async () => {
        prompted += 1;
        return 'allow_once';
      },
      requestActionConsent: async () => ({ proceed: false, answer: 'No' }),
      emitPermissionOutcome: (o) => outcomes.push(o),
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(prompted).toBe(0);
    expect(result.decision).toBe('deny');
    expect(outcomes[0]?.decision).toBe('declined_consent');
  });

  it('prompts and grants allow_always after consent', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => 'allow_always';
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getPermissionRequestHandler: () => handler,
      requestActionConsent: async () => ({ proceed: true }),
      grantToolConsent: () => {},
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow_always');
    expect(manager.check('write_file', '/project/file.txt')).toBe('allow_always');
  });

  it('prompts and returns instructed denial', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const handler = async (): Promise<PermissionHandlerResult> => ({
      type: 'instruct',
      instruction: 'Do not write this file',
    });
    const outcomes: PermissionOutcomeEmit[] = [];
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => handler,
      requestActionConsent: async () => ({ proceed: true }),
      grantToolConsent: () => {},
      emitPermissionOutcome: (o) => outcomes.push(o),
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('PERMISSION_INSTRUCTED');
    expect(result.instruction).toBe('Do not write this file');
    expect(outcomes[0]?.decision).toBe('instructed');
  });

  it('skips prompt for exempt read-only tools', async () => {
    const registry = new ToolRegistry();
    registry.register({
      ...sampleTool(),
      id: 'web_search',
      name: 'web_search',
      riskLevel: 'low',
    });
    const service = new ToolPermissionService();
    const host = buildHost({ getRegistry: () => registry });

    const result = await service.requestPermission(host, 'web_search', {}, 'session', '*');
    expect(result.decision).toBe('allow');
  });

  it('caches existing allow_always grants', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    manager.grant('write_file', 'allow_always', '/project/file.txt');
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getPermissionRequestHandler: () => async () => 'allow_once',
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('allow');
  });

  it('denies risky tools when no permission handler is wired (fail closed)', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => undefined,
      getAgentPermissions: () => [
        { action: 'tool:write_file', pattern: '*', effect: 'ask' } as PermissionRule,
      ],
      requestActionConsent: async () => ({ proceed: true }),
      grantToolConsent: () => {},
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('PERMISSION_DENIED');
  });

  it('skips clarify questionnaire when turn consent already recorded, still shows modal', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    const service = new ToolPermissionService();
    let consentCalls = 0;
    let prompted = 0;
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getPermissionRequestHandler: () => async () => {
        prompted += 1;
        return 'allow_once';
      },
      getPendingToolConsent: () => new Set(['write_file']),
      requestActionConsent: async () => {
        consentCalls += 1;
        return { proceed: true };
      },
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(consentCalls).toBe(0);
    expect(prompted).toBe(1);
    expect(result.decision).toBe('allow_once');
  });

  it('serializes: second concurrent permission is denied while first is in flight', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    let releaseConsent!: (v: { proceed: boolean }) => void;
    const consentGate = new Promise<{ proceed: boolean }>((resolve) => {
      releaseConsent = resolve;
    });
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionRequestHandler: () => async () => 'allow_once',
      requestActionConsent: async () => consentGate,
      grantToolConsent: () => {},
    });

    const first = service.requestPermission(host, 'write_file', { path: 'a.txt' }, 'session', 'a.txt');
    // Let the first flow acquire flowBusy
    await Promise.resolve();
    const second = await service.requestPermission(host, 'write_file', { path: 'b.txt' }, 'session', 'b.txt');
    expect(second.decision).toBe('deny');
    expect(second.instruction).toMatch(/only one permission/i);

    releaseConsent({ proceed: true });
    const firstResult = await first;
    expect(firstResult.decision).toBe('allow_once');
  });

  it('summarizeToolAction describes file writes clearly', () => {
    expect(summarizeToolAction('file_write', { path: 'plan.md' }, sampleTool())).toContain('write a file');
  });

  it('denies low-risk proactive save_to_article without user consent', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'save_to_article',
      name: 'Save to Articles',
      description: 'save',
      modelDescription: 'save',
      category: 'documents',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    const manager = new PermissionManager();
    manager.setBypassPermissions(false);
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getCurrentUserMessage: () => 'Analyse TVK and summarise the findings',
    });

    const result = await service.requestPermission(host, 'save_to_article', { title: 'TVK' }, 'session');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('PERMISSION_INSTRUCTED');
    expect(result.instruction).toMatch(/plain-text question/i);
  });

  it('allows save_to_article when user explicitly requested a save', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'save_to_article',
      name: 'Save to Articles',
      description: 'save',
      modelDescription: 'save',
      category: 'documents',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    const manager = new PermissionManager();
    manager.setBypassPermissions(false);
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getCurrentUserMessage: () => 'Please save this analysis as an article',
    });

    const result = await service.requestPermission(host, 'save_to_article', { title: 'TVK' }, 'session');
    expect(result.decision).toBe('allow');
  });

  it('allows save_to_article after a short spoken yes-please', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'save_to_article',
      name: 'Save to Articles',
      description: 'save',
      modelDescription: 'save',
      category: 'documents',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    const manager = new PermissionManager();
    manager.setBypassPermissions(false);
    const service = new ToolPermissionService();
    const consented = new Set(['save_to_article']);
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getVoiceTurnActive: () => true,
      getPendingToolConsent: () => consented,
      getCurrentUserMessage: () => 'Yes, please.',
    });

    const result = await service.requestPermission(host, 'save_to_article', { title: 'MVP Scope' }, '__channel__:voice');
    expect(result.decision).toBe('allow');
  });

  it('allows save_to_article when session waived low-risk consent', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'save_to_article',
      name: 'Save to Articles',
      description: 'save',
      modelDescription: 'save',
      category: 'documents',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    const manager = new PermissionManager();
    manager.setBypassPermissions(false);
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getSkipLowRiskProactiveConsent: () => true,
      getCurrentUserMessage: () => 'Continue the analysis',
    });

    const result = await service.requestPermission(host, 'save_to_article', { title: 'TVK' }, 'session');
    expect(result.decision).toBe('allow');
  });

  it('allows save_to_article under bypass without asking', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'save_to_article',
      name: 'Save to Articles',
      description: 'save',
      modelDescription: 'save',
      category: 'documents',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    const manager = new PermissionManager();
    manager.setBypassPermissions(true);
    const service = new ToolPermissionService();
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getCurrentUserMessage: () => 'Analyse this',
    });

    const result = await service.requestPermission(host, 'save_to_article', { title: 'TVK' }, 'session');
    expect(result.decision).toBe('allow');
  });

  it('voice turn ignores persisted allow_always and still prompts', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    manager.grant('write_file', 'allow_always', '/project/file.txt');
    const service = new ToolPermissionService();
    let prompted = 0;
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getVoiceTurnActive: () => true,
      getPermissionRequestHandler: () => async () => {
        prompted += 1;
        return 'allow_once';
      },
      grantToolConsent: () => {},
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(prompted).toBe(1);
    expect(result.decision).toBe('allow_once');
  });

  it('voice turn honors this-turn consent without prompting again', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const service = new ToolPermissionService();
    let prompted = 0;
    const host = buildHost({
      getRegistry: () => registry,
      getVoiceTurnActive: () => true,
      getPendingToolConsent: () => new Set(['write_file']),
      getPermissionRequestHandler: () => async () => {
        prompted += 1;
        return 'allow_once';
      },
    });

    const result = await service.requestPermission(host, 'write_file', {}, 'session', '/project/file.txt');
    expect(prompted).toBe(0);
    expect(result.decision).toBe('allow');
  });

  it('voice turn allows concurrent permission asks', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    registry.register({ ...sampleTool(), id: 'shell_exec', name: 'shell_exec' });
    const service = new ToolPermissionService();
    let release!: (v: PermissionHandlerResult) => void;
    const gate = new Promise<PermissionHandlerResult>((resolve) => {
      release = resolve;
    });
    let prompted = 0;
    const host = buildHost({
      getRegistry: () => registry,
      getVoiceTurnActive: () => true,
      getPermissionRequestHandler: () => async () => {
        prompted += 1;
        return gate;
      },
      grantToolConsent: () => {},
    });

    const first = service.requestPermission(host, 'write_file', { path: 'a.txt' }, 'session', 'a.txt');
    const second = service.requestPermission(host, 'shell_exec', { command: 'ls' }, 'session', '*');
    await vi.waitFor(() => expect(prompted).toBe(2));

    release('allow_once');
    const [a, b] = await Promise.all([first, second]);
    expect(a.decision).toBe('allow_once');
    expect(b.decision).toBe('allow_once');
  });

  it('voice turn ignores bypass and never uses the channel UI handler', async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool());
    const manager = new PermissionManager();
    manager.setBypassPermissions(true);
    const service = new ToolPermissionService();
    let voiceHandler = 0;
    let channelHandler = 0;
    let consentCalls = 0;
    const host = buildHost({
      getRegistry: () => registry,
      getPermissionManager: () => manager,
      getVoiceTurnActive: () => true,
      getPermissionRequestHandler: () => async () => {
        voiceHandler += 1;
        return 'allow_once';
      },
      getChannelPermissionRequestHandler: () => async () => {
        channelHandler += 1;
        return 'deny';
      },
      requestActionConsent: async () => {
        consentCalls += 1;
        return { proceed: true };
      },
      grantToolConsent: () => {},
    });

    const result = await service.requestPermission(
      host,
      'write_file',
      {},
      '__channel__:voice',
      '/project/file.txt',
    );
    expect(result.decision).toBe('allow_once');
    expect(voiceHandler).toBe(1);
    expect(channelHandler).toBe(0);
    expect(consentCalls).toBe(0);
  });
});
