import { describe, it, expect } from 'vitest';
import { RuntimeCapabilityManager } from '../../src/synthetic/RuntimeCapabilityManager.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { CapabilitySandboxResult } from '@agentx/shared';

const pass: CapabilitySandboxResult = {
  passed: true, stdout: 'ok', stderr: '', exitCode: 0, warnings: [], detectedSideEffects: [], executionTimeMs: 1,
};

describe('RuntimeCapabilityManager', () => {
  it('creates a user-prompt skill, approves it, and injects it into the prompt block', async () => {
    const store = new InMemoryCapabilityStore();
    const mgr = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: {
        runTool: async () => pass,
        validateSideEffects: async () => [],
        estimateRisk: async () => 'low',
      },
      config: { syntheticIntelligence: { enabled: false, allowUserPromptGeneration: true } } as never,
    });
    await mgr.initialize();
    expect(mgr.getPromptBlock()).toBe('');

    const proposal = await mgr.generateFromUserPrompt(
      'Whenever I paste a meeting transcript, summarize it into action items',
      { kind: 'skill', actor: 'user' },
    );
    expect(proposal?.proposedCapability.kind).toBe('skill');
    expect(proposal?.proposedCapability.origin).toBe('user-prompt');
    expect(proposal?.proposedCapability.status).toBe('proposed');

    await mgr.approveForRegistration(proposal!.proposedCapability.id, 'user');
    const registered = await mgr.getCapability(proposal!.proposedCapability.id);
    expect(registered?.status).toBe('registered');
    expect(mgr.getPromptBlock()).toContain('[trigger:');
    expect(mgr.getPromptBlock()).toContain('not Executable Skill');
  });

  it('rejects generation when allowUserPromptGeneration is false', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: false } } as never,
    });
    await expect(mgr.generateFromUserPrompt('make a skill')).rejects.toThrow(/disabled/);
  });

  it('does not register a generated tool without sandbox success', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: async () => JSON.stringify({
        name: 'csv-json',
        description: 'csv to json',
        language: 'javascript',
        sourceCode: 'function run(args) { return args; }',
        entryPoint: 'run',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {},
        dependencies: [],
        sideEffects: [],
      }),
      sandbox: {
        runTool: async () => ({ ...pass, passed: false, exitCode: 1, stderr: 'boom' }),
        validateSideEffects: async () => [],
        estimateRisk: async () => 'low',
      },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true } } as never,
    });
    const proposal = await mgr.generateFromUserPrompt('create a tool that converts CSV to JSON', { kind: 'tool' });
    expect(proposal?.proposedCapability.kind).toBe('tool');
    await expect(mgr.approveForRegistration(proposal!.proposedCapability.id, 'user')).rejects.toThrow(/Sandbox failed/);
  });

  it('records audit events for approve/disable', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true } } as never,
    });
    const proposal = await mgr.generateFromUserPrompt('A detailed skill for writing weekly status reports with blockers first', { kind: 'skill' });
    const id = proposal!.proposedCapability.id;
    await mgr.approveForRegistration(id, 'user:root');
    await mgr.disableCapability(id, 'user:root');
    const audit = await mgr.getAuditLog(id);
    expect(audit.map((e) => e.event)).toEqual(expect.arrayContaining(['proposed', 'registered', 'disabled']));
  });

  it('never auto-approves high-risk tools as system', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: async () => JSON.stringify({
        name: 'net-tool',
        description: 'hits the network',
        language: 'javascript',
        sourceCode: 'function run(){ return fetch("https://example.com"); }',
        entryPoint: 'run',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {},
        dependencies: [],
        sideEffects: ['network'],
      }),
      sandbox: {
        runTool: async () => pass,
        validateSideEffects: async () => ['network'],
        estimateRisk: async () => 'high',
      },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true, autoGraduateTools: true } } as never,
    });
    const proposal = await mgr.generateFromUserPrompt('create a tool that fetches a url', { kind: 'tool' });
    await expect(mgr.approveForRegistration(proposal!.proposedCapability.id, 'system')).rejects.toThrow(/never auto-approve/);
  });

  it('auto-promotes a trial when trialAutoPromote is true and max uses are reached', async () => {
    const store = new InMemoryCapabilityStore();
    const mgr = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { enabled: false, trialAutoPromote: true, trialMaxUses: 3, trialDurationMs: 0 } } as never,
    });
    await mgr.initialize();
    const cap = {
      id: 'cap_trial', kind: 'tool' as const, name: 'auto-tool', description: 'auto', createdAt: Date.now(), updatedAt: Date.now(),
      createdBy: 't', sourceSessionId: '', version: 1, origin: 'observed' as const, status: 'in-trial' as const,
      useCount: 0, trialCount: 3, language: 'javascript' as const, sourceCode: 'function run(args){return args}', entryPoint: 'run',
      inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
    };
    await store.insertCapability(cap);
    await store.upsertGates(cap.id, [
      { gate: 'sandbox', status: 'passed', passedAt: Date.now(), passedBy: 'system', notes: '' },
      { gate: 'trial', status: 'passed', passedAt: Date.now(), passedBy: 'system', notes: '' },
      { gate: 'user-approval', status: 'pending', passedAt: null, passedBy: null, notes: '' },
    ]);
    await mgr.sweepTrials();
    const promoted = await mgr.getCapability(cap.id);
    expect(promoted?.status).toBe('registered');
  });

  it('prepareTurn injects a capability-create note for explicit intents', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true } } as never,
    });
    const note = await mgr.prepareTurn('Create a reusable skill for weekly status reports with blockers first', 'sess-1');
    expect(note).toContain('CAPABILITY CREATE');
    expect(note).toContain('not an Executable Skill');
  });

  it('skips autonomous generate when consent is deny and generates when always', async () => {
    const deny = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { enabled: true, generationConsent: 'deny', deprecationSweepMs: 0 } } as never,
    });
    await deny.initialize();
    await deny.observeTurn({
      sessionId: 's',
      userText: 'format logs',
      tools: [
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
      ],
    });
    expect((await deny.getAllCapabilities()).filter((c) => c.status === 'proposed')).toHaveLength(0);
    await deny.shutdown();

    const always = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { enabled: true, generationConsent: 'always', deprecationSweepMs: 0 } } as never,
    });
    await always.initialize();
    await always.observeTurn({
      sessionId: 's',
      userText: 'format logs',
      tools: [
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
      ],
    });
    expect((await always.getAllCapabilities()).length).toBeGreaterThan(0);
    await always.shutdown();
  });

  it('emits a per-pattern consent prompt when consent is once and does not auto-generate', async () => {
    const store = new InMemoryCapabilityStore();
    const seen: { event: string; payload: unknown }[] = [];
    const once = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { enabled: true, generationConsent: 'once', deprecationSweepMs: 0 } } as never,
    });
    once.on('capability-event', (payload) => { seen.push({ event: payload.event, payload }); });
    await once.initialize();
    await once.observeTurn({
      sessionId: 's',
      userText: 'format logs',
      tools: [
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
      ],
    });
    expect((await once.getAllCapabilities()).length).toBe(0);
    expect(seen.some((e) => (e.payload as any).reason === 'pattern-consent-required')).toBe(true);
    await once.shutdown();
  });

  it('permanently denies autonomous generation', async () => {
    const store = new InMemoryCapabilityStore();
    const deny = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { enabled: true, generationConsent: 'deny-permanently', deprecationSweepMs: 0 } } as never,
    });
    await deny.initialize();
    await deny.observeTurn({
      sessionId: 's',
      userText: 'format logs',
      tools: [
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
      ],
    });
    expect((await deny.getAllCapabilities()).filter((c) => c.status === 'proposed')).toHaveLength(0);
    await deny.shutdown();
  });

  it('persists pattern audit events and lowers confidence after repeated rejection', async () => {
    const store = new InMemoryCapabilityStore();
    const mgr = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true } } as never,
    });
    const observed = await mgr.reportObservation('repeated tool shell_exec', 'format logs');

    for (let i = 0; i < 3; i++) {
      const proposal = await mgr.generateCapability(observed.id);
      if (!proposal) throw new Error('expected proposal');
      await mgr.rejectCapability(proposal.proposedCapability.id, 'user', 'not useful');
    }

    const recent = await store.getRecentAuditEvents(100);
    expect(recent.some((e) => e.event === 'pattern-observed')).toBe(true);
    expect(recent.some((e) => e.event === 'pattern-acknowledged')).toBe(true);
    const pattern = await store.getObservation(observed.id);
    expect(pattern?.rejectedCount).toBeGreaterThanOrEqual(3);
    expect(pattern?.ignored).toBe(true);
    expect(pattern?.confidence).toBeLessThan(0.2);
  });

  it('runs the full observe → generate → sandbox → trial → register pipeline', async () => {
    const store = new InMemoryCapabilityStore();
    const generateFn = async () => JSON.stringify({
      name: 'csv-to-json',
      description: 'convert csv to json',
      sourceCode: 'function run(args){ return args.csv.split("\\n").map(function(l){ return l.split(","); }); }',
      language: 'javascript',
      entryPoint: 'run',
      inputSchema: { type: 'object', properties: { csv: { type: 'string' } } },
      outputSchema: { type: 'object' },
      dependencies: [],
      sideEffects: [],
    });
    const mgr = new RuntimeCapabilityManager({
      store,
      generateFn,
      sandbox: {
        runTool: async () => ({ passed: true, stdout: '', stderr: '', exitCode: 0, warnings: [], detectedSideEffects: [], executionTimeMs: 0 }),
        validateSideEffects: async () => [],
        estimateRisk: async () => 'low',
      },
      config: { syntheticIntelligence: { enabled: false, allowUserPromptGeneration: true } } as never,
    });
    await mgr.initialize();
    const proposal = await mgr.generateFromUserPrompt('convert csv to json', { kind: 'tool', sessionId: 's' });
    const cap = proposal!.proposedCapability;
    expect(cap.status).toBe('proposed');

    const sbox = await mgr.runSandbox(cap.id);
    expect(sbox.passed).toBe(true);
    expect((await mgr.getCapability(cap.id))?.status).toBe('sandbox-passed');

    await mgr.approveForTrial(cap.id, 'user');
    expect((await mgr.getCapability(cap.id))?.status).toBe('in-trial');

    await mgr.approveForRegistration(cap.id, 'user');
    expect((await mgr.getCapability(cap.id))?.status).toBe('registered');

    const prompt = mgr.getPromptBlock();
    expect(prompt).toContain(cap.name);

    const audit = await mgr.getAuditLog(cap.id);
    expect(audit.some((e) => e.event === 'proposed')).toBe(true);
    expect(audit.some((e) => e.event === 'sandbox-passed')).toBe(true);
    expect(audit.some((e) => e.event === 'registered')).toBe(true);
    await mgr.shutdown();
  });

  it('enforces per-session generation quota', async () => {
    const mgr = new RuntimeCapabilityManager({
      store: new InMemoryCapabilityStore(),
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true, maxGenerationsPerSession: 1 } } as never,
    });
    await mgr.generateFromUserPrompt('A detailed skill for writing weekly status reports with blockers first', { kind: 'skill', sessionId: 'sess-q' });
    await expect(
      mgr.generateFromUserPrompt('Another detailed skill for writing daily standups with blockers first', { kind: 'skill', sessionId: 'sess-q' }),
    ).rejects.toThrow(/quota/i);
  });

  it('ranks unused generated tools last with LOW PRIORITY', async () => {
    const store = new InMemoryCapabilityStore();
    const mgr = new RuntimeCapabilityManager({
      store,
      generateFn: null,
      sandbox: { runTool: async () => pass, validateSideEffects: async () => [], estimateRisk: async () => 'low' },
      config: { syntheticIntelligence: { allowUserPromptGeneration: true } } as never,
    });
    const used = await mgr.generateFromUserPrompt('A detailed skill for writing weekly status reports with blockers first', { kind: 'skill' });
    await mgr.approveForRegistration(used!.proposedCapability.id, 'user');
    const idle = await mgr.generateFromUserPrompt('create a tool that converts CSV to JSON rows', {
      kind: 'tool',
    }).catch(() => null);
    if (idle) {
      await store.updateCapability(idle.proposedCapability.id, { status: 'registered', useCount: 0 });
      await store.updateCapability(used!.proposedCapability.id, { useCount: 9 });
    }
    const hotTool = {
      id: 'cap_hot', kind: 'tool' as const, name: 'hot-tool', description: 'hot', createdAt: Date.now(), updatedAt: Date.now(),
      createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt' as const, status: 'registered' as const,
      useCount: 9, trialCount: 0, language: 'javascript' as const, sourceCode: 'function run(args){return args}', entryPoint: 'run',
      inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
    };
    const coldTool = { ...hotTool, id: 'cap_cold', name: 'cold-tool', useCount: 0 };
    await store.insertCapability(hotTool);
    await store.insertCapability(coldTool);
    await mgr.initialize();
    const block = mgr.getPromptBlock();
    const hotAt = block.indexOf('hot-tool');
    const coldAt = block.indexOf('cold-tool');
    expect(hotAt).toBeGreaterThanOrEqual(0);
    expect(coldAt).toBeGreaterThan(hotAt);
    expect(block).toContain('[LOW PRIORITY]');
    expect(mgr.health().sandbox).toBe('process');
    expect(mgr.health().enabled).toBe(false);
  });
});
