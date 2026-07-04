import type {
  Message,
  EngineEvent,
  SessionEvent,
  CompletionMessage,
  ProviderId,
  AgentXConfig,
  AgentPersonaConfig,
  RemediationAction,
  Plan,
  PermissionRule,
  PermissionDecision,
  QuestionnairePayload,
  ClarificationSource,
  QuestionnaireRecord,
} from '@agentx/shared';
import { FailoverReason, generateMessageId, getLogger, resolveSpaceError, appendStreamText, extractStreamTextDelta, type ChannelKind, getConfigDir } from '@agentx/shared';
import { Scope } from '../concurrency/Scope.js';
import { Mutex } from '../concurrency/Mutex.js';
import { join, resolve, normalize } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { ProviderFactory } from '../providers/index.js';
import { AgentLifecycle } from './AgentLifecycle.js';
import { AgentEventBus } from '../EventBus.js';
import { TokenTracker } from '../session/TokenTracker.js';
import { estimateOutputTokens } from '../session/tokenCount.js';
import { SubAgentManager } from './SubAgentManager.js';
import { TaskManager } from './TaskManager.js';
import { setTaskManagerInstance } from '../commands/builtin/tasks.js';
import { registerSessionTodoManager } from '../tools/TodoAccess.js';
import { setSubAgentManagerInstance } from '../tools/builtin/subagent.js';
import { setCrewDelegator } from '../tools/builtin/delegate-to-crew.js';
import { setCrewHubSearcher } from '../tools/builtin/search-crew-hub.js';
import { buildCrewRosterHintBlock } from '../crew/crew-roster-hint.js';
import { createCrewKeywordExpander } from '../crew/crew-keyword-expander.js';
import { getCrewSuggestionService } from '../crew/get-crew-store.js';
import { ensureCrewMembersOnRoster, type CrewCatalogRecruitStore } from '../crew/crew-mission-deploy.js';
import { buildCrewSuggestionSearchQuery } from './crew-auto-compose.js';
import { scoreMatchCandidates, type RawMatchRow } from '../crew/CrewMatchService.js';
import { setToolRegistryInstance } from '../commands/builtin/tools.js';
import { SecretSauceManager } from '../secret-sauce/index.js';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
import { ExperienceEngine } from '../neural/ExperienceEngine.js';
import { GrowthEngine } from '../neural/GrowthEngine.js';
import { createPgNeuralDb } from '../neural/NeuralDbAdapter.js';
import { MemoryFabric, type MemoryNode } from '../neural/MemoryFabric.js';
import { OnnxEmbeddingProvider } from '../neural/OnnxEmbeddingProvider.js';
import { GraphRagRetriever } from '../neural/GraphRagRetriever.js';
import type { EmbeddingProvider } from '@agentx/shared';
import { PromptAssembly, type SourceSnapshot, createProviderPromptSection, createIdentitySection, createWorkingDirectorySection, createRulesSection, createCompactRulesSection, createLocalPersonaGuardSection, createCrewPrivateConductSection, createQuestionnaireGuideSection, createCrewRosterGuideSection, createChatMarkdownSection, createCurrentTimeSection, createSchedulingSection, createLearningsSection, createSkillsSection, createFormalSkillsSection, createHyperdriveSection, createChannelFocusSection, createChannelSuperSessionSection, createChannelMessagingSection, createMultiCrewSection, createUserSection, createTaskPanelSection, createSessionNarrativeSection, createTurnFeedbackSection, createSoulSection, createInstructionsSection, createNeuralSection, createMemoryContextSection, createSystemOverrideSection, type SectionContext } from '../secret-sauce/prompt-assembly/index.js';
import { registerChannelPermissionBridge } from '../channels/channel-permission-bridge.js';
import {
  buildCompletionMessages,
  COMPACT_MEMORY_MAX_CHARS,
  FULL_MEMORY_MAX_CHARS,
  isCompactContextProfile,
} from './context-profile.js';
import { ErrorShield } from './ErrorShield.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { getModelPricing } from '../providers/pricing.js';
import { createDefaultToolkit } from '../tools/toolkit.js';
import { CommandRegistry } from '../commands/index.js';
import { GitManager } from '../session/GitManager.js';
import { BackgroundQueue } from '../session/BackgroundQueue.js';
import { FileWatcher } from '../session/FileWatcher.js';
import { ModelRouter } from '../session/ModelRouter.js';
import type { TaskType } from '../session/ModelRouter.js';
import { setBackgroundQueueInstance } from '../commands/builtin/tasks.js';
import { setRecipeEngineInstance } from '../commands/builtin/recipe.js';
import { RecipeEngine } from '../session/RecipeEngine.js';
import { setUserCommandRegistryInstance } from '../commands/builtin/commands.js';
import { getRAGEngineInstance, setIndexerEventBus } from '../commands/builtin/rag_index.js';
import type { UserCommandConfig } from '../commands/UserCommandRegistry.js';
import { UserCommandRegistry } from '../commands/UserCommandRegistry.js';
import { PromptEngine } from '../prompt/PromptEngine.js';
import { SmartSubAgent } from './SmartSubAgent.js';
import type { IntentResult } from '../prompt/PromptEngine.js';
import { DecisionEngine } from './DecisionEngine.js';
import type { DecisionResult } from './DecisionEngine.js';
import { AgentBus, getAgentBus } from './AgentBus.js';
import { SpecialistRegistry } from './SpecialistRegistry.js';
import type { SpecialistType } from './SpecialistRegistry.js';
import { SkillGenerator } from './SkillGenerator.js';
import { ReflectionLoop } from './ReflectionLoop.js';
import { SkillRegistry } from './SkillRegistry.js';
import { TreeOfThoughts } from '../reasoning/TreeOfThoughts.js';
import { ResearchEngine } from '../reasoning/ResearchEngine.js';
import { CrewOrchestrator, buildCrewPrivateFastReplyPrompt, type CrewMember } from './CrewOrchestrator.js';
import {
  assessCrewNeed,
  buildRoutingTaskForActiveCrew,
  crewDelegationMatchesTask,
  isGeneralKnowledgeQuery,
  shouldBypassActiveCrewRouting,
} from './crew-auto-compose.js';
import { CrewMissionOrchestrator, type CrewMissionOptions, type CrewMissionResult } from './CrewMissionOrchestrator.js';
import { setCrewMissionDeps } from '../tools/builtin/spawn-crew-workers.js';
import { isMissionInProgress } from './crew-mission-registry.js';
import { evaluateCrewDelegation } from './crew-delegation-guard.js';
import { ContextTracker } from './ContextTracker.js';
import { TurnFeedbackService } from '../feedback/TurnFeedbackService.js';
import { AutonomousDiagnosticsSystem, type SessionContext } from './AutonomousDiagnosticsSystem.js';

import { TodoManager } from './TodoManager.js';
import type { SessionLogger } from '../session/SessionLogger.js';
import { COMPACTION_PROMPT, COMPACTION_UPDATE_PROMPT } from './compaction-prompt.js';
import { getTokenThresholds, isTokenOverflow, estimateTokens, estimateMessagesTokens, getOutputReserve } from '@agentx/shared';

// ─── UNIFIED PIPELINE IMPORTS (Phase 1-11 integration) ───
import { InputNormalizer } from '../communication/InputNormalizer.js';
import { ErrorClassifier } from '../communication/ErrorClassifier.js';
import { TelemetryEmitter } from '../communication/telemetry/TelemetryEmitter.js';
import { AuthProfileManager } from '../providers/AuthProfileManager.js';
import { VisualEventBridge } from '../communication/visuals/VisualEventBridge.js';
import { CommandQueue } from '../communication/CommandQueue.js';
import { RunStateManager } from '../agent/RunStateManager.js';
import { TurnStateManager, type TurnPhase } from './TurnStateManager.js';
import { ToolLedger } from './ToolLedger.js';
import {
  isWriteTool,
  shouldEscalateForExecution,
  shouldUseInteractivePlanGates,
} from './plan-mode-utils.js';
import { createAiSdkModel, createAiSdkTools } from './AiSdkBridge.js';
import { buildGoogleAiSdkProviderOptions, buildProviderConnectivityProbeUrl } from '../providers/google/gemini-metadata.js';
import { createAiSdkStreamHandler } from './AiSdkStreamHandler.js';
import type { PartPersistFn } from './AiSdkStreamHandler.js';
import { streamText, stepCountIs } from 'ai';
import {
  buildWebSearchTurnInstruction,
  isWebSearchAvailableForChat,
  resolveWebSearchTurnPolicy,
  resolveWebSearchTurnPolicyAsync,
  createWebSearchIntentClassifier,
  type WebSearchTurnPolicy,
} from '../search/web-search-policy.js';
import { isPermissionExemptTool } from '../tools/permissions/exempt-tools.js';
import { SessionRunner } from '../session/SessionRunner.js';
import { BUILTIN_AGENTS } from './agent-configs.js';
// IntentClassifier import removed — DecisionEngine (heuristic) handles all routing
function getLoadingSteps(_intent: string): Array<{ id: string; label: string; status: 'active' | 'completed' | 'pending' }> {
  const labels: string[] = ['Thinking…', 'Working…', 'Processing…', 'One moment…'];
  return [{ id: 'load', label: labels[Math.floor(Math.random() * labels.length)]!, status: 'active' as const }];
}

export interface AgentOptions {
  config: AgentXConfig;
  sessionId: string;
  scopePath?: string;
  systemPrompt?: string;
  toolExecutor?: ToolExecutor | EnhancedToolExecutor;
  toolRegistry?: ToolRegistry;
  gitAutoCommit?: boolean;
  gitAware?: boolean;
  eventBus?: AgentEventBus;
  onPart?: PartPersistFn;
  persona?: AgentPersonaConfig | null;
  store?: { saveTaskSnapshot: (s: any) => void; getTaskSnapshot: (sessionId: string) => Record<string, unknown> | null; deleteTaskSnapshot: (sessionId: string) => void };
  pgPool?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> } | null;
  maxSessionCost?: number;
  maxSessionDuration?: number;
  /** Live crew mission context — injected between agentic steps when revision advances */
  missionContextProvider?: () => { revision: number; block: string };
  /** Slim prompt stack for crew workers (no Agent-X identity bleed). */
  promptProfile?: 'default' | 'crew_worker' | 'crew_private';
  /** Host crew for 1:1 private chat sessions. */
  crewPrivateHost?: import('@agentx/shared').Crew;
  /** Background worker (sub-agent / crew) — skip interactive plan approval & mode escalation UI gates. */
  delegatedWorker?: boolean;
  /** Ephemeral scheduled automation run — must not clobber shared executor permissions or UI handlers. */
  automationRun?: boolean;
  /** Messaging channel session (Telegram/Slack/etc.) — agent mode only, per-tool approvals via channel UI. */
  channelSession?: boolean;
  /** Parent session ID — for crew workers to access the host conversation's neural brain memory. */
  parentSessionId?: string;
  /** Refresh MCP integration tools and return an optional turn hint before completion. */
  prepareIntegrationTools?: (userText: string) => Promise<string | undefined>;
}

export class Agent {
  private provider: ProviderInterface;
  private eventBus: AgentEventBus;
  private tokenTracker: TokenTracker;
  private messages: CompletionMessage[] = [];
  private config: AgentXConfig;
  private persona: AgentPersonaConfig | null = null;
  private sessionId: string;
  private scopePath: string;
  /** Public accessor for session ID — needed by SmartSubAgent to pass parentSessionId to crew workers. */
  get currentSessionId(): string { return this.sessionId; }
  private isProcessing = false;
  readonly lifecycle = new AgentLifecycle();
  private scope: Scope | null = null;
  private _abortSignalController: AbortController | null = null;
  private pendingInstruction: string | null = null;
  private pendingDelegateCrewIds: string[] | null = null;
  private turnWebSearchPolicy: WebSearchTurnPolicy = 'off';
  private forcedWebSearchToolName: 'deep_web_search' | 'web_search' | null = null;
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  private todoManager: TodoManager;
  private _secretSauce: SecretSauceManager | null = null;
  private get secretSauce(): SecretSauceManager { if (!this._secretSauce) { this._secretSauce = new SecretSauceManager(); } return this._secretSauce; }
  private memoryExtractor: MemoryExtractor | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: EnhancedToolExecutor;
  private toolRegistry?: ToolRegistry;
  private pendingPermissions = new Map<string, { resolve: (choice: 'allow_once' | 'allow_always' | 'deny') => void; toolName: string; path: string; riskLevel: string }>();
  private turnApprovedAll = false;
  private _onPart?: PartPersistFn;
  autoApproveTools = false;
  private _hyperdriveMode = false;
  private _preHyperdrivePlanMode = true;
  private options: Readonly<AgentOptions>;
  private promptAssembly: PromptAssembly;
  private promptSnapshot: Record<string, SourceSnapshot> | null = null;

  // ─── Execution Modes
  private planMode: boolean = false;
  private currentPlan: Plan | null = null;

  // ─── Agent Management
  private agentBus: AgentBus;
  private specialistRegistry: SpecialistRegistry;

  // ─── Session & Infrastructure
  private sessionRunner: SessionRunner;
  private gitManager: GitManager | null = null;
  private gitAutoCommit: boolean = false;

  // ─── File Watcher (lazy-init)
  private _fileWatcher: FileWatcher | null = null;
  private _modelRouter: ModelRouter | null = null;

  // ─── Autonomous Diagnostics System
  private diagnosticsSystem: AutonomousDiagnosticsSystem;
  private sessionContext: SessionContext | null = null;

  // ─── Prompt & Decision Engines
  private promptEngine: PromptEngine;
  private decisionEngine: DecisionEngine;
  private currentDecision: DecisionResult | null = null;
  private currentIntent: IntentResult | null = null;

  // ─── RAG
  private lastRagResults: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }> = [];

  // ─── Reflection & Learning (lazy-init)
  private _reflectionLoop: ReflectionLoop | null = null;
  private _skillGenerator: SkillGenerator | null = null;
  private _skillRegistry: SkillRegistry | null = null;

  // ─── Neural Engines (lazy-init)
  private _experienceEngine: ExperienceEngine | null = null;
  private _growthEngine: GrowthEngine | null = null;
  private _turnFeedbackService: TurnFeedbackService | null = null;
  private _neuralDb: any = null;
  private _pgPool: any = null;
  private _memoryFabric: MemoryFabric | null = null;
  private _memoryEmbedder: EmbeddingProvider | null = null;

  // ─── Health & Budget Tracking
  private _llmCallCount = 0;
  private _toolExecCount = 0;
  private _errorCount = 0;
  private _responseTimes: number[] = [];
  private _sessionStartTime = Date.now();
  private _maxSessionCost = 5.00;
  private _compactionCount = 0;

  // ─── Checkpoint
  private _pendingCheckpoint: { resolve: (action: any) => void; reject: (err: Error) => void; checkpointId: string } | null = null;

  // ─── Reasoners (lazy-init)
  private _treeOfThoughts: TreeOfThoughts | null = null;
  private researchEngine: ResearchEngine | null = null;

  // ─── Tool Call Log
  private toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }> = [];

  // ─── Model Selection
  private cachedModels: Map<string, number> = new Map();
  private cachedModelCapabilities: Map<string, unknown[]> = new Map();
  private groundedModels: Set<string> = new Set();
  private fallbackModel: string | null = null;

  // ─── Clarification & Approval
  private clarificationResolve: ((response: string) => void) | null = null;
  private clarificationReject: ((error: Error) => void) | null = null;
  /** Set when clarification wait was aborted (e.g. turn timeout) — forces resume path on next answer. */
  private clarificationStale = false;
  private activeClarificationResume: {
    kind: 'questionnaire' | 'crew_intake';
    questionnaireMessageId: string;
    userText?: string;
    delegateCrewIds?: string[];
    primaryCrewId?: string;
    crewIntakeFromPicker?: boolean;
  } | null = null;
  private _missionEventSeq = 0;
  private missionContextProvider?: () => { revision: number; block: string };
  private lastMissionContextRevision = -1;
  private pendingStepApproval: ((stepId: string, approved: boolean, description?: string) => void) | null = null;
  private pendingModeEscalation: ((accepted: boolean) => void) | null = null;
  private pendingStepCap: ((continueRun: boolean) => void) | null = null;
  private turnState = new TurnStateManager();
  private toolLedger = new ToolLedger();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private partialTurnContent = '';
  private currentTurnId: string | null = null;
  private readonly maxCompletionSteps = 25;
  private readonly crewPrivateCompletionSteps = 40;
  private stepCapExtra = 0;

  // ─── Lazy-init getters ───

  private get fileWatcher(): FileWatcher | null {
    return this._fileWatcher;
  }

  private get modelRouter(): ModelRouter | null {
    return this._modelRouter;
  }

  private get reflectionLoop(): ReflectionLoop {
    if (!this._reflectionLoop) this._reflectionLoop = new ReflectionLoop();
    return this._reflectionLoop;
  }

  private get skillGenerator(): SkillGenerator | null {
    return this._skillGenerator;
  }

  private get skillRegistry(): SkillRegistry | null {
    return this._skillRegistry;
  }

  get hyperdriveMode(): boolean {
    return this._hyperdriveMode;
  }

  toggleHyperdriveMode(): boolean {
    if (this.options.channelSession) return false;
    const wasPlan = this.planMode;
    this._hyperdriveMode = !this._hyperdriveMode;
    this.autoApproveTools = this._hyperdriveMode;
    if (this._hyperdriveMode) {
      this._preHyperdrivePlanMode = wasPlan;
      if (wasPlan) {
        this.switchAgent('build');
      }
      this.rebuildSystemPrompt();
      this.emit({ type: 'hyperdrive_entered', mode: 'agent', wasPlan });
    } else {
      const restorePlan = this._preHyperdrivePlanMode;
      if (restorePlan && !this.planMode) {
        this.switchAgent('plan');
      }
      this.rebuildSystemPrompt();
      this.emit({ type: 'hyperdrive_exited', mode: restorePlan ? 'plan' : 'agent', wasPlan: restorePlan });
    }
    return this._hyperdriveMode;
  }

  // Anti-duplicate: prevents double message_received within a single turn
  private _turnMessageEmitted = false;
  private activeStreamHandler: { discardCurrentStepText: () => void } | null = null;
  // Anti-duplicate: prevents repeated model capability warnings per session
  private _capabilityWarningEmitted = false;
  // ─── LAZY PIPELINE MODULES (created on first access) ───
  private _inputNormalizer: InputNormalizer | null = null;
  private get inputNormalizer(): InputNormalizer { if (!this._inputNormalizer) this._inputNormalizer = new InputNormalizer(); return this._inputNormalizer; }
  private _errorClassifier: ErrorClassifier | null = null;
  private get errorClassifier(): ErrorClassifier { if (!this._errorClassifier) this._errorClassifier = new ErrorClassifier(); return this._errorClassifier; }
  private _telemetry: TelemetryEmitter | null = null;
  private get telemetry(): TelemetryEmitter { if (!this._telemetry) this._telemetry = new TelemetryEmitter(); return this._telemetry; }
  private _authProfileManager: AuthProfileManager | null = null;
  private get authProfileManager(): AuthProfileManager { if (!this._authProfileManager) this._authProfileManager = new AuthProfileManager(); return this._authProfileManager; }
  private _visualBridge: VisualEventBridge | null = null;
  private get visualBridge(): VisualEventBridge { if (!this._visualBridge) this._visualBridge = new VisualEventBridge(); return this._visualBridge; }
  private _commandQueue: CommandQueue | null = null;
  private get commandQueue(): CommandQueue { if (!this._commandQueue) this._commandQueue = new CommandQueue(); return this._commandQueue; }
  private _runStateMgr: RunStateManager | null = null;
  private get runStateMgr(): RunStateManager { if (!this._runStateMgr) this._runStateMgr = new RunStateManager(); return this._runStateMgr; }
  private _telegramConnected = false;
  private _telegramChatId: number | null = null;
  private _crewOrchestrator: CrewOrchestrator | null = null;
  private _crewMissionOrchestrator: CrewMissionOrchestrator | null = null;
  private get crewMissionOrchestrator(): CrewMissionOrchestrator {
    if (!this._crewMissionOrchestrator) {
      this._crewMissionOrchestrator = new CrewMissionOrchestrator(this.eventBus);
      setCrewMissionDeps(this);
    }
    return this._crewMissionOrchestrator;
  }
  private get crewOrchestrator(): CrewOrchestrator {
    if (!this._crewOrchestrator) {
      this._crewOrchestrator = new CrewOrchestrator(this.provider, this.eventBus, this.tokenTracker);
      this._crewOrchestrator.setActiveModel(this.config.provider.activeModel);
      if (this.toolRegistry && this.toolExecutor) { this._crewOrchestrator.setTools(this.toolRegistry, this.toolExecutor); }
      this._crewOrchestrator.setConfig(this.config);
      this._crewOrchestrator.setSessionId(this.sessionId);
      this._crewOrchestrator.onTokenLog = (opts) => {
        this.onTokenLog?.({ ...opts, crewId: opts.crewId });
      };
      this._crewOrchestrator.onPersistCrewResponse = (response) => {
        getLogger().info('CREW_PERSIST', `Crew response from ${response.crewName} (${response.crewId})`);
      };
    }
    return this._crewOrchestrator;
  }
  private contextTracker!: ContextTracker;
  private compactionMarkerIndices: number[] = [];
  sessionLogger: SessionLogger | null = null;
  onTokenLog: ((opts: { inputTokens: number; outputTokens: number; costUsd: number; crewId?: string }) => void) | null = null;
  onSessionEvent: ((event: SessionEvent) => void) | null = null;

  setContextPersistDir(dir: string, scopePath?: string): void {
    this.contextTracker.setPersistDir(dir);
    if (scopePath) this.contextTracker.setScopePath(scopePath);
  }
  private maxSubAgents = 5;
  readonly serialLock: Mutex = new Mutex();
  private sessionManager: {
    createSession: (providerId: string, modelId: string, scopePath?: string, id?: string, parentId?: string) => { id: string };
    createChildSessionRecord?: (
      childId: string,
      parentId: string,
      providerId: string,
      modelId: string,
      scopePath?: string,
      meta?: { kind?: string; label?: string },
    ) => unknown;
    saveCrewState?: (crewId: string, enabled: boolean, messageCount?: number) => void;
  } | null = null;
  private enabledCrewSessionIds: Set<string> = new Set();

  setTelegramConnected(connected: boolean, chatId?: number | null): void {
    this._telegramConnected = connected;
    this._telegramChatId = chatId ?? this._telegramChatId;
    this.rebuildSystemPrompt();
  }

  /**
   * Respond to a pending clarification request.
   * @returns true when a waiter was active and the response was delivered.
   */
  respondToClarification(response: string): boolean {
    if (this.clarificationStale) return false;
    if (this.clarificationResolve) {
      const resolve = this.clarificationResolve;
      this.clarificationResolve = null;
      this.clarificationReject = null;
      resolve(response);
      return true;
    }
    return false;
  }

  isAwaitingClarification(): boolean {
    return this.clarificationResolve != null;
  }

  /** Abort a pending questionnaire wait (e.g. turn timeout). Next answer uses the resume path. */
  abortClarificationWait(): void {
    if (!this.clarificationReject) return;
    const reject = this.clarificationReject;
    this.clarificationResolve = null;
    this.clarificationReject = null;
    this.clarificationStale = true;
    reject(new Error('CLARIFICATION_ABORTED'));
  }

  getClarificationResumeState(): {
    kind: 'questionnaire' | 'crew_intake';
    messageId: string;
    questionnaireMessageId?: string;
    userText?: string;
    delegateCrewIds?: string[];
    primaryCrewId?: string;
    crewIntakeFromPicker?: boolean;
    createdAt: string;
  } | null {
    if (!this.activeClarificationResume) return null;
    return {
      kind: this.activeClarificationResume.kind,
      messageId: this.activeClarificationResume.questionnaireMessageId,
      questionnaireMessageId: this.activeClarificationResume.questionnaireMessageId,
      userText: this.activeClarificationResume.userText,
      delegateCrewIds: this.activeClarificationResume.delegateCrewIds,
      primaryCrewId: this.activeClarificationResume.primaryCrewId,
      crewIntakeFromPicker: this.activeClarificationResume.crewIntakeFromPicker,
      createdAt: new Date().toISOString(),
    };
  }

  clearClarificationResumeState(): void {
    this.activeClarificationResume = null;
  }

  recordCrewFeedback(crewId: string, positive: boolean): void {
    this.crewOrchestrator.recordFeedback(crewId, positive);
  }

  private clarificationSource(): ClarificationSource | undefined {
    if (this.options.promptProfile === 'crew_private' && this.options.crewPrivateHost) {
      return {
        kind: 'crew',
        name: this.options.crewPrivateHost.name,
        callsign: this.options.crewPrivateHost.callsign,
      };
    }
    if (this.options.promptProfile !== 'crew_worker') {
      return { kind: 'agent', name: 'Agent-X' };
    }
    return undefined;
  }

  private discardStreamPreambleBeforeQuestionnaire(): void {
    this.activeStreamHandler?.discardCurrentStepText();
  }

  private async waitForQuestionnaireResponse(questionnaire: QuestionnairePayload): Promise<string> {
    // Messaging channels have no UI questionnaire modal — waiting would hang forever.
    if (this.options.channelSession) {
      getLogger().info('CHANNEL', 'Auto-proceeding past questionnaire on messaging channel');
      return 'Proceed with your best judgment using available tools and context.';
    }
    const payload: QuestionnairePayload = questionnaire.source
      ? questionnaire
      : { ...questionnaire, source: this.clarificationSource() };
    this.turnState.setPhase('awaiting_permission', 'clarification');

    // Drop any assistant preamble streamed before ask_clarification in this step
    this.discardStreamPreambleBeforeQuestionnaire();

    const messageId = generateMessageId();
    const record: QuestionnaireRecord = { payload, status: 'pending' };
    const questionnaireMsg = this.buildQuestionnaireMessage(messageId, record);
    this.persistQuestionnaireMessage(questionnaireMsg);
    this.activeClarificationResume = {
      kind: this.activeClarificationResume?.kind ?? 'questionnaire',
      questionnaireMessageId: messageId,
      userText: this.activeClarificationResume?.userText,
      delegateCrewIds: this.activeClarificationResume?.delegateCrewIds,
      primaryCrewId: this.activeClarificationResume?.primaryCrewId,
      crewIntakeFromPicker: this.activeClarificationResume?.crewIntakeFromPicker,
    };
    this.emit({ type: 'clarification_required', questionnaire: payload });
    this.emit({ type: 'message_received', message: questionnaireMsg, elapsed: 0 });

    let response: string;
    try {
      response = await new Promise<string>((resolve, reject) => {
        this.clarificationResolve = resolve;
        this.clarificationReject = reject;
      });
    } finally {
      this.clarificationResolve = null;
      this.clarificationReject = null;
    }
    this.activeClarificationResume = null;

    const answered: QuestionnaireRecord = {
      payload,
      status: response === '(skipped)' ? 'skipped' : 'answered',
      answer: response,
      answeredAt: new Date().toISOString(),
    };
    const updatedMsg = this.buildQuestionnaireMessage(messageId, answered);
    this.updateQuestionnaireMessage(messageId, answered);
    this.emit({ type: 'message_received', message: updatedMsg, elapsed: 0, isUpdate: true });

    if (response && response !== '(skipped)') {
      // Keep answer in agent memory for subsequent turns — do not surface as a user chat bubble
      this.messages.push({ role: 'user', content: response });
    }

    this.discardStreamPreambleBeforeQuestionnaire();
    this.turnState.setPhase('running', 'resuming');
    this.emit({
      type: 'loading_start',
      stage: this.options.promptProfile === 'crew_private' ? 'crew_private' : 'thinking',
    });
    return response;
  }

  private buildQuestionnaireMessage(messageId: string, record: QuestionnaireRecord): Message {
    const host = this.options.crewPrivateHost;
    const crew = this.options.promptProfile === 'crew_private' && host
      ? {
        crewId: host.id,
        name: host.name,
        callsign: host.callsign,
        color: host.color,
        icon: host.icon,
      }
      : undefined;
    return {
      id: messageId,
      sessionId: this.sessionId,
      role: 'assistant',
      content: '',
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
      crew,
      parts: [{ type: 'questionnaire', id: record.payload.id, questionnaire: record }],
    };
  }

  private getMessageStore(): {
    insertMessage?: (msg: Record<string, unknown>) => string | void;
    updateMessage?: (sessionId: string, messageId: string, patch: Record<string, unknown>) => void;
  } | null {
    return (this.sessionManager as unknown as { store?: {
      insertMessage?: (msg: Record<string, unknown>) => string | void;
      updateMessage?: (sessionId: string, messageId: string, patch: Record<string, unknown>) => void;
    } } | null)?.store ?? null;
  }

  private persistQuestionnaireMessage(msg: Message): void {
    const store = this.getMessageStore();
    if (!store?.insertMessage) return;
    try {
      store.insertMessage({
        id: msg.id,
        sessionId: msg.sessionId,
        role: msg.role,
        content: msg.content,
        parts: msg.parts,
        tokenCount: msg.tokenCount ?? 0,
        metadata: msg.crew
          ? { crewId: msg.crew.crewId, crewName: msg.crew.name, callsign: msg.crew.callsign }
          : undefined,
      });
    } catch { /* best-effort */ }
  }

  private updateQuestionnaireMessage(messageId: string, record: QuestionnaireRecord): void {
    const store = this.getMessageStore();
    const parts = [{ type: 'questionnaire', id: record.payload.id, questionnaire: record }];
    store?.updateMessage?.(this.sessionId, messageId, { parts });
  }

  constructor(options: AgentOptions) {
    this.options = options;
    this.config = options.config;
    this.missionContextProvider = options.missionContextProvider;
    this.persona = options.persona ?? null;
    if (this.persona) {
      this.secretSauce.identity.seedFromPersona(this.persona);
    }
    this.sessionId = options.sessionId;
    this.scopePath = normalize(resolve(options.scopePath!));
    this._pgPool = options.pgPool ?? null;
    const crewHost = options.crewPrivateHost;
    this.contextTracker = new ContextTracker(null as any, this.sessionId,
      crewHost && options.promptProfile === 'crew_private'
        ? { kind: 'crew_private', hostCrewId: crewHost.id, hostCrewName: crewHost.name, hostCrewCallsign: crewHost.callsign }
        : undefined,
    );
    this.eventBus = options.eventBus ?? new AgentEventBus();
    this._onPart = options.onPart;

    // ─── Initialize Autonomous Diagnostics System ───
    this.diagnosticsSystem = new AutonomousDiagnosticsSystem();
    this.initializeDiagnosticsAsync(); // Fire and forget, but log results
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
    this.subAgents.setParentAgent(this);
    setSubAgentManagerInstance(this.subAgents);

    setCrewDelegator(async (crewName: string, taskDescription: string) => {
      if (!this.crewOrchestrator) return { success: false, output: 'No crews available.' };
      if (isMissionInProgress(this.sessionId)) {
        return { success: false, output: 'A crew mission is already running in this session.' };
      }
      const members = this.getActiveCrewMembers();
      const member = members.find((m) =>
        m.crew.name.toLowerCase() === crewName.toLowerCase() ||
        m.crew.callsign.toLowerCase() === crewName.toLowerCase()
      );
      if (!member) {
        const enabled = this.getActiveCrewMembers();
        return {
          success: false,
          output: enabled.length === 0
            ? `Crew "${crewName}" is not enabled in this session. Recruit specialists via crew suggestions or @mention after adding them to the session roster.`
            : `Crew "${crewName}" not found among session-enabled crew. Available: ${enabled.map(m => `${m.crew.name} (@${m.crew.callsign})`).join(', ')}`,
        };
      }
      if (isGeneralKnowledgeQuery(taskDescription)) {
        return {
          success: false,
          output: 'Crew delegation blocked: this is a general information question. Answer directly as Agent-X (use web search if needed).',
        };
      }
      if (!crewDelegationMatchesTask(taskDescription, [member])) {
        return {
          success: false,
          output: `Crew delegation blocked: @${member.crew.callsign} does not have expertise for this task. Answer directly as Agent-X.`,
        };
      }
      const guard = await this.guardCrewDelegation(taskDescription, [member]);
      if (!guard.allowed) {
        return {
          success: false,
          output: `Crew delegation blocked: ${guard.reason} Handle this yourself as Agent-X.`,
        };
      }
      const result = await this.runCrewMissionAndPublish([member], taskDescription, { emitLoading: true });
      return {
        success: result.success,
        output: result.responses.length > 0
          ? `[Crew @${member.crew.callsign} posted their response in chat.] Briefly acknowledge — do not repeat their analysis.`
          : (result.synthesized || `${member.crew.name} completed the task.`),
      };
    });

    setCrewHubSearcher(async (query, _sessionId, limit = 5) => {
      const store = (this.sessionManager as unknown as { store?: unknown })?.store;
      const service = getCrewSuggestionService(store);
      if (!service) return [];
      await service.ensureReady();
      type CatalogSearchStore = {
        searchCatalog: (q: string, n: number) => Promise<Array<Record<string, unknown> & { ftsRank: number }>>;
        searchRosterCrews: (q: string, n: number) => Promise<Array<Record<string, unknown> & { ftsRank: number }>>;
        listRecruitedCatalogIds: () => Promise<Set<string>>;
      };
      const catalogStore = (store as { getCrewCatalogStore?: () => CatalogSearchStore | null })
        ?.getCrewCatalogStore?.() ?? null;
      if (!catalogStore) return [];

      const searchQuery = buildCrewSuggestionSearchQuery(query);
      const recruited = await catalogStore.listRecruitedCatalogIds();
      const catalogHits = await catalogStore.searchCatalog(searchQuery, 20);
      const rosterHits = await catalogStore.searchRosterCrews(searchQuery, 20);
      const rows: RawMatchRow[] = [];

      for (const hit of catalogHits) {
        if (recruited.has(String(hit.id))) continue;
        rows.push({
          id: String(hit.id),
          origin: 'hub_catalog',
          callsign: String(hit.callsign ?? ''),
          name: String(hit.name ?? ''),
          title: String(hit.title ?? ''),
          categoryLabel: hit.categoryLabel as string | undefined,
          description: String(hit.description ?? ''),
          expertise: (hit.expertise as string[]) ?? [],
          traits: (hit.traits as string[]) ?? [],
          catalogId: String(hit.id),
          onRoster: false,
          ftsRank: hit.ftsRank,
          systemPrompt: hit.systemPrompt as string | undefined,
        });
      }
      for (const crew of rosterHits) {
        rows.push({
          id: String(crew.id),
          origin: crew.source === 'custom' ? 'custom' : 'hub_roster',
          callsign: String(crew.callsign ?? ''),
          name: String(crew.name ?? ''),
          title: String(crew.title ?? ''),
          description: String(crew.description ?? ''),
          expertise: (crew.expertise as string[]) ?? [],
          traits: (crew.traits as string[]) ?? [],
          catalogId: crew.catalogId as string | undefined,
          onRoster: true,
          enabled: crew.enabled as boolean | undefined,
          ftsRank: crew.ftsRank,
          systemPrompt: crew.systemPrompt as string | undefined,
        });
      }

      const scored = scoreMatchCandidates(searchQuery, rows);
      return scored.slice(0, limit).map((c) => ({
        id: c.id,
        callsign: c.callsign,
        name: c.name,
        title: c.title,
        matchScore: c.matchScore,
        expertise: c.expertise,
        onRoster: c.onRoster,
        origin: c.origin,
        categoryLabel: c.categoryLabel,
      }));
    });

    this.taskManager = new TaskManager(this.eventBus);
    setTaskManagerInstance(this.taskManager);
    this.todoManager = new TodoManager(this.eventBus);
    registerSessionTodoManager(this.sessionId, this.todoManager);
    setIndexerEventBus(this.eventBus);
    // secretSauce is lazy — created on first access via getter
    this.errorShield = new ErrorShield();

    // Set up tools - use provided or create defaults
    if (options.toolExecutor && options.toolRegistry) {
      // Accept both ToolExecutor and EnhancedToolExecutor from options
      if (options.toolExecutor instanceof EnhancedToolExecutor) {
        this.toolExecutor = options.toolExecutor;
      } else if (options.toolExecutor instanceof ToolExecutor && !(options.toolExecutor instanceof EnhancedToolExecutor)) {
        // Wrap plain ToolExecutor in Enhanced for parallel/doom-loop/repair capabilities
        this.toolExecutor = new EnhancedToolExecutor(options.toolRegistry, this.scopePath);
        // Copy handlers and hooks from provided executor
        const providedHandlers = (options.toolExecutor as unknown as Record<string, unknown>)['handlers'] as
          | Map<string, (args: Record<string, unknown>, ctx: import('@agentx/shared').ToolExecutionContext) => Promise<import('@agentx/shared').ToolResult>>
          | undefined;
        if (providedHandlers) {
          for (const [name, handler] of providedHandlers) {
            this.toolExecutor.registerHandler(name, handler);
          }
        }
        // Copy permission handlers from shared toolkit executor
        const providedExecutor = options.toolExecutor as unknown as Record<string, unknown>;
        const permHandler = providedExecutor['permissionRequestHandler'];
        if (typeof permHandler === 'function') {
          this.toolExecutor.setPermissionRequestHandler(permHandler as (toolId: string, path: string, riskLevel: string) => Promise<'allow_once' | 'allow_always' | 'deny'>);
        }
        const channelPermHandler = providedExecutor['channelPermissionRequestHandler'];
        if (typeof channelPermHandler === 'function') {
          this.toolExecutor.setChannelPermissionRequestHandler(channelPermHandler as (toolId: string, path: string, riskLevel: string) => Promise<'allow_once' | 'allow_always' | 'deny'>);
        }
      } else {
        // Plain mock object from tests — wrap it
        this.toolExecutor = new EnhancedToolExecutor(options.toolRegistry, this.scopePath);
        const mockObj = options.toolExecutor as unknown as Record<string, unknown>;
        if (typeof mockObj['execute'] === 'function') {
          const mockExec = mockObj['execute'] as (...args: unknown[]) => Promise<unknown>;
          (this.toolExecutor as unknown as Record<string, unknown>)['execute'] = mockExec;
        }
        if (typeof mockObj['setPermissionRequestHandler'] === 'function') {
          this.toolExecutor.setPermissionRequestHandler = mockObj['setPermissionRequestHandler'] as unknown as typeof this.toolExecutor['setPermissionRequestHandler'];
        }
        if (typeof mockObj['setBeforeToolHook'] === 'function') {
          this.toolExecutor.setBeforeToolHook = mockObj['setBeforeToolHook'] as unknown as typeof this.toolExecutor['setBeforeToolHook'];
        }
        if (typeof mockObj['setScopePath'] === 'function') {
          this.toolExecutor.setScopePath = mockObj['setScopePath'] as unknown as typeof this.toolExecutor['setScopePath'];
        }
      }
      this.toolRegistry = options.toolRegistry;
    } else {
      const effectiveScope = this.scopePath;
      const toolkit = createDefaultToolkit(effectiveScope);
      this.toolRegistry = toolkit.registry;
      // Use EnhancedToolExecutor for parallel/doom-loop/repair capabilities
      this.toolExecutor = new EnhancedToolExecutor(toolkit.registry, effectiveScope);
      // Copy handlers from factory executor
      const handlersMap = (toolkit.executor as unknown as Record<string, unknown>)['handlers'] as
        | Map<string, (args: Record<string, unknown>, ctx: import('@agentx/shared').ToolExecutionContext) => Promise<import('@agentx/shared').ToolResult>>
        | undefined;
      if (handlersMap) {
        for (const [name, handler] of handlersMap) {
          this.toolExecutor.registerHandler(name, handler);
        }
      }
    }
    setToolRegistryInstance(this.toolRegistry ?? null);

    this.sessionRunner = new SessionRunner({
      sessionId: this.sessionId,
      config: this.config,
      eventBus: this.eventBus,
      toolRegistry: this.toolRegistry!,
      toolExecutor: this.toolExecutor!,
      apiKey: this.getApiKey(),
      waitForClarification: async (questionnaire: QuestionnairePayload) => {
        return this.waitForQuestionnaireResponse(questionnaire);
      },
      runSubAgent: async (instruction, toolsList, timeout, background) => {
        const task = this.subAgents.spawn(instruction, toolsList ?? [], timeout, this.maxSubAgents);
        if (!task) {
          return { success: false, output: 'Sub-agent limit reached. Wait for existing sub-agents to complete.', elapsed: 0 };
        }
        if (background) {
          this.emit({ type: 'task_backgrounded', taskId: task.id } as EngineEvent);
          return { success: true, output: `[Sub-agent started in background — task ${task.id}]`, elapsed: 0, agentId: task.id };
        }
        const completed = await this.subAgents.waitFor(task.id);
        return {
          success: completed?.status === 'completed',
          output: completed?.result ?? '',
          elapsed: (completed?.endTime ?? Date.now()) - (completed?.startTime ?? Date.now()),
          agentId: task.id,
        };
      },
      onTokenUsage: (input, output) => {
        this.tokenTracker.addTokenUsage(input, output);
        this.onTokenLog?.({ inputTokens: input, outputTokens: output, costUsd: 0 });
      },
      gitManager: this.gitManager ?? undefined,
      onSessionEvent: this.onSessionEvent ?? undefined,
      modelName: this.config.provider.activeModel,
      planMode: () => this.planMode,
    });

    // Reset permissions for each new session — automation runs reuse the shared executor snapshot.
    if (this.toolExecutor && !this.options.automationRun) {
      this.toolExecutor.getPermissionManager().resetForNewSession(this.sessionId);
      if (this.options.channelSession) {
        this.toolExecutor.setAlwaysPromptPermissions(true);
      }
    } else if (this.toolExecutor && this.options.channelSession) {
      this.toolExecutor.setAlwaysPromptPermissions(true);
    }

    // Load user-configured permission overrides from config
    if (this.config.permissions && this.toolExecutor) {
      const userRules: PermissionRule[] = Object.entries(this.config.permissions).map(([key, effect]) => {
        const colonIdx = key.indexOf(':');
        if (colonIdx >= 0) {
          return { action: key.slice(0, colonIdx), pattern: key.slice(colonIdx + 1), effect };
        }
        return { action: `tool:${key}`, pattern: '*', effect };
      });
      this.toolExecutor.setUserConfigRules(userRules);
    }

    // Wire permission requests to event bus (skipped for ephemeral automation workers and channel sessions).
    if (this.toolExecutor && !this.options.automationRun && !this.options.channelSession) {
      this.bindPermissionHandler();

      // Wire diff preview for file edit tools
      this.toolExecutor.setBeforeToolHook((toolId, args, path) => {
        if (path && ['file_write', 'code_replace', 'code_insert'].includes(toolId)) {
          const oldContent = path && existsSync(path) ? readFileSync(path, 'utf-8') : '';
          const newContent = (args['content'] as string) ?? (args['newContent'] as string) ?? (args['code'] as string) ?? '';
          if (oldContent || newContent) {
            const diff = generateDiff(oldContent, newContent);
            this.emit({ type: 'diff_preview', tool: toolId, filePath: path, diff, oldContent, newContent });
          }
        }
      });
    }

    // Git integration
    this.gitAutoCommit = options.gitAutoCommit ?? false;
    if (options.gitAware || this.gitAutoCommit) {
      this.gitManager = new GitManager({ scopePath: this.scopePath });
    }

    // Apply git-aware scope if requested
    if (options.gitAware && this.gitManager?.isInsideRepo()) {
      const repoRoot = this.gitManager.getRepoRoot();
      if (repoRoot && this.toolExecutor) {
        this.toolExecutor.setScopePath(repoRoot);
      }
    }

    // Initialize background queue (global singleton, not stored on `this`)
    {
      const bq = new BackgroundQueue();
      bq.onComplete((task) => {
        this.eventBus.emit({ type: 'background_task_complete', taskId: task.id, summary: `[${task.status}] ${task.command}`.slice(0, 120) });
      });
      setBackgroundQueueInstance(bq);
    }

    // modelRouter is lazy-init via getter

    // Initialize user command registry (global singleton, not stored on `this`)
    {
      const cmdRegistry = new CommandRegistry();
      const ucr = new UserCommandRegistry(cmdRegistry);
      setUserCommandRegistryInstance(ucr);
      const userCmds = (options.config as unknown as Record<string, unknown>)['commands'] as UserCommandConfig[] | undefined;
      if (userCmds) {
        ucr.loadFromConfig(userCmds);
      }
    }

    // Initialize recipe engine (global singleton, not stored on `this`)
    {
      const re = new RecipeEngine();
      setRecipeEngineInstance(re);
      const recipeDir = join(getConfigDir(), 'recipes');
      re.addDirectory(recipeDir);
    }

    // fileWatcher is lazy-init via getter (creates + sets up listeners on first access)

    this.provider = ProviderFactory.create(
      options.config.provider.activeProvider,
      this.getApiKey(),
      this.getBaseUrl(),
    );

    // crewOrchestrator is lazy-init (created on first access)
    this.maxSubAgents = options.config.maxSubAgents ?? 5;

    // Initialize prompt engine for token-efficient prompting
    this.promptEngine = new PromptEngine(this.getContextWindow());

    // Initialize decision engine for message classification and routing
    this.decisionEngine = new DecisionEngine();

    // IntentClassifier removed — DecisionEngine (heuristic) handles all routing

    // Initialize agent mesh components
    this.agentBus = getAgentBus();
    this.agentBus.attachEventBus(this.eventBus);
    this.specialistRegistry = new SpecialistRegistry(this.agentBus);
    // skillGenerator and reflectionLoop are lazy-init (created on first access)

    // Register this agent on the bus with persona identity
    const identity = this.options.promptProfile === 'crew_private' && this.options.crewPrivateHost
      ? this.options.crewPrivateHost.name
      : (this.persona?.name || 'Agent-X');
    this.agentBus.registerAgent(this.sessionId, [identity]);

    // ─── LAZY PIPELINE — components created on first access via getters ───
    const apiKey = this.getApiKey() ?? '';
    if (apiKey) {
      this.authProfileManager.addCredential(options.config.provider.activeProvider, apiKey);
    }

    if (process.env['NODE_ENV'] !== 'test') {
      this.trialModel(options.config.provider.activeModel).catch(() => {});
    }

    // Build system prompt using PromptAssembly (typed, diff-able sections)
    this.promptAssembly = new PromptAssembly();
    this.registerPromptSections(this.options.systemPrompt);
    const initGen = this.promptAssembly.initializeSync();
    this.promptSnapshot = initGen.snapshot;

    if (initGen.baseline) {
      this.messages.push({
        role: 'system',
        content: initGen.baseline,
      });
    }

    // Configure sub-agents with provider so they can make real LLM calls
    this.subAgents.configure(this.provider, this.config, initGen.baseline);

    // Trigger periodic summarization in the background if stale
    if (this.secretSauce.summarizer.needsSummarization()) {
      void this.runSummarization();
    }
  }

  get events(): AgentEventBus {
    return this.eventBus;
  }

  get tokens(): TokenTracker {
    return this.tokenTracker;
  }

  get processing(): boolean {
    return this.lifecycle.isProcessing();
  }

  get abortSignal(): AbortSignal | undefined {
    if (!this.scope) {
      if (this._abortSignalController) {
        this._abortSignalController.abort();
        this._abortSignalController = null;
      }
      return undefined;
    }
    if (!this._abortSignalController) {
      this._abortSignalController = new AbortController();
      this.scope.onDispose(() => {
        this._abortSignalController?.abort();
      });
    }
    return this._abortSignalController.signal;
  }

  /** Public accessor for the visual event bridge (TUI/Web UI can subscribe) */
  get visuals(): VisualEventBridge {
    return this.visualBridge;
  }

  get watcherCount(): number {
    return this.fileWatcher?.watcherCount ?? 0;
  }

  get toolCount(): number {
    return this.toolRegistry?.list().length ?? 165;
  }

  // ─── Neural Engine Accessors
  private get experienceEngine(): ExperienceEngine {
    if (!this._experienceEngine) { const db = this.getNeuralDb(); this._experienceEngine = new ExperienceEngine(db); }
    return this._experienceEngine;
  }
  private get growthEngine(): GrowthEngine {
    if (!this._growthEngine) { const db = this.getNeuralDb(); this._growthEngine = new GrowthEngine(db); }
    return this._growthEngine;
  }

  get turnFeedbackService(): TurnFeedbackService {
    if (!this._turnFeedbackService) {
      this._turnFeedbackService = new TurnFeedbackService(() => {
        return (this.sessionManager as unknown as { store?: import('../feedback/TurnFeedbackService.js').TurnFeedbackStore })?.store ?? null;
      });
    }
    return this._turnFeedbackService;
  }

  private getNeuralDb(): any {
    if (!this._neuralDb) {
      try {
        if (this._pgPool) { this._neuralDb = createPgNeuralDb(this._pgPool); }
        else { this._neuralDb = { prepare: () => ({ run: () => ({ changes: 0 }), get: () => null, all: () => [] }) }; }
      } catch { this._neuralDb = { prepare: () => ({ run: () => ({ changes: 0 }), get: () => null, all: () => [] }) }; }
    }
    return this._neuralDb;
  }

  private get memoryFabric(): MemoryFabric | null {
    if (!this._memoryFabric && this._pgPool) {
      this._memoryFabric = new MemoryFabric(this._pgPool);
    }
    return this._memoryFabric;
  }

  private get memoryEmbedder(): EmbeddingProvider | null {
    if (!this._memoryEmbedder) {
      this._memoryEmbedder = new OnnxEmbeddingProvider();
    }
    return this._memoryEmbedder;
  }

  private _memoryContextNodeIds: string[] = [];

  /** Tools whose results should be ingested into the neural brain for future RAG retrieval. */
  private static readonly WEB_SEARCH_TOOLS = new Set([
    'web_search', 'deep_web_search', 'web_fetch', 'web_scrape',
  ]);
  private _graphRagRetriever: GraphRagRetriever | null = null;

  private get graphRagRetriever(): GraphRagRetriever | null {
    // Neural brain can be disabled if embedding models failed to download.
    if (this.config.neuralBrain === false) return null;
    const fabric = this.memoryFabric;
    const embedder = this.memoryEmbedder;
    if (!fabric || !embedder) return null;
    if (!this._graphRagRetriever) {
      this._graphRagRetriever = new GraphRagRetriever(fabric, embedder);
    }
    return this._graphRagRetriever;
  }

  private usesCompactContext(): boolean {
    return isCompactContextProfile(
      this.config.provider.activeProvider,
      this.config.provider.activeModel,
      this.getContextWindow(),
    );
  }

  private rebuildPromptAssembly(): void {
    if (!this.promptAssembly) return;
    const baseline = this.messages.find((m) => m.role === 'system');
    const systemOverride = typeof baseline?.content === 'string' ? baseline.content : this.options.systemPrompt;
    this.promptAssembly = new PromptAssembly();
    this.registerPromptSections(systemOverride);
    const initGen = this.promptAssembly.initializeSync();
    this.promptSnapshot = initGen.snapshot;
    if (initGen.baseline) {
      this.setSystemPrompt(initGen.baseline);
    }
  }

  private async buildMemoryContext(): Promise<{ episodic: string; semantic: string; graph: string; community?: string }> {
    const retriever = this.graphRagRetriever;
    if (!retriever) return { episodic: '', semantic: '', graph: '' };
    try {
      const lastUser = [...this.messages].reverse().find((m) => m.role === 'user');
      const rawQuery = typeof lastUser?.content === 'string' ? lastUser.content : '';
      if (!rawQuery) return { episodic: '', semantic: '', graph: '' };

      // Query reformulation — rewrite follow-up messages into standalone search queries.
      const query = await this.reformulateQuery(rawQuery);

      // Use parent session ID for crew workers so they can access the host conversation's memory.
      const sessionId = this.options.parentSessionId ?? this.sessionId;
      const result = await retriever.retrieve(query, {
        sessionId,
        agentId: this.config.user?.callsign,
        globalLimit: 3,
        localLimit: 15,
        vectorLimit: 8,
        graphDepth: 2,
        minRelevance: 0.35,
      });

      // Additional pass: direct chunk search with a lower threshold to ensure
      // uploaded document chunks are always included in context, even when
      // entity extraction hasn't run yet or similarity is moderate.
      const fabric = this.memoryFabric;
      const embedder = this.memoryEmbedder;
      let chunkNodes: MemoryNode[] = [];
      if (fabric && embedder) {
        try {
          const chunkEmbedding = await embedder.embed(query);
          chunkNodes = await fabric.vectorSearch(chunkEmbedding, { limit: 5, category: 'source_doc' });
          // Filter by a lower threshold for chunks (0.25 — chunks are noisier).
          chunkNodes = chunkNodes.filter((n) => {
            const distance = (n as unknown as { distance?: number }).distance;
            return distance == null || (1 - distance) >= 0.25;
          });
        } catch { /* best-effort */ }
      }

      // Merge chunk nodes into the result set.
      const allNodeIds = new Set(result.all.map((n) => n.id));
      for (const cn of chunkNodes) {
        if (!allNodeIds.has(cn.id)) {
          result.vector.push(cn);
          result.all.push(cn);
          allNodeIds.add(cn.id);
        }
      }
      this._memoryContextNodeIds = result.all.map((n) => n.id).filter((id): id is string => !!id);

      // Token budget for memory context — prioritize community > episodic > semantic > graph.
      const MAX_CHARS = this.usesCompactContext() ? COMPACT_MEMORY_MAX_CHARS : FULL_MEMORY_MAX_CHARS;
      const fmt = (nodes: Array<{ label: string; content: string; category: string }>, maxChars: number) => {
        const lines: string[] = [];
        let used = 0;
        for (const n of nodes) {
          const line = `- [${n.category}] ${n.label}: ${n.content.replace(/\n+/g, ' ').slice(0, 200)}`;
          if (used + line.length > maxChars) break;
          lines.push(line);
          used += line.length + 1;
        }
        return lines.join('\n');
      };
      const communityText = result.global.length > 0
        ? result.global.map((n) => `${n.label}: ${n.content.replace(/\n+/g, ' ').slice(0, 300)}`).join('\n')
        : undefined;
      const communityChars = communityText?.length ?? 0;
      const remainingAfterCommunity = Math.max(0, MAX_CHARS - communityChars);
      // Split remaining budget: 40% episodic, 30% semantic (incl. chunks), 30% graph.
      const episodicText = fmt(result.episodic, Math.floor(remainingAfterCommunity * 0.4));
      const semanticText = fmt(result.vector, Math.floor(remainingAfterCommunity * 0.3));
      const graphText = fmt([...result.local, ...result.graph], Math.floor(remainingAfterCommunity * 0.3));

      if (semanticText || communityText || episodicText || graphText) {
        getLogger().info('AGENT', `buildMemoryContext: ${result.all.length} nodes (community=${result.global.length}, episodic=${result.episodic.length}, semantic=${result.vector.length}, graph=${result.local.length + result.graph.length}, chunks=${chunkNodes.length})`);
      }

      return {
        community: communityText,
        episodic: episodicText,
        semantic: semanticText,
        graph: graphText,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      getLogger().warn('AGENT', `buildMemoryContext failed: ${msg}`);
      this._memoryContextNodeIds = [];
      return { episodic: '', semantic: '', graph: '' };
    }
  }

  /**
   * Reformulate a user message into a standalone search query using conversation context.
   * Short follow-ups like "yes", "continue", "what about X?" get expanded into full
   * queries so RAG retrieval finds relevant memory instead of matching on noise.
   * Falls back to the raw message if reformulation fails.
   */
  private async reformulateQuery(rawQuery: string): Promise<string> {
    const trimmed = rawQuery.trim();

    // Compact local models: avoid an extra LLM call; stitch short follow-ups from recent user text.
    if (this.usesCompactContext()) {
      if (trimmed.length > 80) return trimmed;
      const recentUserMsgs = this.messages
        .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
        .slice(-3)
        .map((m) => (m as { content: string }).content);
      if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
        return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
      }
      return trimmed;
    }

    // Fast path: if the message is long and self-contained, skip reformulation.
    if (trimmed.length > 120 && /[.!?]$/.test(trimmed)) return trimmed;
    // Fast path: single-word or very short messages always need context.
    if (trimmed.split(/\s+/).length <= 3) {
      // Find the last substantive user message for context.
      const recentUserMsgs = this.messages
        .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
        .slice(-3)
        .map((m) => (m as any).content as string);
      if (recentUserMsgs.length === 0) return trimmed;
    }

    try {
      const recentContext = this.messages
        .slice(-6)
        .filter((m) => typeof m.content === 'string')
        .map((m) => `${m.role}: ${(m as any).content as string}`.slice(0, 200))
        .join('\n');

      const prompt = `Rewrite the user's latest message into a standalone search query for a knowledge retrieval system.

Conversation context (most recent first):
${recentContext}

Latest user message: "${rawQuery}"

Rules:
- Output ONLY the reformulated search query, nothing else.
- Incorporate context from the conversation so the query is self-contained.
- If the message is already a clear standalone question, return it as-is.
- Keep it concise (1-2 sentences max).
- Do not add quotes or prefixes.`;

      let reformulated = '';
      const request = {
        model: this.config.provider.activeModel,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: 150,
        stream: false,
      };
      for await (const chunk of this.provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) reformulated += chunk.content;
      }
      const cleaned = reformulated.trim().replace(/^["']|["']$/g, '');
      return cleaned || rawQuery;
    } catch {
      return rawQuery;
    }
  }

  private async reinforceMemoryContext(): Promise<void> {
    const fabric = this.memoryFabric;
    if (!fabric || this._memoryContextNodeIds.length === 0) return;
    await Promise.all(this._memoryContextNodeIds.map((id) => fabric.reinforce(id).catch(() => {})));
  }

  /**
   * Ingest web search / fetch tool results into the neural brain so discovered
   * knowledge is persisted for future RAG retrieval across all agents and crew.
   * Uses the shared MemoryService via the engine's neural brain pipeline.
   */
  private async ingestWebSearchResult(toolId: string, args: Record<string, unknown> | undefined, output: string): Promise<void> {
    try {
      if (this.config.neuralBrain === false) return;
      if (!this._pgPool) return;
      const query = typeof args?.['query'] === 'string' ? args['query'] : '';
      const url = typeof args?.['url'] === 'string' ? args['url'] : '';
      const label = query
        ? `Web Search: ${query.slice(0, 80)}`
        : url
          ? `Web Fetch: ${url.slice(0, 80)}`
          : `Web Result (${toolId})`;
      const content = query
        ? `Search query: ${query}\n\nResults:\n${output.slice(0, 4000)}`
        : `Source: ${url}\n\nContent:\n${output.slice(0, 4000)}`;

      // Use the engine's MemoryService for structured extraction + embedding.
      const { MemoryService } = await import('../neural/MemoryService.js');
      const { OnnxEmbeddingProvider } = await import('../neural/OnnxEmbeddingProvider.js');
      const embedder = new OnnxEmbeddingProvider();
      // Build a generate function from the agent's provider for LLM-based extraction.
      const generate = async (prompt: string) => {
        let text = '';
        const request = {
          model: this.config.provider.activeModel,
          messages: [{ role: 'user' as const, content: prompt }],
          temperature: 0,
          maxTokens: 2048,
          stream: false,
        };
        for await (const chunk of this.provider.complete(request)) {
          if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
        }
        return text;
      };
      const service = new MemoryService(this._pgPool as any, embedder, generate);
      await service.ingest({
        text: content,
        label,
        category: 'source_doc',
        extract: true,
        embed: true,
        sessionId: this.options.parentSessionId ?? this.sessionId,
      });
      getLogger().info('WEB_INGEST', `Ingested ${toolId} result (${output.length} chars) into neural brain`);
    } catch (e) {
      getLogger().warn('WEB_INGEST', `Failed to ingest web result: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Health + Checkpoint
  getHealth(): any {
    const cost = this.tokenTracker.totalCost;
    const cbStatus = this.toolExecutor instanceof EnhancedToolExecutor ? (this.toolExecutor as EnhancedToolExecutor).getCircuitBreakerStatus() : [] as any[];
    const avgResp = this._responseTimes.length ? Math.round(this._responseTimes.reduce((a: number, b: number) => a + b, 0) / this._responseTimes.length) : 0;
    const neuralAvg = this._experienceEngine?.getAverageConfidence() ?? 0;
    return { sessionId: this.sessionId, uptimeMs: Date.now() - this._sessionStartTime, llmCalls: this._llmCallCount, toolExecs: this._toolExecCount, errors: this._errorCount, avgResponseMs: avgResp, totalCost: cost, budgetLimit: this._maxSessionCost, budgetPct: this._maxSessionCost > 0 ? Math.round((cost / this._maxSessionCost) * 10000) / 100 : 0, circuitBreakers: cbStatus.filter((c: any) => c.blacklisted).length, model: this.config.provider.activeModel, provider: this.config.provider.activeProvider, activeSubAgents: (this.subAgents as any).runningCount ?? 0, contextTokens: this.tokenTracker.tokensUsed, contextWindow: this.getContextWindow(), compactionCount: this._compactionCount, planMode: this.planMode, hyperdriveMode: this._hyperdriveMode, neuralConfidenceAvg: Math.round(neuralAvg * 100) };
  }
  resolveCheckpoint(checkpointId: string, action: string): boolean {
    if (!this._pendingCheckpoint || this._pendingCheckpoint.checkpointId !== checkpointId) return false;
    this._pendingCheckpoint.resolve(action); this._pendingCheckpoint = null; return true;
  }

  getToolExecutor(): ToolExecutor | undefined {
    return this.toolExecutor;
  }

  getScopePath(): string {
    return this.scopePath;
  }

  setScopePath(path: string): void {
    this.scopePath = normalize(resolve(path));
    this.toolExecutor?.setScopePath(this.scopePath);
  }

  /**
   * Cancel an in-progress completion. Aborts the active stream and tool executions.
   */
  cancel(): void {
    this.abortClarificationWait();
    this.runStateMgr.cancel(this.sessionId);
    this.commandQueue.cancelSession(this.sessionId);
    this.stopTurnHeartbeat();
    this.turnState.cancel();
    this.emitTurnState('cancelled');
    this.emit({ type: 'loading_end' });
    if (this.scope) {
      this.scope.dispose();
      this.scope = null;
      this._abortSignalController = null;
    }
    this.lifecycle.transition('idle');
    this.subAgents.cancelAll();
    this.sessionRunner.interrupt();
  }

  get agents(): SubAgentManager {
    return this.subAgents;
  }

  get tasks(): TaskManager {
    return this.taskManager;
  }

  get sauce(): SecretSauceManager {
    return this.secretSauce; // lazy getter creates on first access
  }

  get treeOfThoughtsCapability(): TreeOfThoughts {
    if (!this._treeOfThoughts) {
      this._treeOfThoughts = new TreeOfThoughts({
        provider: this.provider,
        model: this.config.provider.activeModel,
        emit: (event) => this.emit(event),
      });
    }
    return this._treeOfThoughts;
  }

  get researchEngineCapability(): ResearchEngine {
    if (!this.researchEngine) {
      this.researchEngine = new ResearchEngine({
        provider: this.provider,
        model: this.config.provider.activeModel,
        emit: (event) => this.emit(event),
      });
    }
    return this.researchEngine;
  }

  /**
   * Spawn a sub-agent to handle a delegated task.
   */
  spawnSubAgent(instruction: string, tools: string[], timeout?: number) {
    return this.subAgents.spawn(instruction, tools, timeout, this.maxSubAgents);
  }

  get planModeEnabled(): boolean {
    return this.planMode;
  }

  /** Sub-agents and crew workers run without blocking on parent-session approval modals. */
  private get isDelegatedWorker(): boolean {
    return this.options.delegatedWorker === true;
  }

  get ragIndexStats(): { indexedCount: number; indexedAt: number | null } {
    const engine = getRAGEngineInstance();
    if (!engine) return { indexedCount: 0, indexedAt: null };
    return { indexedCount: engine.indexedCount, indexedAt: engine.indexedAt };
  }

  setPlanMode(enabled: boolean): void {
    if (this.options.channelSession && enabled) return;
    if (enabled === this.planMode) return;
    if (this._hyperdriveMode && enabled) return;
    if (enabled) {
      this.switchAgent('plan');
      this.contextTracker.record('assistant', '[Mode switched to Plan — read/analysis tools only, no writes or execution]');
      this.emit({ type: 'plan_mode_entered' });
    } else {
      this.currentPlan = null;
      this.switchAgent('build');
      this.contextTracker.record('assistant', '[Mode switched to Agent — full tool access and execution enabled]');
      this.emit({ type: 'plan_mode_exited' });
    }
  }

  switchAgent(agentId: string): boolean {
    const agent = BUILTIN_AGENTS.find(a => a.id === agentId);
    if (!agent) return false;
    this.planMode = agent.mode === 'plan';
    this.toolExecutor?.setMode(agent.mode);
    this.toolExecutor?.setAgent(agent);
    this.rebuildSystemPrompt();
    this.emit({ type: 'agent_switched', agent: { id: agent.id, name: agent.name, mode: agent.mode, color: agent.color } });
    return true;
  }

  setFallbackModel(model: string): void {
    this.fallbackModel = model;
  }

  getFallbackModel(): string | null {
    return this.fallbackModel;
  }

  // ─── Autonomous Diagnostics System Initialization ───
  private async initializeDiagnosticsAsync(): Promise<void> {
    try {
      getLogger().info('DIAGNOSTICS', `Starting session health check for scope: ${this.scopePath}`);
      
      // Phase 1: Perform session health check (verify scope path, build file cache, fallback if needed)
      this.sessionContext = await this.diagnosticsSystem.performSessionHealthCheck(this.scopePath);
      
      getLogger().info('DIAGNOSTICS', `Session health check completed. Scope verified: ${this.sessionContext.scopePath}`);
      if ((this.sessionContext as any).fallbackReason) {
        getLogger().warn('DIAGNOSTICS', `Fallback triggered: ${(this.sessionContext as any).fallbackReason}`);
        this.emit({
          type: 'task_progress',
          status: 'processing',
          description: `Scope path fallback: ${(this.sessionContext as any).fallbackReason}`,
          details: { original: this.scopePath, fallback: this.sessionContext.scopePath }
        } as any);
        // Update agent scope path if fallback occurred
        if (this.sessionContext.scopePath !== this.scopePath) {
          this.scopePath = this.sessionContext.scopePath;
          if (this.toolExecutor) {
            this.toolExecutor.setScopePath(this.scopePath);
          }
          getLogger().info('DIAGNOSTICS', `Scope path updated to fallback: ${this.scopePath}`);
        }
      }
      
      getLogger().info('DIAGNOSTICS', `Session context initialized successfully for: ${this.sessionContext.scopePath}`);
    } catch (error) {
      getLogger().error('DIAGNOSTICS', `Session health check failed: ${error instanceof Error ? error.message : String(error)}`);
      // Don't fail the session if diagnostics fails — graceful degradation
    }
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  respondToModeEscalation(accepted: boolean): void {
    if (this.pendingModeEscalation) {
      if (accepted) {
        this.setPlanMode(false);
      }
      this.pendingModeEscalation(accepted);
      this.pendingModeEscalation = null;
      this.turnState.setPhase(accepted ? 'running' : 'cancelled', accepted ? 'mode_escalated' : 'mode_declined');
    }
  }

  respondToStepCap(continueRun: boolean): void {
    if (this.pendingStepCap) {
      this.pendingStepCap(continueRun);
      this.pendingStepCap = null;
      this.turnState.setPhase(continueRun ? 'running' : 'done', continueRun ? 'continuing' : 'step_cap_stop');
      this.emit({ type: 'step_cap_continue', continued: continueRun });
    }
  }

  getTurnStateSnapshot() {
    return this.turnState.getSnapshot();
  }

  getPartialTurnContent(): string {
    return this.partialTurnContent;
  }

  getToolLedgerContent(): string {
    return this.toolLedger.formatForHistory();
  }

  private completionStepBudget(): number {
    const base = this.options.promptProfile === 'crew_private'
      ? this.crewPrivateCompletionSteps
      : this.maxCompletionSteps;
    return base * (1 + this.stepCapExtra);
  }

  private emitTurnState(phase: TurnPhase): void {
    const snap = this.turnState.getSnapshot();
    this.emit({ type: 'turn_state', phase, stage: snap.stage, step: snap.step });
  }

  private startTurnHeartbeat(stage: string): void {
    this.stopTurnHeartbeat();
    this.turnState.setStage(stage);
    this.heartbeatTimer = setInterval(() => {
      const snap = this.turnState.getSnapshot();
      if (snap.phase === 'awaiting_permission' || snap.phase === 'awaiting_plan'
        || snap.phase === 'awaiting_mode' || snap.phase === 'awaiting_step_cap') {
        return;
      }
      const elapsedMs = this.turnState.getElapsedMs();
      this.emit({
        type: 'turn_heartbeat',
        stage: snap.stage || stage,
        step: snap.step,
        elapsedMs,
      });
      this.emit({
        type: 'turn_state',
        phase: snap.phase,
        stage: snap.stage,
        step: snap.step,
      });
    }, 2000);
  }

  private stopTurnHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private waitForModeEscalation(toolId: string, _reason: string): Promise<boolean> {
    this.turnState.setPhase('awaiting_mode', `blocked:${toolId}`);
    return new Promise((resolve) => {
      this.pendingModeEscalation = resolve;
    });
  }

  private waitForStepCap(currentSteps: number): Promise<boolean> {
    if (this.options.channelSession) {
      this.stepCapExtra++;
      return Promise.resolve(true);
    }
    this.turnState.setPhase('awaiting_step_cap', `steps:${currentSteps}`);
    this.emit({ type: 'step_cap_reached', currentSteps, maxSteps: this.completionStepBudget() });
    return new Promise((resolve) => {
      this.pendingStepCap = (cont) => {
        if (cont) this.stepCapExtra++;
        resolve(cont);
      };
    });
  }

  respondToStep(stepId: string, approved: boolean, description?: string): void {
    if (this.pendingStepApproval) {
      this.pendingStepApproval(stepId, approved, description);
    }
  }

  private connectivityChecked = false;

  private async checkConnectivity(baseUrl?: string): Promise<boolean> {
    if (this.connectivityChecked) return true;
    const providerId = this.config.provider.activeProvider;
    const url = baseUrl ?? this.getBaseUrl();
    const apiKey = this.getApiKey();
    const probeUrl = buildProviderConnectivityProbeUrl(providerId, url, apiKey);
    if (!probeUrl) return true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const headers: Record<string, string> = {};
      if (apiKey && providerId === 'google' && probeUrl.includes('/openai/')) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const res = await fetch(probeUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.connectivityChecked = true;
      return res.ok || res.status < 500;
    } catch {
      this.emit({
        type: 'error',
        code: 'NETWORK_ERROR',
        message: `Cannot reach provider at ${url ?? probeUrl}. Check your internet connection and provider URL.`,
        recoverable: true,
        actions: [
          { type: 'dismiss', label: 'Dismiss' },
          { type: 'switch_model', label: 'Switch Provider' },
        ],
      });
      return false;
    }
  }

  /**
   * One-shot LLM text for outbound channel pushes (e.g. Settings greeting test).
   * Does not append to conversation history or invoke tools.
   */
  async generateOutboundText(
    userPrompt: string,
    options?: { systemHint?: string; maxTokens?: number },
  ): Promise<string> {
    const model = createAiSdkModel(this.config, this.getApiKey());
    const callsign = this.config.user?.callsign;
    const defaultSystem = [
      'You are Agent-X composing a short outbound Telegram message.',
      callsign ? `The user's name/callsign is "${callsign}".` : '',
      'Reply with ONLY the message body — warm, concise, no markdown headers, no tool names, no meta commentary.',
    ].filter(Boolean).join(' ');
    const r = await streamText({
      model,
      messages: [
        { role: 'system', content: options?.systemHint ?? defaultSystem },
        { role: 'user', content: userPrompt },
      ],
      maxOutputTokens: options?.maxTokens ?? 280,
    });
    let text = '';
    for await (const chunk of r.textStream) text += chunk;
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Model returned an empty message');
    return trimmed;
  }

  async sendMessage(content: string, options?: { instruction?: string; userId?: string; channelId?: string; sourceChannel?: string; retry?: boolean; delegateCrewIds?: string[]; crewSuggestionResolved?: boolean; crewIntakeFromPicker?: boolean; primaryCrewId?: string; forceWebSearch?: boolean; resumeCrewIntake?: { originalUserText: string; intakeAnswer: string; delegateCrewIds: string[]; primaryCrewId?: string } }): Promise<Message> {
    // ─── Self-healing: reset stuck processing flag after 60s timeout ───
    if (this.isProcessing) {
      const reset = this.lifecycle.resetIfStuck(60000);
      if (reset) {
        this.scope = null;
      } else {
        throw new Error('Agent is already processing a message');
      }
    }

    this.lifecycle.transition('receiving');
    this.scope = new Scope();
    this.clarificationStale = false;

    // ─── UNIFIED: Ensure single session run + enqueue for concurrency ───
    try {
      this.runStateMgr.ensureRunning(this.sessionId);
    } catch (e) {
      this.lifecycle.forceTransition('idle');
      this.scope = null;
      throw e;
    }
    void this.commandQueue.enqueue(this.sessionId, {
      turnId: `turn-${Date.now()}`,
      sessionId: this.sessionId,
      channel: (options?.sourceChannel ?? 'api') as ChannelKind,
      userId: options?.userId ?? 'user',
      receivedAt: Date.now(),
      text: content,
      attachments: [],
      metadata: {},
    });
    const startTime = Date.now();
    this.currentTurnId = `turn-${startTime}`;
    this.turnState.start(this.currentTurnId, 'receiving');
    this.toolLedger.reset();
    this.partialTurnContent = '';
    this.stepCapExtra = 0;
    this.startTurnHeartbeat('receiving');
    // Per-turn token snapshot for delta + cost emissions
    // ─── UNIFIED: Start telemetry for this turn ───
    this.telemetry.startTurn(`turn-${startTime}`, this.sessionId, this.config.provider.activeProvider, this.config.provider.activeModel);
    this.lastMissionContextRevision = -1;

    // Reset per-turn anti-duplicate sentinel
    this._turnMessageEmitted = false;

    // ─── UNIFIED: Normalize input ───
    let cleanContent = content;
    try {
      const normalized = await this.inputNormalizer.sanitize({
        turnId: `turn-${startTime}`,
        sessionId: this.sessionId,
        channel: 'api',
        userId: 'user',
        receivedAt: startTime,
        text: content,
        attachments: [],
        metadata: {},
      });
      cleanContent = normalized.cleanText;
      if (normalized.warnings.length > 0) {
        getLogger().warn('NORMALIZE', `${normalized.warnings.length} input warnings`);
      }
    } catch {
      // Fall through with original content if normalization fails
    }

    // Store the per-message instruction for injection during completion (not in history)
    this.pendingInstruction = options?.instruction || null;
    this.pendingDelegateCrewIds = options?.delegateCrewIds?.length ? [...options.delegateCrewIds] : null;

    const searchStatus = isWebSearchAvailableForChat(this.config);
    if (this.options.channelSession) {
      // Messaging channels need fast replies — skip optional LLM intent classifier.
      this.turnWebSearchPolicy = resolveWebSearchTurnPolicy({
        forceWebSearch: options?.forceWebSearch,
        userText: cleanContent,
        searchAvailable: searchStatus.available,
      });
    } else {
      this.turnWebSearchPolicy = await resolveWebSearchTurnPolicyAsync({
        forceWebSearch: options?.forceWebSearch,
        userText: cleanContent,
        searchAvailable: searchStatus.available,
        classifyIntent: createWebSearchIntentClassifier({
          provider: this.provider,
          model: this.config.provider.activeModel,
        }),
      });
    }
    this.forcedWebSearchToolName = searchStatus.forcedTool;
    if (options?.forceWebSearch && !searchStatus.available) {
      throw new Error('Web search is not available. Enable a provider in Settings → Tools.');
    }
    if (this.turnWebSearchPolicy !== 'off') {
      const searchInstr = buildWebSearchTurnInstruction(this.turnWebSearchPolicy);
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${searchInstr}`
        : searchInstr;
    }

    if (!options?.retry && !this.options.channelSession && this.options.promptProfile !== 'crew_private' && !options?.delegateCrewIds?.length) {
      try {
        const priorUserMessages = this.messages
          .filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .slice(-3);
        const store = (this.sessionManager as unknown as { store?: unknown })?.store;
        const rosterHint = await buildCrewRosterHintBlock({
          message: cleanContent,
          sessionId: this.sessionId,
          store,
          priorUserMessages,
          crewSuggestionResolved: options?.crewSuggestionResolved,
          expandKeywords: createCrewKeywordExpander({
            provider: this.provider,
            model: this.config.provider.activeModel,
            requireExpertisePattern: false,
          }),
        });
        if (rosterHint) {
          this.pendingInstruction = this.pendingInstruction
            ? `${this.pendingInstruction}\n\n${rosterHint}`
            : rosterHint;
        }
      } catch (e) {
        getLogger().warn('CREW_ROSTER_HINT', e instanceof Error ? e.message : String(e));
      }
    }

    if (options?.retry) {
      while (this.messages.length > 0 && this.messages[this.messages.length - 1]?.role === 'assistant') {
        this.messages.pop();
      }
      const retryHint = 'RETRY TURN: Use the latest [CURRENT_TIME] block for scheduling. For relative delays ("in X minutes"), use automation_register with delay_seconds — do not reuse run_at times from earlier turns or assistant messages.';
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${retryHint}`
        : retryHint;
    }

    // Add user message (clean, without instruction)
    if (!options?.retry) {
      const turnBoundary = this.messages.length > 0
        ? `\n[TURN ${this.currentTurnId} — treat prior messages as context only unless the user references them]`
        : '';
      this.messages.push({ role: 'user', content: cleanContent + turnBoundary });
    }

    // Record in context tracker
    this.contextTracker.record('user', cleanContent);

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content: cleanContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };

    if (!options?.retry) {
      this.emit({ type: 'message_sent', message: userMessage });
      const userTokens = estimateTokens(cleanContent);
      this.tokenTracker.addTokenUsage(userTokens, 0);
      const ctxWindow = this.getContextWindow();
      const reserved = getOutputReserve(ctxWindow);
      this.emit({
        type: 'token_usage',
        totalTokens: this.tokenTracker.tokensUsed + reserved,
        contextWindow: ctxWindow,
        inputTokens: this.tokenTracker.inputTokenCount,
        outputTokens: this.tokenTracker.outputTokenCount,
        reservedTokens: reserved,
        streamingTokens: 0,
        turnTokens: userTokens,
      } as EngineEvent);
      try {
        const mgr = this.sessionManager as unknown as { persistSessionFields?: (id: string, u: Record<string, unknown>) => void };
        mgr.persistSessionFields?.(this.sessionId, {
          tokensUsed: this.tokenTracker.tokensUsed,
          tokenAvailable: ctxWindow,
        });
      } catch { /* best-effort */ }
    }

    // Reset turn-level permission auto-approve from any prior batch approval
    this.turnApprovedAll = false;

    const isCrewPrivate = this.options.promptProfile === 'crew_private';

    // ─── DECISION ENGINE (heuristic — zero LLM calls) ───
    const conversationLen = this.messages.filter(m => m.role === 'user').length;
    const decision = this.decisionEngine.classify(cleanContent, conversationLen);

    // ─── MODEL CAPABILITY CHECK: warn if model lacks function calling for task intents ───
    const isTaskIntent = decision.messageClass === 'task';
    if (isTaskIntent && !this._capabilityWarningEmitted) {
      const caps = this.cachedModelCapabilities.get(this.config.provider.activeModel) ?? [];
      if (!caps.includes('function_calling')) {
        this._capabilityWarningEmitted = true;
        this.emit({
          type: 'model_capability_warning',
          model: this.config.provider.activeModel,
          missing: ['function_calling'],
          message: `This model (${this.config.provider.activeModel}) does not support function calling. It cannot execute tools or take actions. Switch to a model with function calling for autonomous execution.`,
        } as unknown as EngineEvent);
      }
    }

    // Build a natural-language context summary for crew routing (passed to crew LLM calls)
    const classificationContext = `[Classified as "${decision.messageClass}" (confidence: ${decision.confidence}) — ${decision.reasoning}]`;
    const priorUserMessages = this.messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .slice(0, -1);

    // ─── RESUME CREW INTAKE after session restore (questionnaire already answered) ───
    if (options?.resumeCrewIntake && this.crewOrchestrator) {
      const { originalUserText, intakeAnswer, delegateCrewIds } = options.resumeCrewIntake;
      const delegatedMembers = this.crewOrchestrator.getMembers().filter((m) =>
        delegateCrewIds.includes(m.crew.id) && m.crew.enabled !== false,
      );
      if (delegatedMembers.length > 0) {
        const missionTask = intakeAnswer.trim()
          ? `${originalUserText}\n\n[User clarified their request]\n${intakeAnswer.trim()}`
          : originalUserText;
        return await this.executeCrewMission(delegatedMembers, missionTask, startTime, classificationContext);
      }
    }

    getLogger().info('CLASSIFY', `class=${decision.messageClass} conf=${decision.confidence} msg="${cleanContent.slice(0, 60)}"`);

    // Emit as the general decision event for UI consumption
    this.emit({
      type: 'decision_made',
      messageClass: decision.messageClass,
      executionPath: decision.executionPath,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
    } as unknown as EngineEvent);

    // ─── @MENTION ROUTING — direct crew invocation (Agent-X sessions only) ───
    if (this.options.promptProfile !== 'crew_private') {
    const mentionedCrewIds = this.detectAtMentions(cleanContent);
    if (mentionedCrewIds.length > 0 && this.crewOrchestrator) {
      const members = this.crewOrchestrator.getMembers();
      const mentionedMembers = members.filter((m) =>
        mentionedCrewIds.includes(m.crew.id) && m.crew.enabled !== false,
      );
      if (mentionedMembers.length > 0) {
        return await this.executeCrewMission(mentionedMembers, cleanContent, startTime, classificationContext);
      }
    }

    // ─── USER-APPROVED CREW SUGGESTION — deploy selected specialists ───
    if (this.pendingDelegateCrewIds?.length && this.crewOrchestrator) {
      const delegateIds = this.pendingDelegateCrewIds;
      this.pendingDelegateCrewIds = null;
      const members = this.crewOrchestrator.getMembers();
      const delegatedMembers = members.filter((m) =>
        delegateIds.includes(m.crew.id) && m.crew.enabled !== false,
      );
    if (delegatedMembers.length > 0) {
        return await this.executeCrewMission(delegatedMembers, cleanContent, startTime, classificationContext);
      }
      getLogger().warn('AGENT', `Crew deploy failed: no enabled members for ids ${delegateIds.join(', ')}`);
      this.emit({
        type: 'error',
        code: 'crew_deploy_failed',
        message: 'Selected crew specialists could not be attached to this session. Continuing with Agent-X.',
        recoverable: true,
      });
    }

    // ─── ACTIVE CREW CONTINUATION — route follow-ups to deployed specialists ───
    const activeCrew = this.getActiveCrewMembers();
    if (activeCrew.length > 0 && this.crewOrchestrator) {
      const bypassActiveCrew = shouldBypassActiveCrewRouting(cleanContent, {
        crewSuggestionResolved: options?.crewSuggestionResolved,
        hasDelegateCrewIds: Boolean(options?.delegateCrewIds?.length),
      }, priorUserMessages);

      if (!bypassActiveCrew) {
        const routingTask = buildRoutingTaskForActiveCrew(cleanContent, priorUserMessages);
        const assessment = assessCrewNeed(routingTask, activeCrew);

        if (assessment.shouldRoute && assessment.members.length > 0) {
          return await this.executeCrewMission(assessment.members, routingTask, startTime, classificationContext);
        }
      }
    }
    }

    // ─── Fast-reply → minimal LLM call, no tools (greetings / thanks / small talk) ───
    if (decision.executionPath === 'fast_reply') {
      const crewHost = this.options.promptProfile === 'crew_private' ? this.options.crewPrivateHost : undefined;
      const useAgentFastReply = !crewHost && this.options.promptProfile !== 'crew_worker';
      if (crewHost || useAgentFastReply) {
        let fastPrompt: string;
        let userNote = '';
        if (crewHost) {
          fastPrompt = buildCrewPrivateFastReplyPrompt(crewHost);
        } else {
          let identityBlock = '';
          try { identityBlock = this.secretSauce?.identity?.getMergedIdentity?.(this.persona)?.name ?? ''; } catch { /* test env */ }
          fastPrompt = this.decisionEngine.buildFastReplyPrompt(identityBlock);
          const callsign = this.config.user?.callsign;
          userNote = callsign ? `\nThe user's name is "${callsign}".` : '';
        }
        const fastMessages = [
          { role: 'system' as const, content: fastPrompt + userNote },
          ...this.messages.slice(-3).filter(m => m.role !== 'system'),
          { role: 'user' as const, content: cleanContent },
        ];
        try {
          const model = createAiSdkModel(this.config, this.getApiKey());
          const streamPromise = (async () => {
            const r = await streamText({ model, messages: fastMessages as any, maxOutputTokens: 256 });
            let text = '';
            for await (const chunk of r.textStream) { text += chunk; }
            return text;
          })();
          const timeoutMs = this.options.channelSession ? 45_000 : 120_000;
          const text = await Promise.race([
            streamPromise,
            new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error('Fast reply timed out')), timeoutMs);
            }),
          ]);
          const fallback = crewHost ? `Hey — ${crewHost.name} here.` : 'Hey! How can I help?';
          const msg: Message = { id: generateMessageId(), sessionId: this.sessionId, role: 'assistant', content: text || fallback, toolCalls: null, createdAt: new Date().toISOString(), tokenCount: Math.ceil((text || '').length / 4) };
          this.messages.push({ role: 'assistant', content: msg.content });
          this.contextTracker.record('assistant', msg.content, crewHost?.name);
          this.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
          this.lifecycle.forceTransition('idle'); this.scope = null;
          this.runStateMgr.release(this.sessionId); this.commandQueue.release(this.sessionId);
          return msg;
        } catch {
          // Fast reply failed — fall through to standard LLM path
        }
      }
    }

    // ─── LLM PATH: every message → LLM with all tools → LLM decides ───
    const loadSteps = getLoadingSteps(decision.messageClass);
    const loadingStage = isCrewPrivate ? 'crew_private' : decision.messageClass;
    this.emit({
      type: 'loading_start',
      stage: loadingStage,
      steps: loadSteps.map(s => ({ ...s, status: 'pending' as const })),
    });
    // Step 1: classify → already done
    const step0 = loadSteps[0];
    if (step0) {
      this.emit({ type: 'loading_step_update', stepId: step0.id, label: step0.label, status: 'completed' });
    }

    // ─── DECISION ENGINE: Heuristic refinement for non-social messages ───
    this.currentDecision = this.decisionEngine.classify(content, conversationLen);
    this.currentDecision.reasoning = `${decision.reasoning} | ${this.currentDecision.reasoning}`;
    this.emit({
      type: 'decision_made',
      messageClass: this.currentDecision.messageClass,
      executionPath: this.currentDecision.executionPath,
      confidence: this.currentDecision.confidence,
      reasoning: this.currentDecision.reasoning,
    } as unknown as EngineEvent);

    // ─── SMART PROMPTING & RAG ───
    // Detect intent for dynamic tool selection and reasoning mode
    this.currentIntent = this.promptEngine.detectIntent(content);
    this.emit({ type: 'intent_detected', intent: this.currentIntent.intent, confidence: this.currentIntent.confidence });

    // Auto-query RAG for relevant documents (skip for conversational messages)
    this.lastRagResults = [];
    if (!this.currentDecision.skipRag && !this.usesCompactContext()) {
      const rag = getRAGEngineInstance();
      if (rag && rag.isEnabled) {
        try {
          const ragStart = Date.now();
          const docs = await rag.search(content, 3);
          this.lastRagResults = docs.map((d) => ({ content: d.content, score: d.score, metadata: d.metadata }));
          this.emit({ type: 'rag_queried', resultCount: docs.length, elapsed: Date.now() - ragStart });
        } catch (e) {
          getLogger().warn('RAG_QUERY', e instanceof Error ? e.message : String(e));
        }
      }
    }

    // Advance loading step: planning / thinking phase complete
    const step1 = loadSteps[1];
    if (step1) {
      this.emit({ type: 'loading_step_update', stepId: step1.id, label: step1.label, status: 'completed' });
    }

    try {
      // Advance loading step: execution phase
      const step2 = loadSteps[2];
      if (step2) {
        this.emit({ type: 'loading_step_update', stepId: step2.id, label: step2.label, status: 'active' });
      }

      // ─── UNIFIED: Tree of Thoughts trigger ───
      const shouldUseToT = this.currentIntent?.reasoningMode === 'tree';

      // Tree of Thoughts reasoning mode
      if (shouldUseToT) {
        this.emit({ type: 'loading_start', stage: 'tree_of_thoughts' });
        const bestThought = await this.treeOfThoughtsCapability.solve(content, {
          maxDepth: 3,
          beamWidth: 3,
          thoughtsPerNode: 3,
        });

        const treeContent = `**Tree of Thoughts Analysis**\n\nBest reasoning path (score: ${(bestThought.score * 10).toFixed(1)}/10):\n\n${bestThought.content}`;
        this.messages.push({ role: 'assistant', content: treeContent });

        const assistantMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: treeContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: estimateOutputTokens(treeContent),
        };

        this.emit({ type: 'loading_end' });
        this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });
        return assistantMessage;
      }

      // Proactive mode escalation (Agent-X only): optional UI prompt before write-capable work.
      // Plans are never user-approved in a modal — the completion loop delivers markdown in chat.
      if (
        shouldUseInteractivePlanGates(this.planMode, this.isDelegatedWorker, this.options.promptProfile ?? 'default')
        && shouldEscalateForExecution(content, decision.messageClass)
      ) {
        this.emit({
          type: 'mode_escalation_required',
          tool: 'execution_intent',
          reason: 'This request requires write, build, or execute capabilities that Plan mode blocks.',
          pendingAction: content.slice(0, 160),
        });
        const accepted = await this.waitForModeEscalation('execution_intent', content);
        if (!accepted) {
          const declinedMessage: Message = {
            id: generateMessageId(),
            sessionId: this.sessionId,
            role: 'assistant',
            content: '⏹ Stopped — staying in Plan mode. Switch to Agent mode when you\'re ready to execute this request.',
            toolCalls: null,
            createdAt: new Date().toISOString(),
            tokenCount: 0,
          };
          this.stopTurnHeartbeat();
          this.turnState.complete();
          this.emitTurnState('done');
          this.emit({ type: 'loading_end' });
          this.emit({ type: 'message_received', message: declinedMessage, elapsed: Date.now() - startTime });
          return declinedMessage;
        }
      }

       // Normal mode: run completion loop directly
       if (!this.options.channelSession && !(await this.checkConnectivity())) {
         throw new Error('Cannot reach LLM provider. Check your internet connection.');
       }
       let assistantMessage = await this.runCompletionLoop(startTime);

       // ─── CRITICAL: Server-side validation for mode restriction transparency ───
       if (this.planMode && this.options.promptProfile !== 'crew_private') {
         const validationResult = this.validateModeRestrictionTransparency(assistantMessage.content, this.toolCallLogForReflection);
         if (!validationResult.isTransparent) {
           getLogger().warn('AGENT', `Detected fabricated success in plan mode. Triggering refactored response.`);
           assistantMessage = await this.refactorResponseForTransparency(assistantMessage, validationResult);
         }
         await this.enforcePlanModeViolations(startTime);
       }

       // Advance loading step: execution complete
       const stepExec = loadSteps[2];
       if (stepExec) {
         this.emit({ type: 'loading_step_update', stepId: stepExec.id, label: stepExec.label, status: 'completed' });
       }
      const stepVerify = loadSteps[3];
      if (stepVerify) {
        this.emit({ type: 'loading_step_update', stepId: stepVerify.id, label: stepVerify.label, status: 'completed' });
      }

      // Record assistant response in context tracker
      this.contextTracker.record(
        'assistant',
        assistantMessage.content,
        this.options.crewPrivateHost?.name,
      );

      // Extract bulleted tasks from response and push to task panel
      this.extractTasksFromResponse(assistantMessage.content);

      // Extract and persist memories (non-blocking)
      this.extractMemories(content, assistantMessage.content);

      // Auto-generate skill if task was novel
      if (this.skillGenerator?.shouldGenerateSkill(content, this.toolCallLogForReflection)) {
        const toolsForSkill = this.toolCallLogForReflection.map((t) => ({ name: t.name, args: {} as Record<string, unknown> }));
        void this.skillGenerator?.generateSkill(this, content, toolsForSkill, assistantMessage.content);
      }

      // Run reflection loop for continuous improvement
      if (this.toolCallLogForReflection.length >= 2) {
        void this.reflectionLoop.reflect(this, content, this.toolCallLogForReflection, assistantMessage.content);
      }

      this.toolCallLogForReflection = [];
      this.stopTurnHeartbeat();
      this.turnState.complete();
      this.emitTurnState('done');
      this.emit({ type: 'loading_end' });
      return assistantMessage;
    } catch (error) {
      this.stopTurnHeartbeat();
      this.turnState.cancel();
      this.emitTurnState('cancelled');
      this.emit({ type: 'loading_end' });

      // ─── UNIFIED: Classify error via ErrorClassifier ───
      const classified = this.errorClassifier.classify(error);
      this.telemetry.markError(`turn-${startTime}`, classified.reason, classified.providerMessage ?? '');

      // If cancelled by user, emit a soft cancellation event (not an error)
      if (error instanceof Error && error.name === 'AbortError') {
        const cancelledMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: '⏹ Cancelled.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        this.emit({ type: 'message_received', message: cancelledMessage, elapsed: Date.now() - startTime });
        return cancelledMessage;
      }

      this.errorShield.logError(error);
      const rawProviderMessage = error instanceof Error ? error.message : String(error);
      this.sessionLogger?.logErrorUser(rawProviderMessage, classified.reason);
      const { message: friendlyMessage, actions } = this.toFriendlyError(error);
      const PROVIDER_ERROR_REASONS = new Set([
        FailoverReason.AUTH,
        FailoverReason.BILLING,
        FailoverReason.RATE_LIMIT,
        FailoverReason.OVERLOADED,
        FailoverReason.SERVER_ERROR,
        FailoverReason.TIMEOUT,
        FailoverReason.FORMAT,
        FailoverReason.MODEL_NOT_FOUND,
        FailoverReason.POLICY_BLOCK,
      ]);
      if (PROVIDER_ERROR_REASONS.has(classified.reason)) {
        this.emit({
          type: 'provider_error',
          provider: this.config.provider.activeProvider,
          model: this.config.provider.activeModel,
          statusCode: classified.providerStatus,
          message: rawProviderMessage,
          recoverable: true,
          actions,
        });
        const fallbackContent = friendlyMessage || `I encountered a provider error: ${rawProviderMessage.slice(0, 200)}. Please try again or check your API configuration.`;
        const fallbackMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: fallbackContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        this.emit({ type: 'message_received', message: fallbackMessage, elapsed: Date.now() - startTime });
        return fallbackMessage;
      }
      this.emit({
        type: 'error',
        code: 'AGENT_ERROR',
        message: friendlyMessage,
        recoverable: true,
        actions,
      });
      throw error;
    } finally {
      this.turnWebSearchPolicy = 'off';
      this.forcedWebSearchToolName = null;
      this.completeTurnTelemetry(startTime);
      this.lifecycle.forceTransition('idle');
      this.scope = null;
      this.runStateMgr.release(this.sessionId);
      this.commandQueue.release(this.sessionId);
    }
  }

  private completeTurnTelemetry(startTime: number): void {
    const turnId = `turn-${startTime}`;
    if (!this.telemetry) return;
    this.telemetry.endTurn(
      turnId,
      {
        promptTokens: this.tokenTracker.inputTokenCount,
        completionTokens: this.tokenTracker.outputTokenCount,
        totalTokens: this.tokenTracker.tokensUsed,
      },
      this.sessionId,
      this.config.provider.activeProvider,
    );
  }


  /**
   * Runs the model completion loop using the Vercel AI SDK (streamText).
   * Replaces the manual CompletionLoop with AI SDK's built-in multi-step
   * tool execution, streaming, and retry.
   *
   * The AI SDK handles:
   * - LLM call with streaming
   * - Tool execution (calls our wrapped tools asynchronously)
   * - Multi-step loop (maxSteps = 20, auto-feeds tool results back to LLM)
   * - Structured events for UI visualization
   */
  private async runCompletionLoop(startTime: number): Promise<Message> {
    await this.reconcileSystemPrompt();

    const emit = (e: EngineEvent) => this.emit(e);
    const registry = this.toolRegistry;
    const executor = this.toolExecutor;
    if (!registry) throw new Error('Tool registry not initialized');
    if (!executor) throw new Error('Tool executor not initialized');

    const lastUserMsg = [...this.messages].reverse().find((m) => m.role === 'user');
    const lastUserText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
      : '';
    let integrationHint: string | undefined;
    if (this.options.prepareIntegrationTools && lastUserText) {
      try {
        integrationHint = await this.options.prepareIntegrationTools(lastUserText);
      } catch (error) {
        getLogger().warn('AGENT', `Integration pre-turn sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const compact = this.usesCompactContext();
    const tools = createAiSdkTools(
      registry,
      executor,
      this.sessionId,
      emit,
      async (questionnaire: QuestionnairePayload) => {
        if (this.isDelegatedWorker) {
          return 'Proceed with your best judgment using available read-only tools and context.';
        }
        return this.waitForQuestionnaireResponse(questionnaire);
      },
      async (instruction, toolsList, timeout) => {
        const subAgent = new SmartSubAgent({
          parentAgent: this,
          instruction,
          tools: toolsList,
          timeout,
          planMode: this.planMode,
        });
        return subAgent.execute();
      },
      this.planMode,
      this.options.promptProfile === 'crew_private' || this.options.channelSession
        ? undefined
        : (toolId, reason) => this.waitForModeEscalation(toolId, reason),
      (toolId, success, output, elapsed, args) => {
        const path = typeof args?.path === 'string' ? args.path : undefined;
        this.toolLedger.record({ name: toolId, success, output, elapsed, path });
        this.toolCallLogForReflection.push({ name: toolId, success, output, elapsed });
        this.turnState.touch();
        // Ingest web search / fetch results into the neural brain for future RAG retrieval.
        // This ensures knowledge discovered via web tools is persisted and searchable
        // in subsequent turns — not lost after the current conversation.
        if (success && Agent.WEB_SEARCH_TOOLS.has(toolId) && output && output.length > 50) {
          this.ingestWebSearchResult(toolId, args, output).catch(() => {});
        }
      },
      this.options.promptProfile ?? 'default',
      compact,
    );

    if (this.options.promptProfile === 'crew_private') {
      const denyCrewOrchestration = new Set(['spawn_crew_workers', 'delegate_to_crew', 'crew_response']);
      for (const key of Object.keys(tools)) {
        if (denyCrewOrchestration.has(key)) delete tools[key];
      }
    }

    const model = createAiSdkModel(this.config, this.getApiKey());

    let aiMessages = buildCompletionMessages(
      this.messages.map((m) => ({
        role: m.role,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
      })),
      compact,
      3,
      this.config.provider.activeProvider,
    ).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Append instruction to last user message (instead of separate role:system)
    if (this.pendingInstruction) {
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${userMsg.content}\n\n[INSTRUCTION]\n${this.pendingInstruction}\n[/INSTRUCTION]` };
      }
      this.pendingInstruction = null;
    }

    // Prepend turn context so short follow-ups retain session intent
    const turnCtx = this.prepareTurnContext(lastUserText);
    if (turnCtx.block) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[TURN CONTEXT]')) {
        aiMessages[userIdx] = { role: 'user', content: `${turnCtx.block}\n\n${userMsg.content}` };
      }
    }

    if (integrationHint) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[INTEGRATION')) {
        aiMessages[userIdx] = { role: 'user', content: `${integrationHint}\n\n${userMsg.content}` };
      }
    }

    // Prepend RAG context to last user message (full context profile only)
    if (!compact && this.lastRagResults.length > 0) {
      const ragCtx = this.promptEngine.buildRagContext(this.lastRagResults);
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${ragCtx}\n\n${userMsg.content}` };
      }
    }

    const streamHandler = createAiSdkStreamHandler(
      emit,
      this.sessionId,
      (inputTokens, outputTokens) => {
        this.tokenTracker.addTokenUsage(inputTokens, outputTokens);
        this.onTokenLog?.({ inputTokens, outputTokens, costUsd: 0 });
      },
      this._onPart,
      this.config.provider.activeModel,
      this.gitManager ?? undefined,
      this.onSessionEvent ?? undefined,
      this.getContextWindow(),
      aiMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      this.tokenTracker.inputTokenCount,
      this.tokenTracker.outputTokenCount,
    );
    this.activeStreamHandler = streamHandler;

    try {
      this.turnState.setStage('thinking');
      this.emit({ type: 'loading_start', stage: 'thinking' });

      // Log tool setup for debugging
      const toolCount = Object.keys(tools).length;
      getLogger().info('AGENT', `Starting streamText with ${toolCount} tools, model: ${this.config.provider.activeModel}, mode: ${this.planMode ? 'plan' : 'agent'}`);

      let stepCapContinuations = 0;
      const stepBudget = this.completionStepBudget();
      const stepLimit = () => stepBudget;
      const googleProviderOptions = this.config.provider.activeProvider === 'google'
        ? buildGoogleAiSdkProviderOptions(
          this.config.provider.activeModel,
          this.config.provider.activeReasoningEffort,
        )
        : undefined;
      const result = streamText({
        model,
        messages: aiMessages,
        tools,
        abortSignal: this.abortSignal,
        maxRetries: 2,
        stopWhen: ({ steps }) => steps.length >= stepLimit(),
        toolChoice: 'auto',
        ...(googleProviderOptions ? { providerOptions: googleProviderOptions } : {}),
        prepareStep: async ({ stepNumber, messages }) => {
          this.turnState.setStage('execution', stepNumber);
          const stepBudgetBase = this.options.promptProfile === 'crew_private'
            ? this.crewPrivateCompletionSteps
            : this.maxCompletionSteps;
          if (stepNumber > 0 && stepNumber % stepBudgetBase === 0 && stepNumber >= stepBudgetBase) {
            const cont = await this.waitForStepCap(stepNumber);
            if (!cont) throw new Error('STEP_CAP_STOP');
            stepCapContinuations++;
          }
          if (
            stepNumber === 0
            && this.turnWebSearchPolicy === 'forced'
            && this.forcedWebSearchToolName
            && tools[this.forcedWebSearchToolName]
          ) {
            return { toolChoice: { type: 'tool' as const, toolName: this.forcedWebSearchToolName } };
          }
          const provider = this.missionContextProvider;
          if (!provider || stepNumber === 0) return {};
          const { revision, block } = provider();
          if (!block.trim() || revision <= this.lastMissionContextRevision) return {};
          this.lastMissionContextRevision = revision;
          return {
            messages: [
              ...messages,
              {
                role: 'user' as const,
                content: `[TEAM UPDATE — new crew activity]\n${block}\n[/TEAM UPDATE]`,
              },
            ],
          };
        },
      });

      let finishEmitted = false;
      for await (const chunk of result.fullStream) {
        streamHandler.handleEvent(chunk);
        if (chunk.type === 'text-delta') {
          this.partialTurnContent = streamHandler.getState().accumulatedContent;
        }
        if (chunk.type === 'finish') finishEmitted = true;
      }

      // Fallback: if stream ended without finish event, emit one now to ensure message is recorded
      if (!finishEmitted) {
        const state = streamHandler.getState();
        if (state.accumulatedContent || state.toolCallCount > 0) {
          streamHandler.handleEvent({ type: 'finish', usage: await result.usage });
        }
      }

      const text = streamHandler.getState().accumulatedContent || '';
      let content = text.trim();
      
      // ─── CRITICAL FIX: Populate tool execution log from stream handler ───
      const streamToolExecs = streamHandler.getState().toolExecutions;
      if (streamToolExecs && streamToolExecs.length > 0) {
        getLogger().info('AGENT', `Recovered ${streamToolExecs.length} tool executions from stream handler`);
        this.toolCallLogForReflection.push(...streamToolExecs.map(t => ({ name: t.tool, success: t.success, output: t.output, elapsed: t.elapsed })));
      }
      const toolExecs = this.toolCallLogForReflection.filter(t => t.success).length;
      getLogger().info('AGENT', `Total tool executions in turn: ${this.toolCallLogForReflection.length}, successful: ${toolExecs}`);

      // Generic self-healing: if response is essentially empty (whitespace or <3 chars),
      // retry once with tool results + full context + explicit instructions.
      if (content.length < 3) {
        const toolSummary = this.toolCallLogForReflection
          .map(t => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'} — ${t.output.slice(0, 300)}`)
          .join('\n');
        const worked = toolExecs > 0;
        getLogger().warn('AGENT', `Response too short (${content.length} chars, ${toolExecs} tools) — retrying with context`);
        try {
          const retryResult = streamText({
            model: createAiSdkModel(this.config, this.getApiKey()),
            messages: [
              ...aiMessages,
              ...(worked ? [{ role: 'assistant' as const, content: text || '(executed tools)' }] : []),
              { role: 'user' as const, content: worked
                ? `[SYSTEM] You just ran these tools:\n${toolSummary}\n\nNow respond to the user based on these results. Read files if needed. Analyze what you found. Be thorough.`
                : `[SYSTEM] The user said: "${aiMessages[aiMessages.length - 1]?.content?.slice(0, 500)}"\n\nUse the appropriate tools to answer. Prefer connected MCP integration tools when the request targets an external service — do not scan the local filesystem as a substitute. Do not return empty.`
              },
            ],
            tools: createAiSdkTools(this.toolRegistry!, this.toolExecutor!, this.sessionId, (e) => this.emit(e), async () => 'continue', async () => ({ success: true, output: '(fallback)', elapsed: 0 }), this.planMode, undefined, undefined, 'default', compact),
            stopWhen: stepCountIs(50),
            toolChoice: 'auto',
            maxRetries: 1,
          });
          let retryText = '';
          for await (const chunk of retryResult.fullStream) { streamHandler.handleEvent(chunk); }
          retryText = (streamHandler.getState().accumulatedContent || '').trim();
          if (retryText) content = text.trim() ? text.trim() + '\n\n' + retryText : retryText;
        } catch { /* retry failed */ }
      }

      if (!content) {
        content = 'I was unable to generate a response. This model may not support function calling — try switching to GPT-4o, Claude, or Gemini.';
      }

      const usage = await result.usage;
      const tokenCount = usage
        ? (usage.inputTokens || 0) + (usage.outputTokens || 0)
        : Math.ceil(content.length / 4);

      this.sessionLogger?.log({
        type: 'llm_response',
        data: {
          round: 0,
          content: content.slice(0, 1000),
          usage: usage ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } : null,
        },
      });

      // Stream handler already emitted message_received in its finish case.
      // Only push to local state and compact — no second emit needed.
      const ledgerNote = this.toolLedger.formatForHistory();
      if (ledgerNote) {
        this.messages.push({ role: 'system', content: ledgerNote });
      }
      this.messages.push({ role: 'assistant', content });
      await this.compactContext();
      await this.reinforceMemoryContext();

      return this.tagCrewPrivateAssistant({
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant' as const,
        content,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'MODE_ESCALATION_DECLINED') {
        const declinedMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: '⏹ Stopped — staying in Plan mode. Switch to Agent mode when you\'re ready to execute write operations.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: declinedMessage, elapsed: Date.now() - startTime });
        return declinedMessage;
      }
      if (error instanceof Error && error.message === 'STEP_CAP_STOP') {
        const capMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: this.partialTurnContent.trim() || '⏹ Step limit reached. Send another message to continue.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: capMessage, elapsed: Date.now() - startTime });
        return capMessage;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        const cancelledMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: '⏹ Cancelled.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: cancelledMessage, elapsed: Date.now() - startTime });
        return cancelledMessage;
      }
      if (error instanceof Error && error.message === 'CLARIFICATION_ABORTED') {
        return {
          id: '__clarify__',
          sessionId: this.sessionId,
          role: 'assistant',
          content: '',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      getLogger().error('COMPLETION', `AI SDK streamText failed: ${errorMsg}`);
      this.emit({ type: 'error', code: 'AI_SDK_ERROR', message: errorMsg, recoverable: false });
      throw error;
    } finally {
      this.activeStreamHandler = null;
    }
  }

  /**
   * Execute a single plan step as a self-contained completion.
   */
  /**
   * Extract memorable facts from the exchange and persist them.
   * Runs asynchronously and silently — never blocks the main flow.
   */
  private extractMemories(userMessage: string, assistantResponse: string): void {
    if ((this.config as unknown as Record<string, unknown>)['autoMemory'] === false) return;
    if (!this.memoryExtractor) {
      this.memoryExtractor = new MemoryExtractor(this.provider, this.config.provider.activeModel);
    }

    void this.memoryExtractor.extract(userMessage, assistantResponse).then((memories) => {
      for (const mem of memories) {
        this.secretSauce.recordMemory(mem.content, mem.category);
      }
    }).catch(() => {
      // Silent failure — memory extraction is best-effort
    });
  }

  setSystemPrompt(prompt: string): void {
    const systemIdx = this.messages.findIndex((m) => m.role === 'system');
    if (systemIdx >= 0) {
      this.messages[systemIdx] = { role: 'system', content: prompt };
    } else {
      this.messages.unshift({ role: 'system', content: prompt });
    }
  }

  private buildIdentityBlock(): string {
    const identity = this.secretSauce.identity.getMergedIdentity(this.persona);

    const lines: string[] = [
      `You are ${identity.name}, an AI agent running on the user's own machine.`,
      `You are NOT Google AI, NOT ChatGPT, NOT Claude, NOT any other AI service. You are exclusively ${identity.name}. Never claim to be another AI or company.`,
      '',
    ];

    if (identity.description) {
      lines.push(identity.description, '');
    }

    if (identity.domainContext) {
      lines.push(`Domain: ${identity.domainContext}`);
    }

    if (identity.traits.length > 0) {
      lines.push(`Traits: ${identity.traits.join(', ')}`);
    }

    if (identity.communicationStyle) {
      lines.push(`Communication style: ${identity.communicationStyle}`);
    }

    if (identity.decisionMaking) {
      lines.push(`Decision-making style: ${identity.decisionMaking}`);
    }

    lines.push(`Interactions to date: ${identity.interactionCount}`);

    if (identity.evolutionLog) {
      lines.push('', identity.evolutionLog);
    }

    // No hardcoded role — the description above defines who the agent is
    lines.push('', 'Your job is to EXECUTE, not just describe. Take action. Deliver complete results.');

    return lines.join('\n');
  }

  private createSectionContext(): SectionContext {
    return {
      getProviderId: () => this.config.provider.activeProvider,
      getModelId: () => this.config.provider.activeModel,
      buildIdentityBlock: () => this.buildIdentityBlock(),
      scopePath: this.scopePath,
      hyperdriveMode: this._hyperdriveMode,
      telegramConnected: this._telegramConnected,
      userCallsign: this.config.user?.callsign,
      getUserTimezone: () => this.getUserTimezone(),
      getUtcOffset: () => this.getUtcOffset(),
      crewOrchestrator: this.crewOrchestrator ? {
        getMembers: () => this.crewOrchestrator!.getMembers(),
      } : null,
      enabledCrewSessionIds: this.enabledCrewSessionIds,
      reflectionLoop: this.reflectionLoop ? {
        getCumulativeLearnings: () => this.reflectionLoop.getCumulativeLearnings(),
      } : null,
      skillGenerator: this.skillGenerator ? (() => { const sg = this.skillGenerator; return { getAll: () => sg!.getAll() }; })() : null,
      skillRegistry: this.skillRegistry ? (() => { const sr = this.skillRegistry; return { list: () => sr!.list() }; })() : null,
      contextTracker: this.contextTracker ? {
        getContextSummary: () => this.contextTracker.getContextSummary(),
        getRecentHistory: () => this.contextTracker.getRecentHistory(),
      } : null,
      soulManager: { buildContext: () => this.secretSauce.soul.buildContext() },
      personaName: this.persona?.name || 'Agent-X',
      experienceEngine: { getProvenContext: () => this.experienceEngine.getProvenContext(), getCautionContext: () => this.experienceEngine.getCautionContext() },
      growthEngine: { getGrowthContext: () => this.growthEngine.getGrowthContext() },
      turnFeedbackService: { buildPromptContext: () => this.turnFeedbackService.buildPromptContext(this.sessionId) },
      memoryContext: { getContext: () => this.buildMemoryContext() },
    };
  }

  private registerPromptSections(systemOverride?: string): void {
    if (this.options.promptProfile === 'crew_worker') {
      const ctx = this.createSectionContext();
      this.promptAssembly
        .register(createRulesSection())
        .register(createQuestionnaireGuideSection())
        .register(createChatMarkdownSection())
        .register(createCurrentTimeSection(ctx))
        .register(createMemoryContextSection(ctx));
      if (systemOverride) {
        this.promptAssembly.register(createSystemOverrideSection(systemOverride));
      }
      return;
    }

    if (this.options.promptProfile === 'crew_private') {
      const ctx = this.createSectionContext();
      if (this.usesCompactContext()) {
        this.promptAssembly
          .register(createCrewPrivateConductSection())
          .register(createLocalPersonaGuardSection())
          .register(createWorkingDirectorySection(ctx))
          .register(createUserSection(ctx))
          .register(createSessionNarrativeSection(ctx))
          .register(createMemoryContextSection(ctx));
      } else {
        this.promptAssembly
          .register(createCrewPrivateConductSection())
          .register(createQuestionnaireGuideSection())
          .register(createChatMarkdownSection())
          .register(createCurrentTimeSection(ctx))
          .register(createWorkingDirectorySection(ctx))
          .register(createLearningsSection(ctx))
          .register(createSkillsSection(ctx))
          .register(createFormalSkillsSection(ctx))
          .register(createSessionNarrativeSection(ctx))
          .register(createTurnFeedbackSection(ctx))
          .register(createUserSection(ctx))
          .register(createSoulSection(ctx))
          .register(createNeuralSection(ctx))
          .register(createMemoryContextSection(ctx))
          .register(createInstructionsSection(ctx.scopePath));
      }
      if (systemOverride) {
        this.promptAssembly.register(createSystemOverrideSection(systemOverride));
      }
      return;
    }

    if (this.options.channelSession) {
      const ctx = this.createSectionContext();
      this.promptAssembly
        .register(createProviderPromptSection(ctx))
        .register(createIdentitySection(ctx))
        .register(createWorkingDirectorySection(ctx))
        .register(createCompactRulesSection())
        .register(createChannelSuperSessionSection())
        .register(createChannelMessagingSection())
        .register(createChatMarkdownSection())
        .register(createCurrentTimeSection(ctx))
        .register(createSchedulingSection())
        .register(createLearningsSection(ctx))
        .register(createSkillsSection(ctx))
        .register(createFormalSkillsSection(ctx))
        .register(createMultiCrewSection(ctx))
        .register(createCrewRosterGuideSection())
        .register(createUserSection(ctx))
        .register(createSoulSection(ctx))
        .register(createNeuralSection(ctx))
        .register(createMemoryContextSection(ctx))
        .register(createInstructionsSection(ctx.scopePath));
      if (systemOverride) {
        this.promptAssembly.register(createSystemOverrideSection(systemOverride));
      }
      return;
    }

    const ctx = this.createSectionContext();
    if (this.usesCompactContext()) {
      this.promptAssembly
        .register(createProviderPromptSection(ctx))
        .register(createIdentitySection(ctx))
        .register(createLocalPersonaGuardSection())
        .register(createWorkingDirectorySection(ctx))
        .register(createCompactRulesSection())
        .register(createUserSection(ctx))
        .register(createSessionNarrativeSection(ctx))
        .register(createMemoryContextSection(ctx))
        .register(createInstructionsSection(ctx.scopePath));
    } else {
      this.promptAssembly
        .register(createProviderPromptSection(ctx))
        .register(createIdentitySection(ctx))
        .register(createWorkingDirectorySection(ctx))
        .register(createRulesSection())
        .register(createQuestionnaireGuideSection())
        .register(createChatMarkdownSection())
        .register(createCurrentTimeSection(ctx))
        .register(createSchedulingSection())
        .register(createLearningsSection(ctx))
        .register(createSkillsSection(ctx))
        .register(createFormalSkillsSection(ctx))
        .register(createHyperdriveSection(ctx))
        .register(createChannelFocusSection(ctx))
        .register(createMultiCrewSection(ctx))
        .register(createCrewRosterGuideSection())
        .register(createUserSection(ctx))
        .register(createSessionNarrativeSection(ctx))
        .register(createTurnFeedbackSection(ctx))
        .register(createTaskPanelSection())
        .register(createSoulSection(ctx))
        .register(createNeuralSection(ctx))
        .register(createMemoryContextSection(ctx))
        .register(createInstructionsSection(ctx.scopePath));
    }

    if (systemOverride) {
      this.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
  }

  rebuildSystemPrompt(): void {
    this.reconcileSystemPrompt().catch(() => {});
  }

  private async reconcileSystemPrompt(): Promise<void> {
    if (!this.promptAssembly || !this.promptSnapshot) return;

    const result = await this.promptAssembly.reconcile(this.promptSnapshot);

    if (result.tag === 'unchanged') return;

    if (result.tag === 'updated') {
      this.promptSnapshot = result.update.snapshot;
      this.messages.push({
        role: 'system' as const,
        content: result.update.text,
      });
    } else if (result.tag === 'replacement-needed') {
      this.promptSnapshot = result.generation.snapshot;
      this.setSystemPrompt(result.generation.baseline);
    }
    // replacement-blocked: skip, keep old snapshot
  }

  switchProvider(providerId: ProviderId, apiKey?: string, baseUrl?: string): void {
    const wasCompact = this.usesCompactContext();
    this.provider = ProviderFactory.create(providerId, apiKey, baseUrl);
    this.config.provider.activeProvider = providerId;
    if (wasCompact !== this.usesCompactContext()) {
      this.rebuildPromptAssembly();
    }
  }

  switchModel(modelId: string, contextWindow?: number): void {
    const wasCompact = this.usesCompactContext();
    this.config.provider.activeModel = modelId;
    this._capabilityWarningEmitted = false;

    const ctx = contextWindow ?? this.cachedModels.get(modelId);
    if (ctx) {
      this.tokenTracker.setTotal(ctx);
      this.cachedModels.set(modelId, ctx);
      this.promptEngine = new PromptEngine(ctx);
      try {
        const mgr = this.sessionManager as unknown as { persistSessionFields?: (id: string, u: Record<string, unknown>) => void };
        mgr.persistSessionFields?.(this.sessionId, { tokenAvailable: ctx });
      } catch { /* best-effort */ }
    }

    // Set pricing for cost tracking
    const pricing = getModelPricing(modelId);
    this.tokenTracker.setPricing(pricing.inputPerMillion, pricing.outputPerMillion);

    const nowCompact = isCompactContextProfile(
      this.config.provider.activeProvider,
      modelId,
      ctx ?? this.getContextWindow(),
    );
    if (wasCompact !== nowCompact) {
      this.rebuildPromptAssembly();
    }

    this.emit({ type: 'command_action', action: 'model_switched', modelId, contextWindow: ctx ?? this.tokenTracker.tokensTotal });
  }

  private _currentTaskType: TaskType | null = null;

  get currentTaskType(): TaskType | null {
    return this._currentTaskType;
  }

  routeForTask(content: string): { provider: ProviderId; model: string } | null {
    if (!this.modelRouter) return null;
    const taskType = this.detectTaskType(content);
    this._currentTaskType = taskType;
    return this.modelRouter.selectModel(taskType);
  }

  private detectTaskType(content: string): TaskType {
    const lower = content.toLowerCase();
    if (lower.includes('write code') || lower.includes('implement') || lower.includes('function') ||
        lower.includes('refactor') || lower.includes('fix bug') || lower.includes('debug') ||
        lower.includes('add test') || lower.includes('create file') || /\b(code|program|script|function)\b/.test(lower)) {
      return 'code';
    }
    if (lower.includes('explain') || lower.includes('analyze') || lower.includes('compare') ||
        lower.includes('summarize') || lower.includes('research') || lower.includes('investigate')) {
      return 'analysis';
    }
    if (lower.includes('plan') || lower.includes('design') || lower.includes('architecture') ||
        lower.includes('roadmap') || lower.includes('strategy') || lower.includes('approach')) {
      return 'planning';
    }
    if (lower.includes('think step by step') || lower.includes('reason') || lower.includes('logic') ||
        lower.includes('puzzle') || lower.includes('math') || lower.includes('proof')) {
      return 'reasoning';
    }
    if (lower.includes('write a poem') || lower.includes('story') || lower.includes('creative') ||
        lower.includes('generate') || lower.includes('draft')) {
      return 'creative';
    }
    if (content.length < 20 || lower.includes('quick') || lower.includes('fast')) {
      return 'fast';
    }
    return 'chat';
  }

  /**
   * Trial a model with a minimal API call BEFORE committing it.
   * Returns true if the model works, false if it's grounded.
   */
  async trialModel(modelId: string): Promise<boolean> {
    const logger = getLogger();
    try {
      const request = {
        model: modelId,
        messages: [{ role: 'user' as const, content: 'hi' }],
        maxTokens: 1,
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of this.provider.complete(request)) {
        break; // Just need first chunk to confirm it works
      }
      // Success — remove from grounded if it was there
      this.groundedModels.delete(modelId);
      return true;
    } catch (err) {
      logger.error('MODEL_TRIAL_FAILED', err, { modelId });
      this.groundedModels.add(modelId);
      const rawTrialMessage = err instanceof Error ? err.message : String(err);
      const statusCode = typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status
        : undefined;
      this.emit({
        type: 'provider_error',
        provider: this.config.provider.activeProvider,
        model: modelId,
        statusCode,
        message: rawTrialMessage,
        recoverable: true,
        actions: [
          { type: 'switch_model', label: 'Pick a different model' },
          { type: 'reconfigure_key', label: 'Update API key' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      });
      return false;
    }
  }

  /**
   * Check if a model is grounded (failed trial this session).
   */
  isModelGrounded(modelId: string): boolean {
    return this.groundedModels.has(modelId);
  }

  /**
   * Get the set of grounded model IDs.
   */
  getGroundedModels(): Set<string> {
    return new Set(this.groundedModels);
  }

  async listModels(): Promise<void> {
    const logger = getLogger();
    try {
      const models = await this.provider.listModels();
      if (models.length === 0) {
        this.emit({
          type: 'error',
          code: 'NO_MODELS',
          message: '🏚 Hangar Empty — No models returned by the API. Verify your key has correct permissions.',
          recoverable: true,
          actions: [{ type: 'dismiss', label: 'Dismiss' }],
        });
        return;
      }
      // Cache context windows for token tracking
      for (const m of models) {
        this.cachedModels.set(m.id, m.contextWindow);
        this.cachedModelCapabilities.set(m.id, m.capabilities);
      }
      this.emit({
        type: 'command_action',
        action: 'list_models',
        models,
        currentModel: this.config.provider.activeModel,
      });
    } catch (err) {
      logger.error('MODEL_LIST_FAILED', err);
      const spaceErr = resolveSpaceError(err);
      this.emit({
        type: 'error',
        code: 'MODEL_LIST_FAILED',
        message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
        recoverable: true,
        actions: [{ type: 'dismiss', label: 'Dismiss' }],
      });
    }
  }

  /** Re-attach interactive permission prompts after an ephemeral automation run. */
  bindPermissionHandler(): void {
    if (!this.toolExecutor || this.options.automationRun) return;
    this.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel, context) => {
      if (isPermissionExemptTool(toolId)) return 'allow_once';
      if (this.isDelegatedWorker || this.autoApproveTools || this.turnApprovedAll) return 'allow_once';
      const requestId = randomUUID();
      return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
        this.pendingPermissions.set(requestId, { resolve, toolName: toolId, path, riskLevel });
        this.emit({
          type: 'permission_required',
          requestId,
          tool: toolId,
          path,
          riskLevel,
          integrationPreview: context?.integrationPreview,
        });
      });
    });
  }

  /**
   * Prompt for tools a scheduled automation will need before registration.
   * Requires allow_always grants so the worker can run without interactive prompts.
   */
  async ensureAutomationToolsApproved(
    toolIds: string[],
  ): Promise<{ ok: boolean; denied?: string[]; error?: string }> {
    const executor = this.toolExecutor;
    if (!executor || toolIds.length === 0) return { ok: true };

    const denied: string[] = [];
    const unique = [...new Set(toolIds)];

    for (const toolId of unique) {
      const existing = executor.getPermissionManager().check(toolId, '*')
        ?? executor.getPermissionManager().check(toolId);
      if (existing === 'allow_always') continue;

      const tool = this.toolRegistry?.get(toolId);
      const riskLevel = tool?.riskLevel ?? 'medium';

      const choice = await new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
        const requestId = randomUUID();
        this.pendingPermissions.set(requestId, { resolve, toolName: toolId, path: '*', riskLevel });
        this.emit({
          type: 'permission_required',
          requestId,
          tool: toolId,
          path: '*',
          riskLevel,
          forAutomation: true,
        });
      });

      if (choice === 'deny') {
        denied.push(toolId);
        continue;
      }
      if (choice === 'allow_once') {
        executor.getPermissionManager().grant(toolId, 'allow_always');
        this.persistPermissionGrant(toolId, 'allow_always');
      }
    }

    if (denied.length > 0) {
      return {
        ok: false,
        denied,
        error: `User denied tools required for this automation: ${denied.join(', ')}`,
      };
    }
    return { ok: true };
  }

  /** Show automation notification channel questionnaire in chat. */
  async promptAutomationNotifyChannels(questionnaire: QuestionnairePayload): Promise<string> {
    return this.waitForQuestionnaireResponse(questionnaire);
  }

  /** Grant notify tool permissions without prompting (automation channel selection). */
  grantAutomationNotifyTools(toolIds: string[]): void {
    const executor = this.toolExecutor;
    if (!executor || toolIds.length === 0) return;
    for (const toolId of toolIds) {
      executor.getPermissionManager().grant(toolId, 'allow_always');
      this.persistPermissionGrant(toolId, 'allow_always');
    }
  }

  /**
   * Respond to a pending permission request from the tool executor.
   */
  respondToPermission(requestId: string, choice: 'allow_once' | 'allow_always' | 'deny'): void {
    const entry = this.pendingPermissions.get(requestId);
    if (!entry) return;
    if (choice === 'allow_always') {
      this.toolExecutor?.getPermissionManager().grant(entry.toolName, 'allow_always');
      this.persistPermissionGrant(entry.toolName, 'allow_always');
    }
    entry.resolve(choice);
    this.pendingPermissions.delete(requestId);
  }

  /**
   * Approve or deny all pending permission requests at once.
   */
  respondToPermissionBatch(choice: 'allow_once' | 'allow_always' | 'deny'): void {
    if (choice === 'allow_always') {
      this.toolExecutor?.getPermissionManager().allowAll();
      this.persistPermissionGrant('*', 'allow_always');
    } else if (choice !== 'deny') {
      this.turnApprovedAll = true;
    }
    for (const [id, entry] of this.pendingPermissions) {
      if (choice === 'allow_always') {
        this.toolExecutor?.getPermissionManager().grant(entry.toolName, 'allow_always');
        this.persistPermissionGrant(entry.toolName, 'allow_always');
      }
      entry.resolve(choice);
      this.pendingPermissions.delete(id);
    }
  }

  /** Persist Telegram (or other channel) permission decisions from inline buttons. */
  recordToolPermissionDecision(toolName: string, decision: PermissionDecision): void {
    if (!this.toolExecutor) return;
    if (decision === 'allow_always') {
      this.toolExecutor.getPermissionManager().grant(toolName, 'allow_always');
      this.persistPermissionGrant(toolName, 'allow_always');
    } else if (decision === 'deny') {
      this.toolExecutor.getPermissionManager().deny(toolName);
      this.persistPermissionGrant(toolName, 'deny');
    }
  }

  formatChannelToolPermissions(): string {
    const pm = this.toolExecutor?.getPermissionManager();
    if (!pm) return '🔐 No permission state available.';
    if (pm.isAllAllowed()) {
      return '🔐 *Permissions*\n✅ All tools are always allowed for this channel session.';
    }
    const perms = pm.list().filter((p) => p.id !== '__all__');
    const allowed = perms.filter((p) => p.decision === 'allow_always').map((p) => p.toolName);
    const denied = perms.filter((p) => p.decision === 'deny').map((p) => p.toolName);
    const lines = ['🔐 *Permissions*'];
    lines.push('', '*Always allowed:*', allowed.length ? allowed.map((t) => `  ✅ ${t}`).join('\n') : '  (none)');
    lines.push('', '*Denied:*', denied.length ? denied.map((t) => `  ❌ ${t}`).join('\n') : '  (none)');
    lines.push('', 'Revoke with `/permissions revoke <tool>` or `/permissions revoke-all`.');
    return lines.join('\n');
  }

  revokeChannelToolPermissions(tools?: string[], revokeAll = false): string {
    const pm = this.toolExecutor?.getPermissionManager();
    if (!pm) return '🔐 No permission state available.';
    const store = (this.sessionManager as unknown as {
      store?: { removePermissions?: (sessionId: string, toolName?: string) => void };
    })?.store;

    if (revokeAll) {
      pm.revokeAll();
      store?.removePermissions?.(this.sessionId);
      return '🗑 All remembered tool permissions revoked for this channel session.';
    }

    const names = (tools ?? []).map((t) => t.trim()).filter(Boolean);
    if (!names.length) return '❌ Specify at least one tool name to revoke.';
    for (const name of names) {
      pm.revoke(name);
      store?.removePermissions?.(this.sessionId, name);
    }
    return `🗑 Revoked permissions for: ${names.join(', ')}`;
  }

  getMessageHistory(): CompletionMessage[] {
    return [...this.messages];
  }

  /**
   * Rebuild session context from conversation.json.
   */
  rebuildContext(): number {
    return this.contextTracker.rebuildFromMessages(this.messages as Array<{ role: string; content: string }>);
  }

  /**
   * Add a message to the history (used for restoring sessions).
   */
  addToHistory(msg: { role: 'user' | 'assistant' | 'system'; content: string }): void {
    this.messages.push({ role: msg.role, content: msg.content });
    if (msg.role === 'system') return;
    if (msg.role === 'assistant' && this.options.promptProfile === 'crew_private' && this.options.crewPrivateHost) {
      this.contextTracker.record('assistant', msg.content, this.options.crewPrivateHost.name);
    } else {
      this.contextTracker.record(msg.role, msg.content);
    }
  }

  clearHistory(): void {
    const system = this.messages.find((m) => m.role === 'system');
    this.messages = system ? [system] : [];
  }

  /**
   * Run deep research on a question using parallel sub-agents and synthesis.
   */
  async research(question: string): Promise<Message> {
    const startTime = Date.now();
    this.scope = new Scope();

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content: `/research ${question}`,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };

    this.messages.push({ role: 'user', content: userMessage.content });
    this.turnApprovedAll = false;
    this.emit({ type: 'message_sent', message: userMessage });
    this.emit({ type: 'loading_start', stage: 'research' });

    try {
      const report = await this.researchEngineCapability.research(question, this);
      this.messages.push({ role: 'assistant', content: report });

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: report,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: estimateOutputTokens(report),
      };

      this.emit({ type: 'loading_end' });
      this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });
      return assistantMessage;
    } catch (error) {
      this.emit({ type: 'loading_end' });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sessionLogger?.logErrorUser(errorMessage, 'RESEARCH_FAILED');
      const fallback: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: `Research failed: ${errorMessage}`,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: 0,
      };
      this.emit({ type: 'message_received', message: fallback, elapsed: Date.now() - startTime });
      return fallback;
    } finally {
      this.lifecycle.forceTransition('idle');
      this.scope = null;
    }
  }

  /**
   * End the session — records diary entry and updates identity.
   */
  endSession(): void {
    try {
      this.contextTracker.clear();
      // Record interaction count
      this.secretSauce.identity.recordInteraction();

      // Build diary entry from message history
      const userMsgs = this.messages.filter((m) => m.role === 'user');
      const assistantMsgs = this.messages.filter((m) => m.role === 'assistant');

      if (userMsgs.length > 0) {
        const highlights = userMsgs.slice(0, 3).map((m) =>
          typeof m.content === 'string' ? m.content.slice(0, 60) : 'tool interaction'
        );
        const summary = `Session with ${userMsgs.length} user messages and ${assistantMsgs.length} responses.`;
        this.secretSauce.recordDiary(summary, 1, highlights, []);
      }
    } catch {
      // Silent failure — diary is non-critical
    }
  }

  /**
   * Run background summarization of memories and diary.
   * Non-blocking — failures are silently ignored.
   */
  private async runSummarization(): Promise<void> {
    try {
      const summarizer = this.secretSauce.summarizer;

      // Summarize memories
      const recentMemories = this.secretSauce.memories.getRecentMemories(50);
      if (recentMemories.length > 5) {
        const memPrompt = summarizer.buildMemorySummarizationPrompt(recentMemories);
        if (memPrompt) {
          const content = await this.simpleComplete(memPrompt);
          if (content) summarizer.storeMemorySummary(content);
        }
      }

      // Summarize diary
      const recentDiary = this.secretSauce.diary.getRecent(14);
      if (recentDiary.length > 3) {
        const diaryPrompt = summarizer.buildDiarySummarizationPrompt(recentDiary);
        if (diaryPrompt) {
          const content = await this.simpleComplete(diaryPrompt);
          if (content) summarizer.storeDiarySummary(content);
        }
      }
    } catch {
      // Non-critical — silent failure
    }
  }

  /**
   * Simple non-streaming completion for internal tasks (summarization, memory extraction).
   */
  private async simpleComplete(prompt: string): Promise<string> {
    let result = '';
    const stream = this.provider.complete({
      messages: [{ role: 'user', content: prompt }],
      model: this.config.provider.activeModel,
      maxTokens: 600,
      stream: true,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta' && chunk.content) {
        result += chunk.content;
      }
    }
    return result;
  }

  /**
   * Decompose a complex task into subtasks and delegate to specialist sub-agents in parallel.
   */
  async decomposeAndDelegate(task: string): Promise<{
    subResults: Array<{ specialist: SpecialistType; output: string; elapsed: number }>;
    synthesized: string;
    totalElapsed: number;
  }> {
    const start = Date.now();
    this.emit({ type: 'decomposition_start', task });

    // LLM-driven decomposition: break task into subtasks per specialist
    const decompositionPrompt = `Break this complex task into subtasks that can be handled by specialist agents:
"${task.slice(0, 500)}"

Available specialists: coder, reviewer, tester, researcher, devops, docs_writer, architect, debugger

For each specialist that is relevant, write a SUBTASK in one line.
Format:
CODER: <subtask>
REVIEWER: <subtask>
... etc.

Only include specialists that are actually needed for this task.`;

    const prov = this.provider;
    let decomposition = '';
    try {
      const stream = prov.complete({
        messages: [{ role: 'user', content: decompositionPrompt }],
        model: this.config.provider.activeModel,
        maxTokens: 500,
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.content) decomposition += chunk.content;
      }
    } catch (e) {
      // Fallback: single sub-agent
      this.emit({ type: 'decomposition_fallback', task });
      const sub = new SmartSubAgent({ parentAgent: this, instruction: task });
      const result = await sub.execute();
      return {
        subResults: [{ specialist: 'coder' as SpecialistType, output: result.output, elapsed: result.elapsed }],
        synthesized: result.output,
        totalElapsed: Date.now() - start,
      };
    }

    // Parse decomposition into specialist tasks
    const subtasks: Array<{ specialist: SpecialistType; instruction: string }> = [];
    const lines = decomposition.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)/);
      if (match && match[1] && match[2]) {
        const spec = match[1].toLowerCase() as SpecialistType;
        const instruction = match[2];
        if (this.specialistRegistry.getByType(spec)) {
          subtasks.push({ specialist: spec, instruction });
        }
      }
    }

    if (subtasks.length === 0) {
      getLogger().warn('DECOMPOSE', 'No matching specialist found for task decomposition. Skipping sub-agent spawn.');
      this.emit({ type: 'decomposition_ready', subtaskCount: 0 });
      return { subResults: [], synthesized: '', totalElapsed: Date.now() - start };
    }

    this.emit({ type: 'decomposition_ready', subtaskCount: subtasks.length });

    // Spawn parallel sub-agents
    const subPromises = subtasks.map(async ({ specialist, instruction }) => {
      const spec = this.specialistRegistry.getByType(specialist);
      if (!spec) return null;

      const sub = new SmartSubAgent({
        parentAgent: this,
        instruction: `[SPECIALIST: ${spec.name}]\n${instruction}`,
        tools: spec.preferredTools,
        config: { ...this.config },
        sessionId: `sub-${specialist}-${Date.now()}`,
      });

      this.agentBus.publish(this.sessionId, spec.agentId, 'subtask', {
        instruction,
        parentTask: task,
      });

      const result = await sub.execute();
      return { specialist, output: result.output, elapsed: result.elapsed };
    });

    const rawResults = await Promise.all(subPromises);
    const subResults = rawResults.filter((r): r is { specialist: SpecialistType; output: string; elapsed: number } => r !== null);

    // Synthesize results
    const parts = subResults.map((r) =>
      `--- ${r.specialist.toUpperCase()} (${r.elapsed}ms) ---\n${r.output.slice(0, 2000)}`
    );
    const synthesisPrompt = `Synthesize these specialist reports into a single coherent response:\n\n${parts.join('\n\n')}\n\nConsolidated response:`;

    let synthesized = '';
    try {
      const synthStream = prov.complete({
        messages: [{ role: 'user', content: synthesisPrompt }],
        model: this.config.provider.activeModel,
        maxTokens: 2000,
        stream: true,
      });
      for await (const chunk of synthStream) {
        if (chunk.type === 'text_delta' && chunk.content) synthesized += chunk.content;
      }
    } catch {
      synthesized = subResults.map((r) => `${r.specialist}: ${r.output}`).join('\n\n');
    }

    const totalElapsed = Date.now() - start;
    this.emit({ type: 'decomposition_complete', subResultCount: subResults.length, totalElapsed });

    return { subResults, synthesized, totalElapsed };
  }

  /**
   * Get cumulative learnings from reflection loop to inject into system prompt.
   */
  getLearningsContext(): string {
    return this.reflectionLoop.getCumulativeLearnings();
  }

  get agentBusInstance(): AgentBus { return this.agentBus; }
  get specialistRegistryInstance(): SpecialistRegistry { return this.specialistRegistry; }
  get skillGeneratorInstance(): SkillGenerator | null { return this.skillGenerator; }
  get reflectionLoopInstance(): ReflectionLoop { return this.reflectionLoop; }

  // Store the last compaction summary for iterative updates
  private lastCompactionSummary: string | null = null;

  private async compactContext(): Promise<void> {
    const contextWindow = this.getContextWindow();
    const thresholds = getTokenThresholds(contextWindow);
    const usedTokens = this.tokenTracker.tokensUsed;
    if (!isTokenOverflow(usedTokens, thresholds)) return;

    const lastMarkerIdx: number = this.compactionMarkerIndices.length > 0
      ? this.compactionMarkerIndices[this.compactionMarkerIndices.length - 1]!
      : -1;
    const recentMessages = this.messages.slice(lastMarkerIdx + 1)
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');
    if (!recentMessages.trim()) return;

    this.emit({ type: 'compaction_start', currentTokens: usedTokens, threshold: contextWindow } as EngineEvent);

    let summary = '';
    try {
      const prompt = this.lastCompactionSummary
        ? COMPACTION_UPDATE_PROMPT.replace('{previousSummary}', this.lastCompactionSummary) + '\n\n' + recentMessages
        : COMPACTION_PROMPT + '\n\n' + recentMessages;
      summary = await this.simpleComplete(prompt);
    } catch {
      return;
    }
    if (!summary.trim()) return;

    this.lastCompactionSummary = summary;

    const insertIdx = this.messages.length;
    this.messages.push({ role: 'system', content: `[COMPACTION SUMMARY — ${new Date().toISOString()}]\n${summary}` });
    this.compactionMarkerIndices.push(insertIdx);

    const pruneStart = lastMarkerIdx + 1;
    const pruneEnd = insertIdx;
    if (pruneStart < pruneEnd) {
      const removeCount = pruneEnd - pruneStart;
      this.messages.splice(pruneStart, removeCount);
      this.compactionMarkerIndices = this.compactionMarkerIndices
        .filter(i => i !== insertIdx)
        .map(i => i >= pruneEnd ? i - removeCount : i)
        .concat(pruneStart);
    }

    const saved = pruneEnd - pruneStart;
    if (saved > 0) {
      // Estimate tokens removed and adjust the tracker downward
      const compactedMessages = this.messages.slice(pruneStart, pruneStart + (pruneEnd - pruneStart) || 0);
      const prunedTokens = estimateMessagesTokens(compactedMessages as any);
      const summaryTokens = estimateTokens(summary);
      const netSavings = Math.max(0, prunedTokens - summaryTokens);
      this.tokenTracker.addUsage(-netSavings);
      getLogger().info('COMPACTION', `Compacted ${saved} messages (${estimateTokens(summary)} token summary, saved ~${netSavings} tokens, ${usedTokens} → ${this.tokenTracker.tokensUsed})`);
    }
    this.emit({ type: 'compaction_complete', saved, summary } as EngineEvent);
    this._compactionCount += 1;
    try {
      const mgr = this.sessionManager as unknown as { persistSessionFields?: (id: string, u: Record<string, unknown>) => void };
      mgr.persistSessionFields?.(this.sessionId, { compactionCount: this._compactionCount });
    } catch { /* best-effort */ }
  }

  private tagCrewPrivateAssistant(msg: Message): Message {
    const host = this.options.crewPrivateHost;
    if (this.options.promptProfile !== 'crew_private' || !host || msg.crew) return msg;
    return {
      ...msg,
      crew: {
        crewId: host.id,
        name: host.name,
        callsign: host.callsign,
        color: host.color,
        icon: host.icon,
      },
    };
  }

  private emit(event: EngineEvent, isUpdateFlag?: boolean): void {
    const isUpdate = isUpdateFlag === true || (event as { isUpdate?: boolean }).isUpdate === true;
    if (event.type === 'message_received') {
      const raw = event as { message?: Message };
      if (raw.message?.role === 'assistant') {
        event = { ...event, message: this.tagCrewPrivateAssistant(raw.message) } as EngineEvent;
      }
    }
    // Guard against duplicate message_received — only first one wins per turn
    // Pass isUpdate=true to allow re-emitting an updated message (e.g. crew delegation)
    if (event.type === 'message_received' && !isUpdate) {
      const crewMsg = (event as { message?: Message }).message;
      if (crewMsg?.crew) {
        this.eventBus.emit(event);
        return;
      }
      const parts = crewMsg?.parts as Array<{ type?: string }> | undefined;
      const questionnaireOnly = crewMsg?.role === 'assistant'
        && !(crewMsg.content?.trim())
        && parts?.some((p) => p.type === 'questionnaire');
      if (!questionnaireOnly) {
        if (this._turnMessageEmitted) return;
        this._turnMessageEmitted = true;
      }
    }
    this.eventBus.emit(event);
  }

  private persistAssistantMessage(msg: Message): void {
    const store = (this.sessionManager as unknown as {
      store?: {
        insertMessage?: (row: {
          sessionId: string;
          role: string;
          content: string;
          tokenCount?: number;
          metadata?: Record<string, unknown>;
        }) => void;
      };
    } | null)?.store;
    if (!store?.insertMessage) return;
    try {
      store.insertMessage({
        sessionId: this.sessionId,
        role: 'assistant',
        content: msg.content,
        tokenCount: msg.tokenCount ?? 0,
        metadata: msg.crew
          ? {
            crewId: msg.crew.crewId,
            crewName: msg.crew.name,
            callsign: msg.crew.callsign,
          }
          : undefined,
      });
    } catch { /* best-effort */ }
  }

  private getApiKey(): string | undefined {
    const creds = this.getProviderCredentials();
    return creds.apiKey;
  }

  private getBaseUrl(): string | undefined {
    const creds = this.getProviderCredentials();
    return creds.baseUrl;
  }

  private getProviderCredentials(): { apiKey?: string; baseUrl?: string } {
    const providerSettings = this.config.provider.providers?.[this.config.provider.activeProvider];
    if (!providerSettings) return {};
    const activeProfileId = providerSettings.activeProfile;
    const profile = activeProfileId ? providerSettings.profiles?.[activeProfileId] : undefined;
    return {
      apiKey: profile?.apiKey ?? providerSettings.apiKey,
      baseUrl: profile?.baseUrl ?? providerSettings.baseUrl,
    };
  }

  /**
   * Get the user's timezone from config, falling back to system timezone.
   */
  private getUserTimezone(): string {
    return this.config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /**
   * Get the UTC offset string for the user's timezone (e.g. "+05:30", "-04:00").
   */
  private getUtcOffset(): string {
    const tz = this.getUserTimezone();
    const now = new Date();
    // Use Intl to get the offset for the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    // Format is like "GMT+5:30" or "GMT-4" — normalize to "+05:30"
    const raw = tzPart?.value ?? '';
    const match = raw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (match) {
      const sign = match[1];
      const hrs = match[2]!.padStart(2, '0');
      const mins = (match[3] ?? '00').padStart(2, '0');
      return `${sign}${hrs}:${mins}`;
    }
    return '+00:00';
  }

  private getContextWindow(): number {
    const modelId = this.config.provider.activeModel;
    if (modelId && this.cachedModels.has(modelId)) {
      return this.cachedModels.get(modelId)!;
    }
    if (this.tokenTracker?.tokensTotal) {
      return this.tokenTracker.tokensTotal;
    }
    const defaults: Record<string, number> = {
      openai: 128_000,
      anthropic: 200_000,
      google: 1_000_000,
      ollama: 32_000,
      lmstudio: 32_000,
    };
    return defaults[this.config.provider.activeProvider] ?? 128_000;
  }

  private toFriendlyError(error: unknown): { message: string; actions: RemediationAction[] } {
    const spaceErr = resolveSpaceError(error);
    const msg = error instanceof Error ? error.message : String(error);

    // Determine actions based on category
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API')) {
      return {
        message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
        actions: [
          { type: 'reconfigure_key', label: 'Update API key' },
          { type: 'switch_model', label: 'Switch provider' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
      return {
        message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
        actions: [
          { type: 'retry', label: 'Retry' },
          { type: 'switch_model', label: 'Switch model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return {
        message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
        actions: [
          { type: 'switch_model', label: 'Pick a different model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
      return {
        message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
        actions: [
          { type: 'switch_model', label: 'Switch provider' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Generic — retry + dismiss
    return {
      message: `${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`,
      actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }

  // ─── AI SDK PIPELINE: Replaces old _unifiedStream ───
  // Uses the Vercel AI SDK (streamText) under the hood. All tool execution,
  // streaming, retry, and event generation handled by the AI SDK.
  // Emits CompletionChunk for backward compatibility with existing callers.


  // ─── CREW ORCHESTRATION ───

  addCrewMember(crew: import('@agentx/shared').Crew): void {
    if (!this.crewOrchestrator) return;
    this.crewOrchestrator.addMember(crew);
    this.rebuildSystemPrompt();
  }

  removeCrewMember(crewId: string): void {
    if (!this.crewOrchestrator) return;
    this.crewOrchestrator.removeMember(crewId);
    this.rebuildSystemPrompt();
  }

  getCrewMembers(): Array<{ crew: import('@agentx/shared').Crew; expertise: string[]; active: boolean }> {
    if (!this.crewOrchestrator) return [];
    return this.crewOrchestrator.getMembers();
  }

  /** Crew members enabled for this session (used for auto-compose and spawn tools). */
  getActiveCrewMembers(): CrewMember[] {
    const members = this.crewOrchestrator?.getMembers().filter((m) =>
      m.active !== false && m.crew.enabled !== false,
    ) ?? [];
    if (this.enabledCrewSessionIds.size === 0) return [];
    return members.filter((m) => this.enabledCrewSessionIds.has(m.crew.id));
  }

  restoreCrewStates(states: Array<{ crewId: string; enabled: boolean }>): void {
    for (const state of states) {
      this.setCrewEnabled(state.crewId, state.enabled);
    }
  }

  setCrewEnabled(crewId: string, enabled: boolean): void {
    if (enabled) {
      this.enabledCrewSessionIds.add(crewId);
      const crew = this.secretSauce.crew.get(crewId);
      if (crew && this.crewOrchestrator) {
        this.crewOrchestrator.addMember(crew);
      }
      this.sessionManager?.saveCrewState?.(crewId, true);
    } else {
      this.enabledCrewSessionIds.delete(crewId);
      this.crewOrchestrator?.removeMember(crewId);
      this.sessionManager?.saveCrewState?.(crewId, false);
    }
    this.rebuildSystemPrompt();
  }

  /**
   * Build a concise session context summary for agentic delegation.
   * Used when routing to crew members, sub-agents, or research queries.
   */
  buildAgenticContext(): string {
    const lastUser = [...this.messages].reverse().find((m) => m.role === 'user');
    const current = typeof lastUser?.content === 'string'
      ? lastUser.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
      : '';
    if (!current) return '';

    const turn = this.prepareTurnContext(current);
    return turn.block;
  }

  /** Realtime context block for the current user turn. */
  prepareTurnContext(currentUserMessage: string) {
    const compact = this.usesCompactContext();
    return this.contextTracker.getHandler().buildTurnInjection(
      this.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      currentUserMessage,
      compact ? 1200 : this.contextMemoryChars,
      compact,
    );
  }

  /** Per-session memory budget for injected context (chars). Tunable via setContextMemoryLimits. */
  contextMemoryChars = 2200;

  setContextMemoryLimits(opts: { maxHistoryMessages?: number; maxHistoryChars?: number; maxBlockChars?: number }): void {
    if (opts.maxBlockChars !== undefined) this.contextMemoryChars = opts.maxBlockChars;
    this.contextTracker.setLimits(opts);
  }

  /**
   * Build standardized options for crew mission orchestration.
   */
  buildCrewMissionOptions(members: CrewMember[], userMessage: string, extraContext?: string): CrewMissionOptions {
    const systemMsg = this.messages.find((m) => m.role === 'system');
    const baseContext = this.buildAgenticContext() || '';
    const sessionContext = extraContext
      ? (baseContext ? `${baseContext}\n${extraContext}` : extraContext)
      : baseContext || undefined;
    return {
      agent: this,
      members,
      userMessage,
      sessionContext,
      planMode: this.planMode,
      sessionId: this.sessionId,
      mainSystemPrompt: typeof systemMsg?.content === 'string' ? systemMsg.content : '',
      crewOrchestrator: this.crewOrchestrator ?? undefined,
      waitForClarification: async (questionnaire: QuestionnairePayload) => {
        return this.waitForQuestionnaireResponse(questionnaire);
      },
      onMissionEvent: (payload) => {
        if (!this.onSessionEvent) return;
        this._missionEventSeq += 1;
        this.onSessionEvent({
          type: 'crew_mission_snapshot',
          sessionId: this.sessionId,
          sequence: this._missionEventSeq,
          timestamp: Date.now(),
          payload: {
            missionId: String(payload.missionId ?? ''),
            phase: String(payload.phase ?? 'unknown'),
            success: payload.success as boolean | undefined,
            snapshot: (payload.snapshot as Record<string, unknown>) ?? payload,
          },
        });
      },
    };
  }

  private async superviseCrewMission(
    mission: CrewMissionResult,
    cleanContent: string,
    startTime: number,
  ): Promise<string> {
    const systemMsg = this.messages.find((m) => m.role === 'system');
    const systemContent = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
    const workerSummary = mission.workers.map((w) =>
      `@${w.callsign} (${w.crewName}) [${w.success ? 'ok' : 'failed'}]:\n${w.output.slice(0, 2000)}`,
    ).join('\n\n---\n\n');

    const turnCtx = this.prepareTurnContext(cleanContent);
    const reviewPrompt = `${systemContent}\n\n[CREW SUPERVISOR]\nYou are Agent-X, the project manager supervising a crew mission. Review worker outputs, resolve conflicts, and deliver the final cohesive answer to the user. If the mission failed or needs user input, say so clearly and concisely.\n[/CREW SUPERVISOR]`;

    try {
      const model = createAiSdkModel(this.config, this.getApiKey());
      const r = await streamText({
        model,
        messages: [
          { role: 'system', content: reviewPrompt },
          {
            role: 'user',
            content: `${turnCtx.block}\n\nUser request: ${turnCtx.mergedTask}\n\nMission success: ${mission.success}\n\nCrew outputs:\n${workerSummary}\n\nProvide your final supervised response:`,
          },
        ],
        maxOutputTokens: 4096,
      });
      let text = '';
      for await (const chunk of r.textStream) { text += chunk; }
      if (text.trim()) {
        const msg: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: text,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: Math.ceil(text.length / 4),
        };
        this.messages.push({ role: 'assistant', content: text });
        this.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
      }
      return text.trim() || mission.synthesized;
    } catch {
      return mission.synthesized;
    }
  }

  /**
   * LLM guard — conservative second opinion before Agent-X spawns crew via tools.
   * User @mentions bypass this (explicit intent).
   */
  async guardCrewDelegation(task: string, members: CrewMember[]): Promise<{ allowed: boolean; reason: string }> {
    const recentUser = [...this.messages].reverse().find((m) => m.role === 'user');
    const userMessage = typeof recentUser?.content === 'string' ? recentUser.content : task;
    const result = await evaluateCrewDelegation(
      { userMessage, task, members },
      (prompt) => this.simpleComplete(prompt),
    );
    if (!result.allowed) {
      this.emit({
        type: 'intent_detected',
        intent: 'crew_delegation_denied',
        confidence: 1,
        reasons: [result.reason],
      } as unknown as EngineEvent);
    }
    return result;
  }

  /**
   * Run a crew mission and publish each operative's response as a crew-attributed chat message.
   * Used by @mentions, spawn_crew_workers, and delegate_to_crew.
   */
  async runCrewMissionAndPublish(
    members: CrewMember[],
    task: string,
    options?: { extraContext?: string; startTime?: number; emitLoading?: boolean },
  ): Promise<CrewMissionResult> {
    const startTime = options?.startTime ?? Date.now();

    let missionMembers = members;
    if (this.options.promptProfile !== 'crew_private') {
      const store = (this.sessionManager as unknown as { store?: unknown })?.store;
      const catalogStore = (store as { getCrewCatalogStore?: () => CrewCatalogRecruitStore | null })
        ?.getCrewCatalogStore?.() ?? null;
      missionMembers = await ensureCrewMembersOnRoster(
        this.secretSauce.crew,
        members,
        catalogStore,
        this,
      );
    }

    if (options?.emitLoading !== false) {
      this.emit({ type: 'loading_start', stage: 'crew_mission' });
      for (const m of missionMembers) {
        this.emit({
          type: 'intent_detected',
          intent: `crew:${m.crew.callsign}`,
          confidence: 1,
          reasons: [`Assigned to @${m.crew.callsign}`],
        });
      }
    }

    const mission = await this.crewMissionOrchestrator.runMission(
      this.buildCrewMissionOptions(missionMembers, task, options?.extraContext),
    );

    for (const m of missionMembers) {
      this.contextTracker.getHandler().registerCrew({
        crewId: m.crew.id,
        name: m.crew.name,
        callsign: m.crew.callsign,
        relationship: 'deployed',
      });
    }

    this.publishCrewMissionResponses(mission, missionMembers, startTime);
    return mission;
  }

  private publishCrewMissionResponses(
    mission: CrewMissionResult,
    members: CrewMember[],
    startTime: number,
  ): void {
    for (const r of mission.responses) {
      const crewMember = members.find((m) => m.crew.id === r.crewId);
      if (!crewMember) {
        getLogger().warn('CREW_MISSION', `Response crewId ${r.crewId} not in mission members — skipping misattributed publish`);
        continue;
      }
      const msg: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: r.content,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: 0,
        crew: {
          crewId: crewMember.crew.id,
          name: r.member,
          callsign: r.callsign,
          color: crewMember.crew.color,
          icon: crewMember.crew.icon,
          confidence: mission.success ? 'high' : 'medium',
          reasons: [`Crew worker @${r.callsign}`],
        },
      };
      this.messages.push({ role: 'assistant', content: `[${r.member} (@${r.callsign})]:\n${r.content}` });
      this.contextTracker.record('crew', r.content, r.member);
      this.persistAssistantMessage(msg);
      this.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
    }
  }

  /**
   * Orchestrate parallel crew workers under Agent-X supervision.
   * Replaces the old routeToCrews bypass — workers run full agentic loops with crew personas.
   */
  private async executeCrewMission(
    members: CrewMember[],
    cleanContent: string,
    startTime: number,
    _classificationContext?: string,
  ): Promise<Message> {
    const mission = await this.runCrewMissionAndPublish(members, cleanContent, {
      extraContext: _classificationContext,
      startTime,
      emitLoading: true,
    });

    let lastMessage: Message | null = mission.responses.length > 0
      ? {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: mission.responses[mission.responses.length - 1]!.content,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        }
      : null;

    const needsSupervision = mission.responses.length > 1 || !mission.success;
    if (needsSupervision) {
      const supervisorReview = await this.superviseCrewMission(mission, cleanContent, startTime);
      mission.supervisorReview = supervisorReview;
      if (supervisorReview && supervisorReview !== mission.synthesized) {
        const synthMsg: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: supervisorReview,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: Math.ceil(supervisorReview.length / 4),
        };
        this.messages.push({ role: 'assistant', content: supervisorReview });
        this.emit({ type: 'message_received', message: synthMsg, elapsed: Date.now() - startTime });
        lastMessage = synthMsg;
      }
    } else if (mission.responses.length === 1) {
      lastMessage = lastMessage ?? {
        id: generateMessageId(), sessionId: this.sessionId, role: 'assistant',
        content: mission.synthesized || '', toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
      };
    } else if (mission.synthesized) {
      const synthMsg: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: mission.synthesized,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: 0,
      };
      this.messages.push({ role: 'assistant', content: mission.synthesized });
      this.emit({ type: 'message_received', message: synthMsg, elapsed: Date.now() - startTime });
      lastMessage = synthMsg;
    }

    this.emit({ type: 'loading_end' });
    this.lifecycle.forceTransition('idle');
    this.scope = null;
    this.runStateMgr.release(this.sessionId);
    this.commandQueue.release(this.sessionId);
    return lastMessage ?? {
      id: generateMessageId(), sessionId: this.sessionId, role: 'assistant',
      content: mission.synthesized || '', toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
    };
  }

  /**
   * Auto-delegation: before Agent-X responds, check if any enabled crew
   * member's expertise matches the user message.
   * Uses LLM-powered semantic matching (scalable to any domain).
   */
  private extractTasksFromResponse(content: string): void {
    const conversational = /\b(game|option|choice|suggestion|recommendation|example|sample|or you could|why not try|how about|feel free|pick one|choose from)\b/i;
    if (conversational.test(content)) return;

    const lines = content.split('\n');
    const taskLines: string[] = [];

    for (const line of lines) {
      const stripped = line.trim();
      if (/^\s*[-*•]\s+/.test(stripped) || /^\s*\d+[.)]\s+/.test(stripped)) {
        taskLines.push(stripped);
      }
    }

    if (taskLines.length < 2) return;

    const tasks = taskLines
      .map((l) => l.replace(/^[\s]*[-*•]\s+/, '').replace(/^[\s]*\d+[.)]\s+/, '').trim())
      .map((t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`(.+?)`/g, '$1'))
      .filter((t) => t.length > 5 && t.length < 200);

    if (tasks.length >= 2) {
      this.todoManager.clear();
      this.todoManager.addItems(tasks);
      getLogger().info('TODO_EXTRACT', `Extracted ${tasks.length} tasks from response`);
    }
  }

  getMaxSubAgents(): number {
    return this.maxSubAgents;
  }

  setMaxSubAgents(limit: number): void {
    this.maxSubAgents = Math.max(1, Math.min(20, limit));
  }

  setSessionManager(sm: { createSession: (providerId: string, modelId: string, scopePath?: string, id?: string, parentId?: string) => { id: string } }): void {
    this.sessionManager = sm;
    this.restoreSessionPermissions();
    if (this.options.channelSession) {
      registerChannelPermissionBridge(this.sessionId, {
        list: () => this.formatChannelToolPermissions(),
        revoke: (tools, revokeAll) => this.revokeChannelToolPermissions(tools, revokeAll),
      });
    }
  }

  private persistPermissionGrant(toolName: string, decision: PermissionDecision): void {
    if (!this.sessionManager) return;
    const store = (this.sessionManager as unknown as {
      store?: {
        addPermission?: (perm: {
          id: string;
          sessionId: string;
          toolName: string;
          targetPath?: string | null;
          decision: string;
        }) => void;
      };
    }).store;
    if (!store?.addPermission) return;
    try {
      store.addPermission({
        id: randomUUID(),
        sessionId: this.sessionId,
        toolName,
        targetPath: null,
        decision,
      });
    } catch { /* best-effort */ }
  }

  private restoreSessionPermissions(): void {
    if (!this.sessionManager || !this.toolExecutor) return;
    const store = (this.sessionManager as unknown as {
      store?: { getPermissions?: (sessionId: string) => Array<Record<string, unknown>> };
    }).store;
    if (!store?.getPermissions) return;
    try {
      const rows = store.getPermissions(this.sessionId);
      const pm = this.toolExecutor.getPermissionManager();
      const seen = new Set<string>();
      for (const row of rows) {
        const toolName = (row['tool_name'] ?? row['toolName']) as string;
        const decision = row['decision'] as PermissionDecision;
        if (!toolName || seen.has(toolName)) continue;
        seen.add(toolName);
        if (toolName === '*') {
          pm.allowAll();
        } else if (decision === 'allow_always') {
          pm.grant(toolName, 'allow_always');
        } else if (decision === 'deny') {
          pm.deny(toolName);
        }
      }
    } catch { /* best-effort */ }
  }

  createChildSession(
    childId: string,
    meta?: { kind?: 'sub_agent' | 'crew_worker'; label?: string },
  ): void {
    if (!this.sessionManager?.createChildSessionRecord) return;
    this.sessionManager.createChildSessionRecord(
      childId,
      this.sessionId,
      this.config.provider.activeProvider,
      this.config.provider.activeModel,
      this.scopePath,
      meta,
    );
    this.eventBus.emit({
      type: 'child_session_started',
      childSessionId: childId,
      parentSessionId: this.sessionId,
      label: meta?.label ?? 'Background work',
      kind: meta?.kind ?? 'sub_agent',
    });
  }

  private detectAtMentions(content: string): string[] {
    const normalized = content.replace(/\u200b/g, '');
    const matches = normalized.matchAll(/(?<!\w)@([\w][\w.-]*)/g);
    const mentioned: string[] = [];
    const members = this.getCrewMembers();
    for (const match of matches) {
      const name = match[1]!.toLowerCase();
      const found = members.find(
        (m) => m.crew.callsign.toLowerCase() === name
          || m.crew.name.toLowerCase() === name
          || m.crew.name.toLowerCase().replace(/\s+/g, '_') === name
          || m.crew.id.toLowerCase() === name,
      );
      if (found && !mentioned.includes(found.crew.id)) {
        mentioned.push(found.crew.id);
      }
    }
    return mentioned;
  }

  /**
   * Detect plan-mode violations (successful write tools) and rollback via latest checkpoint.
   */
  private async enforcePlanModeViolations(turnStart: number): Promise<void> {
    const violations = this.toolLedger.getEntries().filter((e) => e.success && isWriteTool(e.name));
    if (violations.length === 0) return;

    getLogger().warn('AGENT', `Plan mode violation: ${violations.length} write tool(s) succeeded`);
    let checkpointId: string | undefined;
    let rolledBack = false;

    try {
      const store = (this.sessionManager as unknown as { store?: { listCheckpoints?: (sid: string) => Array<{ id: string; createdAt: string }>; restoreCheckpoint?: (sid: string, id: string) => boolean } })?.store;
      if (store?.listCheckpoints && store.restoreCheckpoint) {
        const checkpoints = store.listCheckpoints(this.sessionId);
        const turnStartIso = new Date(turnStart - 5000).toISOString();
        const candidate = checkpoints
          .filter((c) => c.createdAt >= turnStartIso)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
          ?? checkpoints[checkpoints.length - 1];
        if (candidate) {
          checkpointId = candidate.id;
          rolledBack = store.restoreCheckpoint(this.sessionId, checkpointId);
        }
      }
    } catch (e) {
      getLogger().error('PLAN_VIOLATION', e instanceof Error ? e.message : String(e));
    }

    this.emit({
      type: 'plan_mode_violation',
      violations: violations.map((v) => ({ tool: v.name, path: v.path, output: v.output.slice(0, 200) })),
      checkpointId,
      rolledBack,
    });
  }

  /**
   * Detect if agent response claims success for restricted operations while in plan mode.
   * Returns whether response is transparent about mode restrictions.
   */
  private validateModeRestrictionTransparency(
    responseContent: string,
    toolExecutions: Array<{ name: string; success: boolean; output: string; elapsed: number }>
  ): { isTransparent: boolean; issues: string[] } {
    const issues: string[] = [];
    
    // Pattern: agent claims to have created/edited/deleted files
    const writePatterns = [
      /created\s+(["`]?[\w./-]+["`]?)/gi,
      /created the file/gi,
      /created a new file/gi,
      /wrote.*to\s+(["`]?[\w./-]+["`]?)/gi,
      /edited\s+(["`]?[\w./-]+["`]?)/gi,
      /modified\s+(["`]?[\w./-]+["`]?)/gi,
      /deleted\s+(["`]?[\w./-]+["`]?)/gi,
      /done!\s*i'[^ ]*ve created/gi,
      /done.*created/gi,
      /i've created/gi,
      /i have created/gi,
    ];
    
    let claimsRestrictedMutation = false;
    for (const pattern of writePatterns) {
      if (pattern.test(responseContent)) {
        claimsRestrictedMutation = true;
        break;
      }
    }
    
    // Check if any edit/delete operations failed
    const restrictedToolsAttempted = toolExecutions.filter(t => isWriteTool(t.name));
    const failedRestricted = restrictedToolsAttempted.filter(t => !t.success);

    // Filesystem ground-truth: if a claimed path exists but tool reported failure, note the mismatch
    for (const entry of failedRestricted) {
      const pathMatch = entry.output.match(/path[=:\s]+(["']?)([\w./-]+)\1/i)
        || entry.output.match(/([\w./-]+\.\w{1,8})/);
      const relPath = pathMatch?.[2] || pathMatch?.[1];
      if (relPath) {
        const absPath = resolve(this.scopePath, relPath);
        if (existsSync(absPath)) {
          issues.push(`Tool ${entry.name} reported failure but file exists: ${relPath}`);
        }
      }
    }
    
    if (claimsRestrictedMutation && failedRestricted.length > 0) {
      issues.push(`Agent claimed success but ${failedRestricted.length} edit/delete operation(s) failed`);
    }
    
    if ((responseContent.includes('Done!') || responseContent.includes('Completed!')) && 
        claimsRestrictedMutation && 
        failedRestricted.length > 0 &&
        !responseContent.toLowerCase().includes('plan mode') &&
        !responseContent.toLowerCase().includes('mode restriction') &&
        !responseContent.toLowerCase().includes('switch to agent')) {
      issues.push('Claims completion without mentioning mode restriction');
    }
    
    return {
      isTransparent: issues.length === 0,
      issues,
    };
  }

  /**
   * Send the fabricated response back to LLM with context about the restriction,
   * and request a refactored honest response.
   */
  private async refactorResponseForTransparency(
    originalMessage: Message,
    validation: { isTransparent: boolean; issues: string[] }
  ): Promise<Message> {
    getLogger().info('AGENT', `Refactoring response due to mode restriction transparency issues: ${validation.issues.join(', ')}`);
    
    // Build context about what failed
    const failedOps = this.toolCallLogForReflection
      .filter(t => !t.success)
      .map(t => `- ${t.name}: ${t.output.slice(0, 100)}`)
      .join('\n');
    
    const refactorPrompt = `[SYSTEM] Your previous response contained an issue:

PROBLEM: You claimed to have edited/deleted files, but those edit/delete tools failed in Plan Mode.
The following operations actually FAILED:
${failedOps}

YOUR PREVIOUS RESPONSE:
${originalMessage.content}

FIX: Rewrite your response to be honest. You must:
1. Explain EXACTLY what edit/delete action you tried
2. Explain that edit/delete requires Agent Mode or Hyperdrive
3. Note that reads, new files, scripts, search, and scheduling work in Plan mode
4. Do NOT claim an edit or delete succeeded

Provide the corrected response now:`;

    try {
      const model = createAiSdkModel(this.config, this.getApiKey());
      const aiMessages = buildCompletionMessages(
        this.messages.slice(0, -1).map(m => ({
          role: m.role,
          content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
        })),
        false,
        3,
        this.config.provider.activeProvider,
      ).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
      aiMessages.push({ role: 'user', content: refactorPrompt });

      let refactoredContent = '';
      this.emit({ type: 'loading_start', stage: 'refactoring' });
      const refactorResult = streamText({
        model,
        messages: aiMessages,
        tools: undefined,
        maxRetries: 1,
      });

      for await (const chunk of refactorResult.fullStream) {
        if (chunk.type === 'text-delta') {
          const delta = extractStreamTextDelta(chunk as Record<string, unknown>);
          refactoredContent = appendStreamText(refactoredContent, delta);
          this.partialTurnContent = refactoredContent;
          this.emit({ type: 'stream_chunk', content: delta, fullContent: refactoredContent });
        }
      }
      this.emit({ type: 'loading_end' });

      if (refactoredContent.trim()) {
        getLogger().info('AGENT', `Refactored response (${refactoredContent.length} chars)`);
        this.messages[this.messages.length - 1] = { role: 'assistant', content: refactoredContent };
        return {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: refactoredContent,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: Math.ceil(refactoredContent.length / 4),
        };
      }
    } catch (error) {
      getLogger().error('REFACTOR', error instanceof Error ? error.message : String(error));
      // If refactor fails, return original but prepend a disclaimer
    }
    
    // Fallback: return original with disclaimer prepended
    const disclaimer = `⚠️ MODE RESTRICTION: You are in Plan Mode (read-only). The operation(s) above could not be executed. Switch to Agent Mode to enable file operations.\n\n${originalMessage.content}`;
    return {
      ...originalMessage,
      content: disclaimer,
    };
  }

  /**
   * Dispose the agent and cleanup all resources.
   * This is the proper shutdown sequence: cancel running tasks → stop sub-agents → 
   * flush operations → mark lifecycle as disposed.
   */
  dispose(): void {
    // Cancel any in-progress processing
    this.cancel();

    // Mark lifecycle as disposed to prevent new operations
    this.lifecycle.forceTransition('disposed');

    // Stop all sub-agents
    this.subAgents.cancelAll();

    // Close file watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }
  }
}

function generateDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lines: string[] = [];
  let o = 0, n = 0;
  while (o < oldLines.length || n < newLines.length) {
    if (o < oldLines.length && n < newLines.length && oldLines[o] === newLines[n]) {
      lines.push(` ${oldLines[o]}`);
      o++; n++;
    } else if (o < oldLines.length && (n >= newLines.length || oldLines[o] !== newLines[n])) {
      lines.push(`-${oldLines[o]}`);
      o++;
    } else if (n < newLines.length) {
      lines.push(`+${newLines[n]}`);
      n++;
    }
  }
  return lines.join('\n');
}
