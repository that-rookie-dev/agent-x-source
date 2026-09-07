export type CapabilityKind = 'tool' | 'skill' | 'knowledge';

export type CapabilityStatus =
  | 'observed'
  | 'proposed'
  | 'sandbox-failed'
  | 'sandbox-passed'
  | 'in-trial'
  | 'trial-failed'
  | 'registered'
  | 'disabled'
  | 'archived';

export type CapabilityOrigin = 'observed' | 'user-prompt' | 'seeded' | 'imported';

export type CapabilityLanguage = 'typescript' | 'python' | 'bash' | 'javascript';

export interface CapabilityMeta {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
  readonly sourceSessionId: string;
  readonly version: number;
  readonly origin: CapabilityOrigin;
  readonly userPrompt?: string;
  readonly status: CapabilityStatus;
  readonly useCount: number;
  readonly trialCount: number;
  readonly generatedBy?: string;
  readonly alternatives?: string[];
  readonly mergedFrom?: string[];
}

export interface ToolCapability extends CapabilityMeta {
  readonly kind: 'tool';
  readonly language: CapabilityLanguage;
  readonly sourceCode: string;
  readonly entryPoint: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly dependencies: string[];
  readonly sideEffects: string[];
  readonly approvedSideEffects: string[];
  readonly sandboxResult: CapabilitySandboxResult | null;
  readonly originalSourceCode?: string;
}

export interface SkillCapability extends CapabilityMeta {
  readonly kind: 'skill';
  readonly promptTemplate: string;
  readonly triggerPattern: string;
  readonly exampleCalls: string[];
}

export interface KnowledgeCapability extends CapabilityMeta {
  readonly kind: 'knowledge';
  readonly domain: string;
  readonly content: string;
  readonly sourceReferences: string[];
}

export type Capability = ToolCapability | SkillCapability | KnowledgeCapability;

export interface ObservedPattern {
  readonly id: string;
  readonly pattern: string;
  readonly frequency: number;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly context: string;
  readonly confidence: number;
  readonly origin: 'autonomous' | 'user-prompt';
  readonly exampleInputs?: Array<{ input: Record<string, unknown>; expectedOutput?: unknown }>;
  readonly acknowledged?: boolean;
  readonly ignored?: boolean;
  /** Number of times the user rejected or ignored a proposal from this pattern. */
  readonly rejectedCount?: number;
}

export interface CapabilitySandboxResult {
  readonly passed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly warnings: string[];
  readonly detectedSideEffects: string[];
  readonly executionTimeMs: number;
}

export interface CapabilityAuditEvent {
  readonly id: string;
  /** Null for pattern-level audit events that are not tied to a specific capability. */
  readonly capabilityId: string | null;
  readonly event: string;
  readonly timestamp: number;
  readonly actor: string;
  readonly details: Record<string, unknown>;
}

export interface GraduationProposal {
  readonly pattern: ObservedPattern;
  readonly proposedCapability: Capability;
  readonly generatedBy: string;
  readonly confidence: number;
  readonly alternatives: string[];
}

export type GraduationGateName = 'sandbox' | 'trial' | 'user-approval';

export interface GraduationGate {
  readonly gate: GraduationGateName;
  readonly status: 'pending' | 'passed' | 'failed' | 'skipped';
  readonly passedAt: number | null;
  readonly passedBy: string | null;
  readonly notes: string;
}

export interface CapabilityUsageRecord {
  readonly id: string;
  readonly capabilityId: string;
  readonly sessionId?: string;
  readonly crewId?: string;
  readonly success: boolean;
  readonly createdAt: number;
  readonly executionTimeMs?: number;
  readonly positiveFeedback?: boolean;
}

export interface CapabilityTestCase {
  readonly id: string;
  readonly capabilityId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly createdAt: number;
}

export interface CapabilityUsageReport {
  readonly capabilityId: string;
  readonly useCount: number;
  readonly successRate: number;
  readonly avgExecutionTimeMs: number;
  readonly sessionCount: number;
  readonly positiveCount: number;
  readonly crewCount: number;
  readonly userSatisfaction: number;
  readonly perDay: Array<{ day: string; count: number; success: number }>;
}

export interface SyntheticIntelligenceConfig {
  /** Master switch. Default false until production soak. */
  enabled?: boolean;
  /** Bypass user approval for tools. Default false. High-risk never auto-approves. */
  autoGraduateTools?: boolean;
  /** Cap on registered generated tools. Default 50. */
  maxGeneratedToolCount?: number;
  /** Explicit create-from-prompt. Default true. */
  allowUserPromptGeneration?: boolean;
  /**
   * Isolation for generated tool code. Agent-X is an install-and-use bundle —
   * process isolation only (tempdir + timeout + no network). No container runtime is used.
   * Legacy container-runtime mode names are accepted and mapped to `process`.
   */
  sandboxMode?: 'process' | 'disabled';
  /** Max generateFromUserPrompt calls per session. Default 5. */
  maxGenerationsPerSession?: number;
  /** Max autonomous observations recorded per rolling hour. Default 20. */
  maxObservationsPerHour?: number;
  /** Trial window before a decision is prompted. Default 24h. */
  trialDurationMs?: number;
  /** Trial invocations before a decision is prompted. Default 10. */
  trialMaxUses?: number;
  /** Auto-register after a successful trial. Default false. */
  trialAutoPromote?: boolean;
  /** Concurrent sandbox runs. Default 2. */
  concurrentSandboxLimit?: number;
  /** Per-run sandbox timeout. Default 10s. */
  sandboxTimeoutMs?: number;
  /** Max generated source size. Default 10KB. */
  maxSourceCodeBytes?: number;
  /** Max declared dependencies. Default 5. */
  maxDependencies?: number;
  /** Cumulative sandbox CPU budget per UTC day. Default 5 minutes. */
  dailySandboxBudgetMs?: number;
  /** Observer: min observations before a proposal. Default 3. */
  minObservationsBeforeProposal?: number;
  /** Observer: min confidence (0–1). Default 0.6. */
  minConfidenceThreshold?: number;
  /** Observer recency window. Default 1 hour. */
  observationWindowMs?: number;
  /** Cap on live un-acknowledged observations. Default 50. */
  maxActiveObservations?: number;
  /** Run a full observation sweep every N turns. Default 5. */
  sweepEveryTurns?: number;
  /** Daily AutoDeprecator interval. Default 24h. */
  deprecationSweepMs?: number;
  /** Side-effect count that forces high risk. Default 3. */
  maxSideEffects?: number;
  /**
   * First-generation consent for autonomous proposals.
   * unset: not yet decided; will prompt per pattern.
   * once: ask for each observed pattern individually.
   * always: generate without asking.
   * deny: skip autonomous generation (can be changed).
   * deny-permanently: skip autonomous generation and stop asking.
   * User-prompt create from the panel still works.
   */
  generationConsent?: 'unset' | 'once' | 'always' | 'deny' | 'deny-permanently';
  /**
   * Rollout stage for SI. Observe-only collects patterns only; propose creates proposals;
   * trial allows sandbox and trial; auto-low-risk enables auto-graduation for low-risk tools.
   */
  rolloutStage?: 'observe-only' | 'propose' | 'trial' | 'auto-low-risk';
}

export const DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG: Required<SyntheticIntelligenceConfig> = {
  enabled: false,
  autoGraduateTools: false,
  maxGeneratedToolCount: 50,
  allowUserPromptGeneration: true,
  sandboxMode: 'process',
  maxGenerationsPerSession: 5,
  maxObservationsPerHour: 20,
  trialDurationMs: 86_400_000,
  trialMaxUses: 10,
  trialAutoPromote: false,
  concurrentSandboxLimit: 2,
  sandboxTimeoutMs: 10_000,
  maxSourceCodeBytes: 10_240,
  maxDependencies: 5,
  dailySandboxBudgetMs: 300_000,
  minObservationsBeforeProposal: 3,
  minConfidenceThreshold: 0.6,
  observationWindowMs: 3_600_000,
  maxActiveObservations: 50,
  sweepEveryTurns: 5,
  deprecationSweepMs: 86_400_000,
  maxSideEffects: 3,
  generationConsent: 'unset',
  rolloutStage: 'propose',
};

export const VALID_CAPABILITY_TRANSITIONS: Record<CapabilityStatus, CapabilityStatus[]> = {
  observed: ['proposed'],
  proposed: ['sandbox-failed', 'sandbox-passed', 'disabled', 'registered', 'archived'],
  'sandbox-failed': ['proposed', 'archived', 'disabled'],
  'sandbox-passed': ['in-trial', 'disabled', 'registered', 'archived'],
  'in-trial': ['registered', 'trial-failed', 'disabled', 'archived'],
  'trial-failed': ['archived', 'proposed', 'disabled'],
  registered: ['disabled', 'archived'],
  disabled: ['archived', 'registered'],
  archived: [],
};

export type CapabilitySseEventName =
  | 'capability:observed'
  | 'capability:proposed'
  | 'capability:sandbox-result'
  | 'capability:graduated'
  | 'capability:trial-expiring'
  | 'capability:used'
  | 'capability:error';

export interface CapabilitySsePayload {
  event: CapabilitySseEventName;
  capabilityId?: string;
  name?: string;
  patternId?: string;
  pattern?: string;
  confidence?: number;
  passed?: boolean;
  status?: CapabilityStatus;
  remainingUses?: number;
  sessionId?: string;
  reason?: string;
}

export const GENERATED_TOOL_ID_PREFIX = 'si_';

export function generatedToolId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'capability';
  return `${GENERATED_TOOL_ID_PREFIX}${slug}`;
}

export function isGeneratedToolId(id: string): boolean {
  return id.startsWith(GENERATED_TOOL_ID_PREFIX);
}
