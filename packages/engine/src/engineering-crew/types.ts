/**
 * Engineering Crew — an isolated multi-agent software-delivery pipeline.
 *
 * See docs/engineering-crew/DESIGN.md at the repo root for the full design.
 *
 * ISOLATION NOTE (design doc Section 0): this module is intentionally separate from
 * `packages/engine/src/crew/CrewManager.ts`, which is a persona/roleplay system for chat and
 * research, not a software-delivery team. Nothing in this directory imports from `../crew/`,
 * and nothing in `../crew/` should import from here. The only intentional sharing is with
 * generic engine plumbing that predates both systems (`SubAgentManager`, tool implementations,
 * `ToolchainAdapters`, `VerificationResultParser`).
 *
 * ARCHITECTURE NOTE: the Message/Environment/Role shape here is a TypeScript port of the
 * orchestration pattern used by MetaGPT (github.com/FoundationAgents/MetaGPT, MIT licensed) —
 * `Message.causeBy`/`sendTo` mirror MetaGPT's `cause_by`/`send_to` topic-addressed pub/sub,
 * `CrewRole`'s `observe`/`think`/`act` loop mirrors MetaGPT's `Role._observe`/`_think`/`_act`,
 * and the SOP pipeline (ProductManager → Architect → ProjectManager → Engineer → QaEngineer)
 * mirrors MetaGPT's `WritePRD → WriteDesign → WriteTasks → WriteCode → WriteTest → RunCode`.
 * Only the orchestration *pattern* was ported — execution goes through Agent-X's own
 * `SubAgentManager`, not any MetaGPT code.
 */

// ─── Message topics (SOP pipeline) ───
export type CrewTopic =
  // SOP pipeline topics
  | 'user_requirement'
  | 'prd_ready'
  | 'design_ready'
  | 'task_list_ready'
  | 'code_written'
  | 'code_reviewed'
  | 'code_summarized'
  | 'test_written'
  | 'test_run'
  | 'test_debugged'
  | 'test_complete'
  // Legacy/compat topics
  | 'plan_artifact_ready'
  | 'phase_implemented'
  | 'phase_verified'
  | 'phase_failed'
  // Terminal topics
  | 'unknown_escalated'
  | 'crew_complete';

export interface EngineeringCrewMessage {
  id: string;
  causeBy: CrewTopic;
  sendTo: Set<string> | '*';
  sentFrom: string;
  content: string;
  artifact?: unknown;
  timestamp: number;
}

export function broadcastMessage(
  causeBy: CrewTopic,
  sentFrom: string,
  content: string,
  artifact?: unknown,
  sendTo: Set<string> | '*' = '*',
): EngineeringCrewMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    causeBy,
    sendTo,
    sentFrom,
    content,
    artifact,
    timestamp: Date.now(),
  };
}

// ─── Role react modes (mirrors MetaGPT's RoleReactMode) ───
export enum RoleReactMode {
  /** Standard think-act loop — LLM selects actions in _think dynamically */
  REACT = 'react',
  /** Switch action each time by order defined in set_actions */
  BY_ORDER = 'by_order',
  /** First plan, then execute an action sequence */
  PLAN_AND_ACT = 'plan_and_act',
}

// ─── Memory (mirrors MetaGPT's Memory class) ───
export interface MemoryEntry {
  message: EngineeringCrewMessage;
  addedAt: number;
}

export class CrewMemory {
  private entries: MemoryEntry[] = [];

  add(msg: EngineeringCrewMessage): void {
    this.entries.push({ message: msg, addedAt: Date.now() });
  }

  addBatch(msgs: EngineeringCrewMessage[]): void {
    for (const m of msgs) this.add(m);
  }

  get(k = 0): EngineeringCrewMessage[] {
    if (k === 0) return this.entries.map((e) => e.message);
    return this.entries.slice(-k).map((e) => e.message);
  }

  /** Retrieve messages caused by (produced by) the given set of topics. */
  getByActions(topics: Set<CrewTopic>): EngineeringCrewMessage[] {
    return this.entries.filter((e) => topics.has(e.message.causeBy)).map((e) => e.message);
  }

  /** Find new messages not already in memory. */
  findNews(observed: EngineeringCrewMessage[], k = 10): EngineeringCrewMessage[] {
    const known = new Set(this.entries.map((e) => e.message.id));
    return observed.filter((m) => !known.has(m.id)).slice(-k);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

// ─── SOP Documents (mirrors MetaGPT's document schema) ───

/** Product Requirements Document — produced by ProductManager from user requirement. */
export interface PrdDocument {
  originalRequirement: string;
  productName: string;
  features: Array<{ name: string; description: string; priority: 'high' | 'medium' | 'low' }>;
  constraints: string[];
  /** Unknowns identified during PRD research — things that must be verified before implementation. */
  unknowns?: string[];
  // Raw LLM output preserved for downstream roles
  rawOutput: string;
}

/** System Design Document — produced by Architect from PRD. */
export interface DesignDocument {
  prdRef: string; // original requirement text
  architecture: string;
  components: Array<{
    name: string;
    description: string;
    responsibilities: string[];
    interfaces: string[];
  }>;
  dataModels: string[];
  techStack: string[];
  constraints: string[];
  /** Unknowns carried forward from PRD or identified during design — must be resolved before/during implementation. */
  unknowns?: string[];
  rawOutput: string;
}

/** Individual task in a task list — mirrors MetaGPT's Task. */
export interface Task {
  id: string;
  title: string;
  description: string;
  dependsOn: string[]; // task ids
  acceptanceCriteria: string[];
  filename?: string; // expected output filename
  unknowns: PlanUnknown[];
  // Execution state
  status: PhaseStatus;
  codeDocument?: CodeDocument;
  testDocument?: TestDocument;
  runResult?: RunResult;
  verification?: VerificationOutcome[];
  implementationNotes?: string;
  retryCount?: number;
}

/** Task List — produced by ProjectManager from Design. */
export interface TaskList {
  designRef: string; // design raw output
  tasks: Task[];
  rawOutput: string;
}

/** Code Document — produced by Engineer for each task. */
export interface CodeDocument {
  filename: string;
  content: string;
  language: string;
  reviewed: boolean;
  reviewNotes?: string;
  summary?: string;
  isPass: boolean;
  passReason?: string;
}

/** Test Document — produced by QaEngineer for each code file. */
export interface TestDocument {
  filename: string;
  content: string;
  language: string;
  codeFilename: string; // the file being tested
}

/** Run Result — output of running a test. */
export interface RunResult {
  testFilename: string;
  codeFilename: string;
  output: string;
  exitCode: number | null;
  passed: boolean;
  summary: string;
  // If debugging was attempted
  debugged?: boolean;
  debugOutput?: string;
}

// ─── Plan Artifact (legacy compat — still used for checkpointing) ───
export type PhaseStatus = 'pending' | 'in_progress' | 'verified' | 'failed' | 'blocked';

export interface PlanUnknown {
  question: string;
  resolution?: string;
  escalated?: boolean;
}

export interface PlanPhase {
  id: string;
  title: string;
  dependsOn: string[];
  acceptanceCriteria: string[];
  status: PhaseStatus;
  unknowns: PlanUnknown[];
  explicitCommands?: { build?: string; test?: string; run?: string };
  implementationNotes?: string;
  verification?: VerificationOutcome[];
  retryCount?: number;
  /** Preserved code document from interrupted runs (#9). */
  codeDocument?: CodeDocument;
  /** Preserved test document from interrupted runs (#9). */
  testDocument?: TestDocument;
}

export const MAX_PHASE_RETRIES = 3;
export const MAX_TEST_ROUNDS = 5;

export interface VerificationOutcome {
  criterion: string;
  passed: boolean;
  detail: string;
  command?: string;
  exitCode?: number;
  output?: string;
}

export interface PlanArtifact {
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  phases: PlanPhase[];
  createdAt: number;
  updatedAt: number;
  // SOP documents (populated as the pipeline progresses)
  prd?: PrdDocument;
  design?: DesignDocument;
  taskList?: TaskList;
}

// ─── Helper functions ───
export function isPlanFullyVerified(plan: PlanArtifact): boolean {
  return plan.phases.length > 0 && plan.phases.every((p) => p.status === 'verified');
}

export function hasUnresolvedUnknowns(phase: PlanPhase | Task): boolean {
  return phase.unknowns.some((u) => !u.resolution && !u.escalated);
}

export function phaseDependenciesSatisfied(phase: PlanPhase | Task, plan: PlanArtifact | { phases: PlanPhase[] } | { tasks: Task[] }): boolean {
  const deps = phase.dependsOn;
  if ('phases' in plan) {
    return deps.every((depId) => plan.phases.find((p) => p.id === depId)?.status === 'verified');
  }
  if ('tasks' in plan) {
    return deps.every((depId) => plan.tasks.find((t) => t.id === depId)?.status === 'verified');
  }
  return false;
}

/** Convert a TaskList to PlanArtifact phases for checkpoint compat. */
export function taskListToPhases(taskList: TaskList): PlanPhase[] {
  return taskList.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dependsOn: t.dependsOn,
    acceptanceCriteria: t.acceptanceCriteria,
    status: t.status,
    unknowns: t.unknowns,
    implementationNotes: t.implementationNotes,
    verification: t.verification,
    retryCount: t.retryCount,
    // #9: Preserve code/test documents so interrupted runs can resume with partial work
    codeDocument: t.codeDocument,
    testDocument: t.testDocument,
  }));
}
