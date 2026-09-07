import { EventEmitter } from 'node:events';
import {
  DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG,
  generateId,
  generatedToolId,
  getLogger,
  type AgentXConfig,
  type Capability,
  type CapabilityAuditEvent,
  type CapabilityKind,
  type CapabilityMeta,
  type CapabilitySandboxResult,
  type CapabilitySsePayload,
  type CapabilityStatus,
  type CapabilityTestCase,
  type CapabilityUsageReport,
  type GraduationProposal,
  type ObservedPattern,
  type SyntheticIntelligenceConfig,
} from '@agentx/shared';
import {
  CapabilityGenerationError,
  CapabilityGraduationError,
  CapabilityNotFoundError,
  CapabilityValidationError,
} from './errors.js';
import type {
  CapabilityGenerator,
  CapabilityGraduator,
  CapabilityObserver,
  CapabilitySandbox,
  CapabilityStore,
  GenerateFn,
  QueryablePool,
} from './interfaces.js';
import { DefaultCapabilityGenerator } from './CapabilityGenerator.js';
import { DefaultCapabilityGraduator } from './CapabilityGraduator.js';
import { DefaultCapabilityObserver } from './CapabilityObserver.js';
import { SandboxManager } from './CapabilitySandbox.js';
import { GeneratedToolRuntime, type ToolkitBridge } from './GeneratedToolRuntime.js';
import { InMemoryCapabilityStore } from './InMemoryCapabilityStore.js';
import { PostgresCapabilityStore } from './PostgresCapabilityStore.js';
import { buildCapabilityGenerator } from './LLMAdapter.js';
import { slugName } from './json.js';
import { ToolRegistrar } from './ToolRegistrar.js';
import { SkillActivator } from './SkillActivator.js';
import { UsageTracker } from './UsageTracker.js';
import { AutoDeprecator } from './AutoDeprecator.js';
import { CapabilityMerger } from './CapabilityMerger.js';
import { detectsCapabilityCreateIntent } from './chat-intent.js';
import { assertValidTransition } from './transitions.js';
import { siMetrics } from './si-metrics.js';
import { reviewGeneratedCode } from './review-checklist.js';

export interface RuntimeCapabilityManagerOptions {
  store?: CapabilityStore;
  pool?: QueryablePool | null;
  config?: AgentXConfig;
  generator?: CapabilityGenerator;
  sandbox?: CapabilitySandbox;
  generateFn?: GenerateFn | null;
  toolkit?: ToolkitBridge | null;
}

function siConfig(config?: AgentXConfig): SyntheticIntelligenceConfig {
  return { ...DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG, ...config?.syntheticIntelligence };
}

export class RuntimeCapabilityManager extends EventEmitter {
  readonly observer: CapabilityObserver;
  readonly generator: CapabilityGenerator;
  readonly sandbox: CapabilitySandbox;
  readonly graduator: CapabilityGraduator;
  readonly store: CapabilityStore;
  readonly runtime: GeneratedToolRuntime;
  readonly registrar: ToolRegistrar;
  readonly activator: SkillActivator;
  readonly usage: UsageTracker;
  readonly deprecator: AutoDeprecator;
  readonly merger: CapabilityMerger;

  private promptCache = '';
  private toolkit: ToolkitBridge | null;
  private config: AgentXConfig | undefined;
  private metaTimer: ReturnType<typeof setInterval> | null = null;
  private lastUserBySession = new Map<string, string>();
  private lastToolsBySession = new Map<string, Array<{ name: string; success: boolean; output?: string }>>();
  private consentNotified = false;
  private patternConsentPrompted = new Set<string>();
  private readonly generatorKind: 'llm' | 'heuristic' | 'custom';

  constructor(options: RuntimeCapabilityManagerOptions = {}) {
    super();
    this.config = options.config;
    this.store = options.store ?? (options.pool ? new PostgresCapabilityStore(options.pool) : new InMemoryCapabilityStore());
    this.generator = options.generator ?? new DefaultCapabilityGenerator(options.generateFn);
    const cfg = siConfig(options.config);
    this.sandbox = options.sandbox ?? new SandboxManager(cfg.sandboxMode, undefined, {
      defaultTimeoutMs: cfg.sandboxTimeoutMs,
      concurrentLimit: cfg.concurrentSandboxLimit,
      dailyBudgetMs: cfg.dailySandboxBudgetMs,
      maxOutputSize: 1_000_000,
    });
    this.graduator = new DefaultCapabilityGraduator(this.store);
    this.observer = new DefaultCapabilityObserver(this.store, {
      minFrequency: cfg.minObservationsBeforeProposal ?? 3,
      minConfidenceThreshold: cfg.minConfidenceThreshold ?? 0.6,
      observationWindowMs: cfg.observationWindowMs ?? 3_600_000,
      maxActiveObservations: cfg.maxActiveObservations ?? 50,
      sweepEveryTurns: cfg.sweepEveryTurns ?? 5,
      sweepIntervalMs: cfg.enabled ? 60_000 : 0,
      onThreshold: (pattern) => {
        this.emitSse({ event: 'capability:observed', patternId: pattern.id, pattern: pattern.pattern, confidence: pattern.confidence });
      },
    });
    this.runtime = new GeneratedToolRuntime(this.store, this.sandbox);
    this.toolkit = options.toolkit ?? null;
    this.registrar = new ToolRegistrar(this.runtime, this.store, () => this.toolkit);
    this.activator = new SkillActivator(this.store);
    this.usage = new UsageTracker(this.store);
    this.deprecator = new AutoDeprecator(this.store, this.usage);
    this.merger = new CapabilityMerger(this.store);
    this.generatorKind = options.generator ? 'custom' : options.generateFn ? 'llm' : 'heuristic';
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.applyRuntimeFlags();
    await this.refreshPromptCache();
    await this.registrar.sync();
  }

  async shutdown(): Promise<void> {
    if (this.metaTimer) {
      clearInterval(this.metaTimer);
      this.metaTimer = null;
    }
    await this.observer.stop();
    await this.store.close();
  }

  setToolkit(toolkit: ToolkitBridge | null): void {
    this.toolkit = toolkit;
  }

  setConfig(config: AgentXConfig): void {
    this.config = config;
  }

  async applyRuntimeFlags(): Promise<void> {
    if (this.metaTimer) {
      clearInterval(this.metaTimer);
      this.metaTimer = null;
    }
    if (siConfig(this.config).enabled) {
      await this.observer.start();
      this.startMetaLoop();
    } else {
      await this.observer.stop();
    }
  }

  health(): {
    store: 'postgres' | 'memory';
    sandbox: 'process';
    generator: 'llm' | 'heuristic' | 'custom';
    enabled: boolean;
    consent: SyntheticIntelligenceConfig['generationConsent'];
    alerts: string[];
    metrics: ReturnType<typeof siMetrics.snapshot>;
  } {
    return {
      store: this.store.constructor.name.includes('Postgres') ? 'postgres' : 'memory',
      sandbox: 'process',
      generator: this.generatorKind,
      enabled: this.isEnabled(),
      consent: siConfig(this.config).generationConsent,
      alerts: siMetrics.alerts(),
      metrics: siMetrics.snapshot(),
    };
  }

  getSettings(): Required<SyntheticIntelligenceConfig> {
    return siConfig(this.config) as Required<SyntheticIntelligenceConfig>;
  }

  getPromptBlock(): string {
    return this.promptCache;
  }

  allowUserPromptGeneration(): boolean {
    return siConfig(this.config).allowUserPromptGeneration !== false;
  }

  isEnabled(): boolean {
    return siConfig(this.config).enabled === true;
  }

  async prepareTurn(userText: string, sessionId: string): Promise<string | null> {
    const parts: string[] = [];
    try {
      const skill = await this.activator.activateForMessage(userText);
      if (skill) parts.push(skill);
    } catch (err) {
      getLogger().warn('SI_SKILL', err instanceof Error ? err.message : String(err));
    }
    if (this.allowUserPromptGeneration() && detectsCapabilityCreateIntent(userText)) {
      try {
        const proposal = await this.generateFromUserPrompt(userText, { actor: 'user', sessionId, kind: 'auto' });
        if (proposal) {
          const cap = proposal.proposedCapability;
          parts.push(
            `[CAPABILITY CREATE]\nA reusable capability was already proposed from this message: "${cap.name}" (${cap.id}, status ${cap.status}). Tell the user to review and approve it in the Capabilities panel. Do not write one-off inline code for this request. This is not an Executable Skill package.\n[/CAPABILITY CREATE]`,
          );
        }
      } catch (err) {
        parts.push(
          `[CAPABILITY CREATE]\nCould not create a reusable capability (${err instanceof Error ? err.message : String(err)}). Direct the user to the Capabilities panel if they still want one. Do not confuse this with Executable Skills.\n[/CAPABILITY CREATE]`,
        );
      }
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  async reportObservation(pattern: string, context: string): Promise<ObservedPattern> {
    await this.assertObservationQuota();
    const now = Date.now();
    const observed: ObservedPattern = {
      id: generateId('obs'),
      pattern,
      frequency: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      context,
      confidence: 0.4,
      origin: 'autonomous',
    };
    await this.store.insertObservation(observed);
    siMetrics.increment('observation');
    await this.auditPattern('pattern-observed', 'system', { pattern: observed.pattern, context, patternId: observed.id });
    this.emitSse({ event: 'capability:observed', patternId: observed.id, pattern, confidence: observed.confidence });
    return (await this.store.getObservations()).find((p) => p.pattern === pattern) ?? observed;
  }

  async getCandidatesForGeneration(): Promise<ObservedPattern[]> {
    return (await this.store.getObservations(0.5)).filter((p) => !p.acknowledged && !p.ignored && p.frequency >= 3);
  }

  async generateCapability(patternId: string): Promise<GraduationProposal | null> {
    const pattern = await this.store.getObservation(patternId);
    if (!pattern || pattern.ignored) return null;
    const looksTool = /\b(tool|csv|json|convert|parse|script|function)\b/i.test(pattern.pattern);
    const looksKnowledge = /\b(knowledge|learn|remember|fact|domain|summary)\b/i.test(pattern.pattern);
    let cap: Capability | null = null;
    if (looksTool) {
      cap = await this.generator.generateTool(pattern);
    } else if (looksKnowledge) {
      cap = await this.generator.generateKnowledge(pattern);
    }
    if (!cap) cap = await this.generator.generateSkill(pattern);
    if (!cap) {
      siMetrics.increment('generation', false);
      return null;
    }
    this.assertSourceLimits(cap);
    const reviewNotes = this.collectReviewWarnings(cap);
    if (reviewNotes.length) cap = { ...cap, alternatives: [...(cap.alternatives ?? []), ...reviewNotes] };
    siMetrics.increment('generation', true);
    const proposal = await this.persistProposal(pattern, cap);
    if (proposal) {
      await this.observer.acknowledgePattern(pattern.id);
      await this.auditPattern('pattern-acknowledged', 'system', { patternId: pattern.id, pattern: pattern.pattern });
    }
    return proposal;
  }

  async generateFromUserPrompt(
    prompt: string,
    options?: {
      kind?: 'tool' | 'skill' | 'knowledge' | 'auto';
      language?: 'typescript' | 'python' | 'bash' | 'javascript';
      examples?: Array<{ input: Record<string, unknown>; expectedOutput?: unknown }>;
      actor?: string;
      sessionId?: string;
    },
  ): Promise<GraduationProposal | null> {
    if (!this.allowUserPromptGeneration()) {
      throw new CapabilityValidationError('User-prompt capability generation is disabled');
    }
    const trimmed = prompt.trim();
    if (!trimmed) throw new CapabilityValidationError('prompt is required');
    await this.assertGenerationQuota(options?.sessionId);

    const similar = await this.store.searchCapabilities(trimmed.slice(0, 40));
    const dup = await this.store.findCapabilityByName(slugName(trimmed));
    if (dup && dup.status !== 'archived') {
      throw new CapabilityValidationError(`A capability named "${dup.name}" already exists`);
    }

    const pattern = await this.observer.reportUserPromptObservation(trimmed, { examples: options?.examples });
    const clarify = await this.generator.clarifyUserPrompt(trimmed);
    let kind: CapabilityKind | 'auto' = options?.kind ?? 'auto';
    if (kind === 'auto') {
      kind = clarify.inferredKind === 'auto' ? 'skill' : clarify.inferredKind;
    }

    let cap: Capability | null = null;
    if (kind === 'tool') {
      cap = await this.generator.generateTool(pattern);
      if (cap && options?.language) {
        cap = { ...cap, language: options.language };
      }
    } else if (kind === 'knowledge') {
      cap = await this.generator.generateKnowledge(pattern);
    } else {
      cap = await this.generator.generateSkill(pattern);
    }
    if (!cap) {
      siMetrics.increment('generation', false);
      throw new CapabilityGenerationError('Generator returned no capability');
    }

    this.assertSourceLimits(cap);
    const reviewNotes = this.collectReviewWarnings(cap);

    cap = {
      ...cap,
      origin: 'user-prompt',
      userPrompt: trimmed,
      createdBy: options?.actor ?? 'user',
      sourceSessionId: options?.sessionId ?? '',
    };

    const extra: string[] = [...reviewNotes];
    if (similar.length && similar[0] && similar[0].id !== cap.id) {
      extra.push(`Similar existing capability: ${similar[0].name}`);
    }
    if (extra.length) cap = { ...cap, alternatives: [...(cap.alternatives ?? []), ...extra] };

    const proposal = await this.persistProposal(pattern, cap);
    siMetrics.increment('generation', true);
    await this.audit(cap.id, 'generation-completed', options?.actor ?? 'user', { sessionId: options?.sessionId, kind });
    return proposal;
  }

  async runSandbox(proposalId: string): Promise<CapabilitySandboxResult> {
    const cap = await this.requireCapability(proposalId);
    await this.audit(cap.id, 'sandbox-started', 'system', {});
    if (cap.kind !== 'tool') {
      await this.graduator.passGate(cap.id, 'sandbox', 'system', 'Skills skip sandbox');
      return {
        passed: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        warnings: [],
        detectedSideEffects: [],
        executionTimeMs: 0,
      };
    }
    const result = await this.sandbox.runTool(cap.sourceCode, cap.language, {}, cap.entryPoint);
    await this.store.updateCapability(cap.id, { sandboxResult: result });
    siMetrics.increment('sandbox', result.passed);
    if (result.passed) {
      await this.setStatus(cap.id, 'sandbox-passed');
      await this.graduator.passGate(cap.id, 'sandbox', 'system', 'sandbox passed');
      await this.audit(cap.id, 'sandbox-passed', 'system', { exitCode: result.exitCode });
    } else {
      await this.setStatus(cap.id, 'sandbox-failed');
      await this.graduator.failGate(cap.id, 'sandbox', 'system', result.stderr || 'sandbox failed');
      await this.audit(cap.id, 'sandbox-failed', 'system', { stderr: result.stderr });
    }
    this.emitSse({ event: 'capability:sandbox-result', capabilityId: cap.id, name: cap.name, passed: result.passed });
    return result;
  }

  async approveForTrial(capabilityId: string, actor: string): Promise<void> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.kind === 'tool' && cap.status !== 'sandbox-passed' && cap.status !== 'in-trial') {
      throw new CapabilityGraduationError('Tool must pass sandbox before trial');
    }
    await this.graduator.passGate(capabilityId, 'trial', actor);
    await this.setStatus(capabilityId, 'in-trial');
    await this.audit(capabilityId, 'trial-started', actor, {});
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async approveForRegistration(capabilityId: string, actor: string): Promise<void> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.kind === 'tool') {
      const max = siConfig(this.config).maxGeneratedToolCount ?? 50;
      const active = (await this.store.getCapabilities('registered', 'tool')).length;
      if (active >= max) {
        throw new CapabilityGraduationError(`Registered generated tool cap reached (${max})`);
      }
      const risk = await this.sandbox.estimateRisk(cap.sourceCode, cap.language);
      if (risk === 'high' && actor === 'system') {
        throw new CapabilityGraduationError('High-risk tools never auto-approve');
      }
      if (cap.status !== 'in-trial' && cap.status !== 'sandbox-passed' && !siConfig(this.config).autoGraduateTools) {
        if (cap.status !== 'proposed') {
          throw new CapabilityGraduationError('Tool is not eligible for registration');
        }
        const sandbox = await this.runSandbox(capabilityId);
        if (!sandbox.passed) throw new CapabilityGraduationError('Sandbox failed');
      }
      if (siConfig(this.config).autoGraduateTools && actor === 'system' && risk === 'high') {
        throw new CapabilityGraduationError('High-risk tools never auto-approve');
      }
      const next = await this.graduator.getNextGate(capabilityId);
      if (next?.gate === 'trial') {
        await this.graduator.passGate(capabilityId, 'trial', actor, 'user registered without a separate trial step');
      }
    }
    await this.graduator.passGate(capabilityId, 'user-approval', actor);
    await this.setStatus(capabilityId, 'registered');
    siMetrics.increment('approval');
    await this.audit(capabilityId, 'registered', actor, {});
    this.emit('capability-registered', await this.requireCapability(capabilityId));
    this.emitSse({ event: 'capability:graduated', capabilityId, status: 'registered' });
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async rejectCapability(capabilityId: string, actor: string, reason: string, feedback?: string): Promise<void> {
    await this.requireCapability(capabilityId);
    await this.setStatus(capabilityId, 'archived');
    await this.audit(capabilityId, 'rejected', actor, { reason, feedback });
    const patternId = await this.patternIdForCapability(capabilityId);
    if (patternId) {
      await this.observer.recordRejection(patternId);
    }
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async disableCapability(capabilityId: string, actor: string): Promise<void> {
    await this.requireCapability(capabilityId);
    await this.setStatus(capabilityId, 'disabled');
    await this.audit(capabilityId, 'disabled', actor, {});
    this.emit('capability-disabled', capabilityId);
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async enableCapability(capabilityId: string, actor: string): Promise<void> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.status !== 'disabled') {
      throw new CapabilityGraduationError('Only disabled capabilities can be re-enabled');
    }
    await this.setStatus(capabilityId, 'registered');
    await this.audit(capabilityId, 'registered', actor, { reenabled: true });
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async archiveCapability(capabilityId: string, actor: string): Promise<void> {
    await this.requireCapability(capabilityId);
    await this.setStatus(capabilityId, 'archived');
    await this.audit(capabilityId, 'archived', actor, {});
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async rollbackCapability(capabilityId: string, actor: string): Promise<void> {
    await this.requireCapability(capabilityId);
    await this.setStatus(capabilityId, 'archived');
    await this.audit(capabilityId, 'rolled-back', actor, {});
    this.emit('capability-rolled-back', capabilityId);
    await this.registrar.sync();
    await this.refreshPromptCache();
  }

  async updateCapabilityContent(
    capabilityId: string,
    patch: { name?: string; description?: string; sourceCode?: string; promptTemplate?: string; content?: string },
    actor: string,
  ): Promise<Capability> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.status === 'registered' || cap.status === 'archived') {
      throw new CapabilityValidationError('Registered or archived capabilities are read-only; disable first to edit');
    }
    const updates: Record<string, unknown> = { version: cap.version + 1 };
    if (patch.name) updates['name'] = slugName(patch.name);
    if (patch.description) updates['description'] = patch.description;
    if (cap.kind === 'tool' && patch.sourceCode) {
      this.assertSourceLimits({ ...cap, sourceCode: patch.sourceCode });
      updates['originalSourceCode'] = cap.originalSourceCode ?? cap.sourceCode;
      updates['sourceCode'] = patch.sourceCode;
    }
    if (cap.kind === 'skill' && patch.promptTemplate) {
      updates['promptTemplate'] = patch.promptTemplate;
    }
    if (cap.kind === 'knowledge' && patch.content) {
      updates['content'] = patch.content;
    }
    await this.store.updateCapability(capabilityId, updates);
    await this.audit(capabilityId, 'edited', actor, { before: cap.version, after: cap.version + 1 });
    const next = await this.requireCapability(capabilityId);
    if (next.kind === 'tool' && patch.sourceCode) {
      await this.runSandbox(capabilityId);
    }
    return this.requireCapability(capabilityId);
  }

  async getAllCapabilities(status?: CapabilityStatus): Promise<CapabilityMeta[]> {
    return this.store.getCapabilities(status);
  }

  async getCapability(id: string): Promise<Capability | null> {
    return this.store.getCapability(id);
  }

  async getAuditLog(capabilityId: string): Promise<CapabilityAuditEvent[]> {
    return this.store.getAuditEvents(capabilityId);
  }

  async getRecentAudit(limit = 20): Promise<CapabilityAuditEvent[]> {
    return this.store.getRecentAuditEvents(limit);
  }

  async getObservations(minConfidence = 0, minFrequency = 0): Promise<ObservedPattern[]> {
    return this.store.getObservations(minConfidence, { minFrequency });
  }

  async acknowledgeObservation(id: string, actor = 'user'): Promise<void> {
    await this.observer.acknowledgePattern(id);
    await this.auditPattern('pattern-acknowledged', actor, { patternId: id });
  }

  async ignoreObservation(id: string, actor = 'user'): Promise<void> {
    await this.observer.recordRejection(id);
    await this.observer.ignorePattern(id);
    await this.auditPattern('pattern-ignored', actor, { patternId: id });
  }

  async getActiveToolCount(): Promise<number> {
    return (await this.store.getCapabilities('registered', 'tool')).length;
  }

  async getActiveSkillCount(): Promise<number> {
    return (await this.store.getCapabilities('registered', 'skill')).length;
  }

  async saveTestCase(capabilityId: string, name: string, input: Record<string, unknown>): Promise<CapabilityTestCase> {
    await this.requireCapability(capabilityId);
    const testCase: CapabilityTestCase = {
      id: generateId('tc'),
      capabilityId,
      name: name.trim() || 'case',
      input,
      createdAt: Date.now(),
    };
    await this.store.insertTestCase(testCase);
    return testCase;
  }

  async listTestCases(capabilityId: string): Promise<CapabilityTestCase[]> {
    return this.store.listTestCases(capabilityId);
  }

  async updateTestCase(capabilityId: string, caseId: string, name: string, input: Record<string, unknown>): Promise<CapabilityTestCase> {
    await this.requireCapability(capabilityId);
    const existing = await this.store.getTestCase(capabilityId, caseId);
    if (!existing) throw new CapabilityNotFoundError(caseId);
    await this.store.updateTestCase(capabilityId, caseId, { name: name.trim() || existing.name, input });
    const next = await this.store.getTestCase(capabilityId, caseId);
    if (!next) throw new CapabilityNotFoundError(caseId);
    return next;
  }

  async deleteTestCase(capabilityId: string, caseId: string): Promise<void> {
    await this.store.deleteTestCase(capabilityId, caseId);
  }

  async runTestCase(capabilityId: string, caseId: string): Promise<CapabilitySandboxResult> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.kind !== 'tool') throw new CapabilityValidationError('Only generated tools can be tested');
    const testCase = await this.store.getTestCase(capabilityId, caseId);
    if (!testCase) throw new CapabilityNotFoundError(caseId);
    return this.sandbox.runTool(cap.sourceCode, cap.language, testCase.input, cap.entryPoint);
  }

  async runAllTestCases(capabilityId: string): Promise<Array<{ testCase: CapabilityTestCase; result: CapabilitySandboxResult }>> {
    const cap = await this.requireCapability(capabilityId);
    if (cap.kind !== 'tool') throw new CapabilityValidationError('Only generated tools can be tested');
    const cases = await this.store.listTestCases(capabilityId);
    const out: Array<{ testCase: CapabilityTestCase; result: CapabilitySandboxResult }> = [];
    for (const testCase of cases) {
      const result = await this.sandbox.runTool(cap.sourceCode, cap.language, testCase.input, cap.entryPoint);
      out.push({ testCase, result });
    }
    return out;
  }

  async getUsageReport(capabilityId: string): Promise<CapabilityUsageReport> {
    await this.requireCapability(capabilityId);
    return this.usage.getUsageReport(capabilityId);
  }

  async observeTurn(input: {
    sessionId: string;
    userText: string;
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      try {
        await this.assertObservationQuota();
      } catch {
        return;
      }
      await this.recordFollowUpSatisfaction(input);
      await this.repairFailedGeneratedTools(input);
      const patterns = await this.observer.observeTurn(input);
      siMetrics.increment('observation');
      const candidates = patterns.filter((p) => p.frequency >= (siConfig(this.config).minObservationsBeforeProposal ?? 3) && !p.acknowledged && !p.ignored);
      const stage = siConfig(this.config).rolloutStage ?? 'propose';
      if (stage === 'observe-only') {
        // collect patterns only; do not propose or auto-graduate
        return;
      }
      const consent = siConfig(this.config).generationConsent ?? 'unset';
      if (consent === 'deny' || consent === 'deny-permanently') {
        // skip autonomous generation
      } else if (candidates.length && consent === 'unset' && !this.consentNotified) {
        this.consentNotified = true;
        this.emitSse({
          event: 'capability:error',
          reason: 'consent-required',
          patternId: candidates[0]!.id,
          pattern: candidates[0]!.pattern,
          sessionId: input.sessionId,
        });
      } else if (consent === 'once') {
        for (const pattern of candidates) {
          if (this.patternConsentPrompted.has(pattern.id)) continue;
          this.patternConsentPrompted.add(pattern.id);
          this.emitSse({
            event: 'capability:error',
            reason: 'pattern-consent-required',
            patternId: pattern.id,
            pattern: pattern.pattern,
            sessionId: input.sessionId,
          });
        }
      } else if (consent === 'always') {
        for (const pattern of candidates.slice(0, 1)) {
          await this.generateCapability(pattern.id).catch((err) => {
            getLogger().warn('SI_OBSERVER_GENERATE', err instanceof Error ? err.message : String(err));
            siMetrics.increment('error', false);
          });
        }
      }
      if (stage === 'trial' || stage === 'auto-low-risk') {
        await this.sweepTrials().catch(() => undefined);
      }
      if (stage === 'auto-low-risk') {
        await this.proposeEnhancements().catch((err) => {
          getLogger().warn('SI_META', err instanceof Error ? err.message : String(err));
        });
      }
    } catch (err) {
      siMetrics.increment('error', false);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  async proposeEnhancements(): Promise<Capability[]> {
    const used = await this.store.getMostUsedTools(5);
    const out: Capability[] = [];
    for (const cap of used) {
      const usage = await this.store.getUsage(cap.id, 20);
      const failures = usage.filter((u) => !u.success).length;
      if (failures < 3) continue;
      const next = await this.generator.proposeEnhancement(cap, `${failures} recent failures`);
      if (next) {
        await this.store.insertCapability(next);
        out.push(next);
      }
    }
    return out;
  }

  async sweepTrials(): Promise<void> {
    const cfg = siConfig(this.config);
    const trial = await this.store.getCapabilities('in-trial', undefined, 100, 0);
    for (const cap of trial) {
      if (!this.graduator.isTrialExpired(cap, cfg.trialDurationMs ?? 86_400_000, cfg.trialMaxUses ?? 10)) continue;
      this.emitSse({
        event: 'capability:trial-expiring',
        capabilityId: cap.id,
        name: cap.name,
        remainingUses: Math.max(0, (cfg.trialMaxUses ?? 10) - cap.trialCount),
      });
      if (cfg.trialAutoPromote) {
        try {
          await this.approveForRegistration(cap.id, 'system');
        } catch {
          await this.audit(cap.id, 'trial-expired', 'system', {});
        }
      } else {
        await this.audit(cap.id, 'trial-expired', 'system', {});
      }
    }
  }

  private async persistProposal(pattern: ObservedPattern, cap: Capability): Promise<GraduationProposal> {
    if (cap.kind === 'tool' && !cap.originalSourceCode) {
      cap = { ...cap, originalSourceCode: cap.sourceCode };
    }
    await this.store.insertCapability(cap);
    await this.graduator.seedGates(cap);
    await this.audit(cap.id, 'proposed', cap.createdBy, { origin: cap.origin, patternId: pattern.id, sessionId: cap.sourceSessionId });
    if (cap.kind === 'skill') {
      try {
        await this.graduator.passGate(cap.id, 'sandbox', 'system', 'skipped for prompt-recipe skill');
      } catch {
        /* already skipped */
      }
    }
    await this.refreshPromptCache();
    this.emitSse({ event: 'capability:proposed', capabilityId: cap.id, name: cap.name });
    return {
      pattern,
      proposedCapability: cap,
      generatedBy: cap.generatedBy ?? 'heuristic',
      confidence: pattern.confidence,
      alternatives: cap.alternatives ?? [],
    };
  }

  private async requireCapability(id: string): Promise<Capability> {
    const cap = await this.store.getCapability(id);
    if (!cap) throw new CapabilityNotFoundError(id);
    return cap;
  }

  private async patternIdForCapability(capabilityId: string): Promise<string | null> {
    const events = await this.store.getAuditEvents(capabilityId);
    for (const e of events) {
      if (e.details?.patternId && typeof e.details.patternId === 'string') {
        return e.details.patternId;
      }
    }
    return null;
  }

  private async setStatus(id: string, status: CapabilityStatus): Promise<void> {
    const cap = await this.requireCapability(id);
    if (cap.status === status) return;
    assertValidTransition(cap.status, status);
    await this.store.updateCapabilityStatus(id, status);
  }

  private async audit(capabilityId: string, event: string, actor: string, details: Record<string, unknown>): Promise<void> {
    await this.store.insertAuditEvent({
      id: generateId('cae'),
      capabilityId,
      event,
      timestamp: Date.now(),
      actor,
      details,
    });
    getLogger().info('SI_AUDIT', `${event} ${capabilityId} by ${actor}`);
  }

  private async auditPattern(event: string, actor: string, details: Record<string, unknown>): Promise<void> {
    await this.store.insertAuditEvent({
      id: generateId('cae'),
      capabilityId: null,
      event,
      timestamp: Date.now(),
      actor,
      details,
    });
    getLogger().info('SI_AUDIT', `${event} by ${actor}`);
  }

  private emitSse(payload: CapabilitySsePayload): void {
    this.emit('capability-event', payload);
  }

  private assertSourceLimits(cap: Capability): void {
    const cfg = siConfig(this.config);
    if (cap.kind === 'knowledge') return;
    if (cap.kind !== 'tool') return;
    if (cap.sourceCode.length > (cfg.maxSourceCodeBytes ?? 10_240)) {
      throw new CapabilityValidationError(`Source exceeds ${cfg.maxSourceCodeBytes} bytes`);
    }
    if (cap.dependencies.length > (cfg.maxDependencies ?? 5)) {
      throw new CapabilityValidationError(`Too many dependencies (max ${cfg.maxDependencies})`);
    }
    if (cap.sideEffects.length > (cfg.maxSideEffects ?? 3)) {
      throw new CapabilityValidationError(`Too many side effects (max ${cfg.maxSideEffects})`);
    }
  }

  private collectReviewWarnings(cap: Capability): string[] {
    if (cap.kind === 'knowledge' || cap.kind !== 'tool') return [];
    const findings = reviewGeneratedCode(cap.sourceCode);
    const blocking = findings.filter((f) => !f.ok && (f.id === 'no-eval' || f.id === 'no-hardcoded-secrets'));
    if (blocking.length) {
      throw new CapabilityValidationError(`Code review failed: ${blocking.map((f) => f.detail).join('; ')}`);
    }
    return findings.filter((f) => !f.ok).map((f) => `review: ${f.detail}`);
  }

  private startMetaLoop(): void {
    const ms = siConfig(this.config).deprecationSweepMs ?? 86_400_000;
    if (ms <= 0) return;
    this.metaTimer = setInterval(() => {
      void this.deprecator.sweep().catch((err) => {
        getLogger().warn('SI_DEPRECATOR', err instanceof Error ? err.message : String(err));
      });
    }, ms);
    this.metaTimer.unref?.();
  }

  private async recordFollowUpSatisfaction(input: {
    sessionId: string;
    userText: string;
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<void> {
    const prevText = this.lastUserBySession.get(input.sessionId);
    const prevTools = this.lastToolsBySession.get(input.sessionId) ?? [];
    this.lastUserBySession.set(input.sessionId, input.userText);
    this.lastToolsBySession.set(input.sessionId, input.tools);
    const thanks = /\b(thanks|thank you|perfect|great|works|nice)\b/i.test(input.userText);
    if (!thanks) return;
    const pool = [...prevTools, ...input.tools].filter((t) => t.success && t.name.startsWith('si_'));
    for (const tool of pool) {
      const cap = await this.findGeneratedTool(tool.name);
      if (cap) await this.usage.recordUserFeedback(cap.id, true);
    }
    void prevText;
  }

  private async repairFailedGeneratedTools(input: {
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<void> {
    for (const tool of input.tools) {
      if (tool.success || !tool.name.startsWith('si_')) continue;
      const cap = await this.findGeneratedTool(tool.name);
      if (!cap || cap.kind !== 'tool') continue;
      try {
        const alt = await this.generator.generateAlternative(cap, tool.output ?? 'tool failed');
        this.assertSourceLimits(alt);
        const notes = this.collectReviewWarnings(alt);
        const next = notes.length ? { ...alt, alternatives: [...(alt.alternatives ?? []), ...notes] } : alt;
        const pattern = await this.observer.reportUserPromptObservation(
          `Repair ${cap.name}: ${tool.output ?? 'failed'}`,
        );
        await this.persistProposal(pattern, { ...next, origin: 'observed', status: 'proposed' });
      } catch (err) {
        getLogger().warn('SI_ALTERNATIVE', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async findGeneratedTool(toolName: string): Promise<Capability | null> {
    const registered = await this.store.getCapabilities('registered', 'tool', 200, 0);
    const trial = await this.store.getCapabilities('in-trial', 'tool', 50, 0);
    return [...registered, ...trial].find((c) => generatedToolId(c.name) === toolName || c.id === toolName) ?? null;
  }

  private async assertGenerationQuota(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    const max = siConfig(this.config).maxGenerationsPerSession ?? 5;
    if (max <= 0) return;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const count = await this.store.countAuditEvents('proposed', since, sessionId);
    if (count >= max) {
      throw new CapabilityValidationError(`Generation quota reached (${max} per session)`);
    }
  }

  private async assertObservationQuota(): Promise<void> {
    const max = siConfig(this.config).maxObservationsPerHour ?? 20;
    if (max <= 0) return;
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const obs = await this.store.getObservations(0, { includeIgnored: true });
    const recent = obs.filter((o) => o.lastObservedAt >= hourAgo).length;
    if (recent >= max) {
      throw new CapabilityValidationError(`Observation quota reached (${max} per hour)`);
    }
  }

  private async refreshPromptCache(): Promise<void> {
    const inject = this.isEnabled() || this.allowUserPromptGeneration();
    if (!inject) {
      this.promptCache = '';
      return;
    }
    const skills = await this.store.getCapabilities('registered', 'skill', 40, 0);
    const tools = [...await this.store.getCapabilities('registered', 'tool', 80, 0)]
      .sort((a, b) => b.useCount - a.useCount);
    const knowledge = await this.store.getCapabilities('registered', 'knowledge', 40, 0);
    const trial = await this.store.getCapabilities('in-trial', 'tool', 10, 0);
    const lines: string[] = [];
    for (const cap of skills) {
      if (cap.kind !== 'skill') continue;
      lines.push(`- skill ${cap.name}: ${cap.description} [trigger: ${cap.triggerPattern}]`);
      lines.push(`  instructions: ${cap.promptTemplate.slice(0, 400)}`);
    }
    for (const cap of tools) {
      if (cap.kind !== 'tool') continue;
      const low = cap.useCount === 0 ? ' [LOW PRIORITY]' : '';
      lines.push(`- generated tool ${cap.name} (id ${generatedToolId(cap.name)}): ${cap.description} [${cap.status}]${low}`);
    }
    for (const cap of knowledge) {
      if (cap.kind !== 'knowledge') continue;
      lines.push(`- knowledge ${cap.name} (${cap.domain}): ${cap.description}`);
      lines.push(`  content: ${cap.content.slice(0, 600)}`);
    }
    for (const cap of trial) {
      if (cap.kind !== 'tool') continue;
      lines.push(`- generated tool ${cap.name} (id ${generatedToolId(cap.name)}): ${cap.description} [TRIAL - UNTRUSTED]`);
    }
    this.promptCache = lines.length
      ? `${lines.join('\n')}\nThese are Synthetic Intelligence capabilities (prompt recipes / generated tools), not Executable Skill packages.\nWhen using a [TRIAL - UNTRUSTED] tool, say so explicitly.`
      : '';
  }
}

let instance: RuntimeCapabilityManager | null = null;

export function getRuntimeCapabilityManager(): RuntimeCapabilityManager | null {
  return instance;
}

export function setRuntimeCapabilityManager(manager: RuntimeCapabilityManager | null): void {
  instance = manager;
}

const GENERATOR_INIT_TIMEOUT_MS = 8_000;
const MANAGER_INITIALIZE_TIMEOUT_MS = 20_000;

export async function initRuntimeCapabilityManager(
  options: RuntimeCapabilityManagerOptions,
): Promise<RuntimeCapabilityManager> {
  let generateFn = options.generateFn;
  if (generateFn === undefined && options.config) {
    try {
      generateFn = await Promise.race([
        buildCapabilityGenerator(options.config),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GENERATOR_INIT_TIMEOUT_MS)),
      ]);
      if (!generateFn) {
        getLogger().warn('SI_LLM', 'Capability generator LLM init timed out; falling back to heuristic generator until config changes.');
      }
    } catch (err) {
      getLogger().warn('SI_LLM', `Capability generator LLM unavailable: ${err instanceof Error ? err.message : String(err)}`);
      generateFn = null;
    }
  }
  const manager = new RuntimeCapabilityManager({ ...options, generateFn });
  instance = manager;
  const initPromise = manager.initialize();
  initPromise.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().error('SI_INIT', `Runtime capability manager degraded: ${msg}`);
    siMetrics.increment('error', false);
  });
  try {
    await Promise.race([
      initPromise,
      new Promise<void>((resolve) => setTimeout(resolve, MANAGER_INITIALIZE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().error('SI_INIT', `Runtime capability manager degraded: ${msg}`);
    siMetrics.increment('error', false);
  }
  return manager;
}
