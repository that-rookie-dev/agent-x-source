import type {
  Capability,
  CapabilityAuditEvent,
  CapabilityKind,
  CapabilityMeta,
  CapabilityOrigin,
  CapabilitySandboxResult,
  CapabilityStatus,
  CapabilityTestCase,
  CapabilityUsageRecord,
  GraduationGate,
  GraduationGateName,
  GraduationProposal,
  KnowledgeCapability,
  ObservedPattern,
  SkillCapability,
  ToolCapability,
} from '@agentx/shared';

export type QueryablePool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export interface ObservationQuery {
  minConfidence?: number;
  minFrequency?: number;
  includeIgnored?: boolean;
}

export interface CapabilityStore {
  initialize(): Promise<void>;
  close(): Promise<void>;

  insertCapability(cap: Capability): Promise<void>;
  updateCapabilityStatus(id: string, status: CapabilityStatus): Promise<void>;
  updateCapability(id: string, updates: Partial<CapabilityMeta> & Record<string, unknown>): Promise<void>;
  deleteCapability(id: string): Promise<void>;

  getCapability(id: string): Promise<Capability | null>;
  getCapabilities(status?: CapabilityStatus, kind?: CapabilityKind, limit?: number, offset?: number): Promise<Capability[]>;
  findCapabilityByName(name: string): Promise<Capability | null>;
  searchCapabilities(query: string): Promise<Capability[]>;
  listByOrigin?(origin: CapabilityOrigin, limit?: number, offset?: number): Promise<Capability[]>;

  insertObservation(pattern: ObservedPattern): Promise<void>;
  updateObservation(id: string, updates: Partial<ObservedPattern>): Promise<void>;
  getObservations(minConfidence?: number, query?: ObservationQuery): Promise<ObservedPattern[]>;
  getObservation(id: string): Promise<ObservedPattern | null>;

  insertAuditEvent(event: CapabilityAuditEvent): Promise<void>;
  getAuditEvents(capabilityId: string): Promise<CapabilityAuditEvent[]>;
  getRecentAuditEvents(limit?: number): Promise<CapabilityAuditEvent[]>;

  incrementUseCount(capabilityId: string): Promise<void>;
  recordUsage(record: CapabilityUsageRecord): Promise<void>;
  getUsage(capabilityId: string, limit?: number): Promise<CapabilityUsageRecord[]>;
  getMostUsedTools(limit?: number): Promise<Capability[]>;

  upsertGates(capabilityId: string, gates: GraduationGate[]): Promise<void>;
  getGates(capabilityId: string): Promise<GraduationGate[]>;
  updateGate(capabilityId: string, gate: GraduationGateName, patch: Partial<GraduationGate>): Promise<void>;

  getStats(): Promise<{ total: number; byStatus: Record<string, number>; byKind: Record<string, number> }>;

  listToolExecutionAggregates(minCount?: number): Promise<Array<{ toolName: string; frequency: number; lastAt: number }>>;

  insertTestCase(testCase: CapabilityTestCase): Promise<void>;
  listTestCases(capabilityId: string): Promise<CapabilityTestCase[]>;
  getTestCase(capabilityId: string, caseId: string): Promise<CapabilityTestCase | null>;
  updateTestCase(capabilityId: string, caseId: string, updates: Partial<CapabilityTestCase>): Promise<void>;
  deleteTestCase(capabilityId: string, caseId: string): Promise<void>;

  countAuditEvents(event: string, sinceMs: number, sessionId?: string): Promise<number>;
}

export interface CapabilityObserver {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPatterns(minConfidence?: number): Promise<ObservedPattern[]>;
  acknowledgePattern(id: string): Promise<void>;
  ignorePattern(id: string): Promise<void>;
  recordRejection(patternId: string): Promise<void>;
  reportUserPromptObservation(
    prompt: string,
    options?: { examples?: Array<{ input: Record<string, unknown>; expectedOutput?: unknown }> },
  ): Promise<ObservedPattern>;
  observeTurn(input: {
    sessionId: string;
    userText: string;
    tools: Array<{ name: string; success: boolean; output?: string }>;
  }): Promise<ObservedPattern[]>;
}

export interface CapabilityGenerator {
  generateTool(pattern: ObservedPattern): Promise<ToolCapability | null>;
  generateSkill(pattern: ObservedPattern): Promise<SkillCapability | null>;
  generateKnowledge(pattern: ObservedPattern): Promise<KnowledgeCapability | null>;
  generateAlternative(capability: ToolCapability, feedback: string): Promise<ToolCapability>;
  proposeEnhancement(existing: CapabilityMeta, context: string): Promise<Capability | null>;
  clarifyUserPrompt(prompt: string): Promise<{ questions: string[]; inferredKind: CapabilityKind | 'auto' }>;
}

export interface CapabilitySandbox {
  runTool(code: string, language: string, args: Record<string, unknown>, entryPoint?: string): Promise<CapabilitySandboxResult>;
  validateSideEffects(code: string, language: string): Promise<string[]>;
  estimateRisk(code: string, language: string): Promise<'low' | 'medium' | 'high'>;
}

export interface CapabilityGraduator {
  getProposal(capabilityId: string): Promise<GraduationProposal | null>;
  getGates(capabilityId: string): Promise<GraduationGate[]>;
  passGate(capabilityId: string, gate: string, actor: string, notes?: string): Promise<void>;
  failGate(capabilityId: string, gate: string, actor: string, reason: string): Promise<void>;
  getNextGate(capabilityId: string): Promise<GraduationGate | null>;
  isEligibleForPromotion(capabilityId: string): Promise<boolean>;
  seedGates(capability: Capability): Promise<void>;
  isTrialExpired(capability: Capability, trialDurationMs: number, trialMaxUses: number): boolean;
}

export type GenerateFn = (prompt: string, system: string) => Promise<string>;

export type KnowledgeCapabilityInsert = KnowledgeCapability;
