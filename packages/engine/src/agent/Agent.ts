import type {
  Message,
  EngineEvent,
  SessionEvent,
  CompletionMessage,
  ProviderId,
  AgentXConfig,
  AgentPersonaConfig,
  RemediationAction,
  PermissionRule,
  PermissionDecision,
  QuestionnairePayload,
  ClarificationSource,
  QuestionnaireRecord,
  ClientSituation,
  StorageAdapter,
} from '@agentx/shared';
import { FailoverReason, generateMessageId, getLogger, type ChannelKind, getConfigDir, formatClientSituationBlock, isMessagingChannel, formatQuestionnaireForMessagingChannel, shouldUseQuestionnaireClarification, type PermissionHandlerResult, parseChannelBindingFromSessionId } from '@agentx/shared';
import { Scope } from '../concurrency/Scope.js';
import { join, resolve, normalize } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { ProviderFactory } from '../providers/index.js';
import { AgentLifecycle } from './AgentLifecycle.js';
import { AgentEventBus } from '../EventBus.js';
import { TokenTracker } from '../session/TokenTracker.js';
import type { SessionManager } from '../session/SessionManager.js';
import { SessionPermissionStore } from '../storage/SessionPermissionStore.js';
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
import {
  buildCrewDeploymentIntakeQuestionnaire,
  needsCrewDeploymentIntake,
} from '../crew/crew-deployment-intake.js';
import { buildCrewSuggestionSearchQuery } from './crew-auto-compose.js';
import { scoreMatchCandidates, type RawMatchRow } from '../crew/CrewMatchService.js';
import { setToolRegistryInstance } from '../commands/builtin/tools.js';
import { SecretSauceManager } from '../secret-sauce/index.js';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
import { ExperienceEngine } from '../neural/ExperienceEngine.js';
import type { ExperienceTrial } from '../neural/ExperienceEngine.js';
import { GrowthEngine } from '../neural/GrowthEngine.js';
import { createPgNeuralDb } from '../neural/NeuralDbAdapter.js';
import { MemoryFabric, setMemoryFabricInstance, getMemoryFabricInstance } from '../neural/MemoryFabric.js';
import { OnnxEmbeddingProvider, setEmbedderInstance, getEmbedderInstance } from '../neural/OnnxEmbeddingProvider.js';
import { GraphRagRetriever } from '../neural/GraphRagRetriever.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import type { EmbeddingProvider } from '@agentx/shared';
import { PromptAssembly, type SourceSnapshot, buildClarificationPolicyInstruction, type SectionContext } from '../secret-sauce/prompt-assembly/index.js';
import { registerChannelPermissionBridge } from '../channels/channel-permission-bridge.js';

import {
  buildCompletionMessages,
  isCompactContextProfile,
} from './context-profile.js';
import { ErrorShield } from './ErrorShield.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
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
import { AutonomousDiagnosticsSystem } from './AutonomousDiagnosticsSystem.js';

import { TodoManager } from './TodoManager.js';
import type { SessionLogger } from '../session/SessionLogger.js';
import { estimateTokens, getOutputReserve, resolveEffectiveMaxOutputTokens, estimatePromptTokens, ContextBudgetExceededError, type ModelInfo } from '@agentx/shared';

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
import { createAiSdkModel, createAiSdkTools } from './AiSdkBridge.js';
import { reconcileIntegrationHintWithActiveTools } from '../integrations/integration-tool-availability.js';
import type { ThirdPartyTurnPolicy } from '../integrations/third-party-access.js';
import { buildGoogleAiSdkProviderOptions } from '../providers/google/gemini-metadata.js';
import { createAiSdkStreamHandler } from './AiSdkStreamHandler.js';
import type { PartPersistFn } from './AiSdkStreamHandler.js';
import { streamText, stepCountIs, type ModelMessage } from 'ai';
import {
  buildWebSearchTurnInstruction,
  isWebSearchAvailableForChat,
  resolveWebSearchTurnPolicy,
  resolveWebSearchTurnPolicyAsync,
  createWebSearchIntentClassifier,
  type WebSearchTurnPolicy,
} from '../search/web-search-policy.js';
import { SessionRunner } from '../session/SessionRunner.js';
import { getLoadingSteps, generateDiff, modelMessageContentToText as modelMessageContentToTextHelper, estimateToolSchemaChars as estimateToolSchemaCharsHelper, toFriendlyError as toFriendlyErrorHelper, detectTaskType as detectTaskTypeHelper, checkConnectivity as checkConnectivityHelper, buildIdentityBlock as buildIdentityBlockHelper, simpleComplete as simpleCompleteHelper, endSession as endSessionHelper, runSummarization as runSummarizationHelper, getHealth as getHealthHelper, initializeDiagnosticsAsync as initializeDiagnosticsAsyncHelper, research as researchHelper, compactContext as compactContextHelper, tagCrewPrivateAssistant as tagCrewPrivateAssistantHelper, buildLinkedContextPromptBlock as buildLinkedContextPromptBlockHelper, getProviderCredentials as getProviderCredentialsHelper, getUserTimezone as getUserTimezoneHelper, getUtcOffset as getUtcOffsetHelper, type ConnectivityContext, type IdentityContext, type SimpleCompleteContext, type SessionLifecycleContext, type HealthContext, type DiagnosticsContext, type ResearchContext, type CompactContext, type CrewPrivateContext, type LinkedContextContext, type ProviderCredentialsContext, type TimezoneContext } from './agent-helpers.js';

import {
  superviseCrewMission as superviseCrewMissionHelper,
  publishCrewMissionResponses as publishCrewMissionResponsesHelper,
  executeCrewMission as executeCrewMissionHelper,
  extractTasksFromResponse as extractTasksFromResponseHelper,
  detectAtMentions as detectAtMentionsHelper,
} from './crew-mission-helpers.js';
import {
  resolveContinuationInstructionBlock as resolveContinuationInstructionBlockHelper,
  noteTurnOutcome as noteTurnOutcomeHelper,
  buildQuestionnaireMessage as buildQuestionnaireMessageHelper,
  persistQuestionnaireMessage as persistQuestionnaireMessageHelper,
  updateQuestionnaireMessage as updateQuestionnaireMessageHelper,
  persistAssistantMessage as persistAssistantMessageHelper,
  persistUserMessage as persistUserMessageHelper,
  persistPermissionGrant as persistPermissionGrantHelper,
  restoreSessionPermissions as restoreSessionPermissionsHelper,
  formatChannelToolPermissions as formatChannelToolPermissionsHelper,
  revokeChannelToolPermissions as revokeChannelToolPermissionsHelper,
  clearQuestionnaireResumeState as clearQuestionnaireResumeStateHelper,
  type PersistenceContext,
} from './agent-persistence.js';
import { registerPromptSections as registerPromptSectionsHelper } from './agent-prompt.js';
import {
  bindPermissionHandler as bindPermissionHandlerHelper,
  ensureAutomationToolsApproved as ensureAutomationToolsApprovedHelper,
  grantAutomationNotifyTools as grantAutomationNotifyToolsHelper,
  resolvePermissionRequest as resolvePermissionRequestHelper,
  respondToPermissionBatch as respondToPermissionBatchHelper,
  recordToolPermissionDecision as recordToolPermissionDecisionHelper,
  type PermissionContext,
} from './agent-permissions.js';
import {
  trialModel as trialModelHelper,
  listModels as listModelsHelper,
  switchModel as switchModelHelper,
  getActiveModelCaps as getActiveModelCapsHelper,
  getContextWindow as getContextWindowHelper,
  type ModelTrialContext,
  type ModelListContext,
  type SwitchModelContext,
  type ModelCapsContext,
  type ContextWindowContext,
} from './agent-model.js';
import {
  extractMemories as extractMemoriesHelper,
  ingestWebSearchResult as ingestWebSearchResultHelper,
  reformulateQuery as reformulateQueryHelper,
  buildMemoryContext as buildMemoryContextHelper,
  type MemoryExtractionContext,
  type WebIngestContext,
  type ReformulateQueryContext,
  type MemoryContextContext,
} from './agent-memory.js';
import {
  decomposeAndDelegate as decomposeAndDelegateHelper,
  type DecomposeContext,
} from './agent-decompose.js';
// IntentClassifier import removed — DecisionEngine (heuristic) handles all routing

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
  promptProfile?: 'default' | 'crew_worker' | 'crew_private' | 'voice';
  /** Host crew for 1:1 private chat sessions. */
  crewPrivateHost?: import('@agentx/shared').Crew;
  /** Background worker (sub-agent / crew) — skip interactive permission prompts. */
  delegatedWorker?: boolean;
  /** Ephemeral scheduled automation run — must not clobber shared executor permissions or UI handlers. */
  automationRun?: boolean;
  /** Messaging channel session (Telegram/Slack/etc.) — agent mode only, per-tool approvals via channel UI. */
  channelSession?: boolean;
  /** Parent session ID — for crew workers to access the host conversation's neural brain memory. */
  parentSessionId?: string;
  /** Session context kind — drives super-session memory ingestion and mode defaults. */
  contextKind?: import('@agentx/shared').SessionContextKind;
  /** Refresh MCP integration tools; return optional turn hint and access policy before completion. */
  prepareIntegrationTools?: (userText: string) => Promise<
    string | { hint?: string; policy?: import('../integrations/third-party-access.js').ThirdPartyTurnPolicy } | undefined
  >;
}

export class Agent {
  private provider: ProviderInterface;
  private eventBus: AgentEventBus;
  private tokenTracker: TokenTracker;
  public messages: CompletionMessage[] = [];
  public config: AgentXConfig;
  private persona: AgentPersonaConfig | null = null;
  private clientSituation: ClientSituation | null = null;
  public sessionId: string;
  public scopePath: string;
  /** Public accessor for session ID — needed by SmartSubAgent to pass parentSessionId to crew workers. */
  get currentSessionId(): string { return this.sessionId; }

  /** Link a desktop session for context (scope, crew, resume, narrative) — not transcript merge. */
  setLinkedContextSessionId(sessionId: string | null): void {
    this.linkedContextSessionId = sessionId?.trim() || null;
  }

  getLinkedContextSessionId(): string | null {
    return this.linkedContextSessionId;
  }

  private isProcessing = false;
  readonly lifecycle = new AgentLifecycle();
  public scope: Scope | null = null;
  private _abortSignalController: AbortController | null = null;
  private pendingInstruction: string | null = null;
  private pendingVoiceMerge: { messageId: string; prefixContent: string } | null = null;
  private pendingDelegateCrewIds: string[] | null = null;
  private turnWebSearchPolicy: WebSearchTurnPolicy = 'off';
  private forcedWebSearchToolName: 'deep_web_search' | 'web_search' | null = null;
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  public todoManager: TodoManager;
  private _secretSauce: SecretSauceManager | null = null;
  private get secretSauce(): SecretSauceManager { if (!this._secretSauce) { this._secretSauce = new SecretSauceManager(); } return this._secretSauce; }
  private memoryExtractor: MemoryExtractor | null = null;
  private userChatMemoryIngester: UserChatMemoryIngester | null = null;
  private chatTurnMemoryIngester: ChatTurnMemoryIngester | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: EnhancedToolExecutor;
  private toolRegistry?: ToolRegistry;
  private pendingPermissions = new Map<string, { resolve: (choice: PermissionHandlerResult) => void; toolName: string; path: string; riskLevel: string }>();
  private turnApprovedAll = false;
  private _onPart?: PartPersistFn;
  private options: Readonly<AgentOptions>;
  private promptAssembly: PromptAssembly;
  private promptSnapshot: Record<string, SourceSnapshot> | null = null;
  private sessionPermissionStore: SessionPermissionStore;

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
  public toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }> = [];

  // ─── Model Selection
  private cachedModelInfo: Map<string, ModelInfo> = new Map();
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
  private pendingStepCap: ((continueRun: boolean) => void) | null = null;
  /** Set when the user hits Stop — stream/tools must halt immediately. */
  private userCancelledTurn = false;
  private turnState = new TurnStateManager();
  public toolLedger = new ToolLedger();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  public partialTurnContent = '';
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

  get bypassPermissions(): boolean {
    return this.toolExecutor?.getPermissionManager().isAllAllowed() ?? false;
  }

  setBypassPermissions(enabled: boolean): void {
    this.toolExecutor?.getPermissionManager().setBypassPermissions(enabled);
    this.sessionPermissionStore.setBypass(enabled);
    this.emit({ type: 'bypass_permissions_changed', enabled, sessionId: this.sessionId });
  }

  toggleBypassPermissions(): boolean {
    const enabled = !this.bypassPermissions;
    this.setBypassPermissions(enabled);
    return enabled;
  }

  revokeSessionPermissions(): void {
    this.toolExecutor?.getPermissionManager().revokeAll();
    this.sessionPermissionStore.revokeAll();
    this.emit({ type: 'bypass_permissions_changed', enabled: false, sessionId: this.sessionId });
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
  public get commandQueue(): CommandQueue { if (!this._commandQueue) this._commandQueue = new CommandQueue(); return this._commandQueue; }
  private _runStateMgr: RunStateManager | null = null;
  public get runStateMgr(): RunStateManager { if (!this._runStateMgr) this._runStateMgr = new RunStateManager(); return this._runStateMgr; }
  private _telegramConnected = false;
  private _telegramChatId: number | null = null;
  /** Active inbound messaging channel for the current turn (telegram/slack/discord/email). */
  private activeInboundChannel: string | null = null;
  /** Desktop session linked for context when this agent is the channel super-session. */
  private linkedContextSessionId: string | null = null;
  private _crewOrchestrator: CrewOrchestrator | null = null;
  private _crewMissionOrchestrator: CrewMissionOrchestrator | null = null;
  private get crewMissionOrchestrator(): CrewMissionOrchestrator {
    if (!this._crewMissionOrchestrator) {
      this._crewMissionOrchestrator = new CrewMissionOrchestrator(this.eventBus);
      setCrewMissionDeps(this);
    }
    return this._crewMissionOrchestrator;
  }
  public getCrewOrchestrator(): CrewOrchestrator {
    return this.crewOrchestrator;
  }

  private get crewOrchestrator(): CrewOrchestrator {
    if (!this._crewOrchestrator) {
      this._crewOrchestrator = new CrewOrchestrator(this.provider, this.eventBus, this.tokenTracker);
      this._crewOrchestrator.setActiveModel(this.config.provider.activeModel);
      if (this.toolRegistry && this.toolExecutor) { this._crewOrchestrator.setTools(this.toolRegistry, this.toolExecutor); }
      this._crewOrchestrator.setConfig(this.config);
      this._crewOrchestrator.setSessionId(this.sessionId);
      this._crewOrchestrator.setClarificationHandler((questionnaire) => this.waitForQuestionnaireResponse(questionnaire));
      this._crewOrchestrator.onTokenLog = (opts) => {
        this.onTokenLog?.({ ...opts, crewId: opts.crewId });
      };
      this._crewOrchestrator.onPersistCrewResponse = (response) => {
        getLogger().info('CREW_PERSIST', `Crew response from ${response.crewName} (${response.crewId})`);
      };
    }
    return this._crewOrchestrator;
  }
  public contextTracker!: ContextTracker;
  private compactionMarkerIndices: number[] = [];
  sessionLogger: SessionLogger | null = null;
  onTokenLog: ((opts: { inputTokens: number; outputTokens: number; costUsd: number; crewId?: string }) => void) | null = null;
  onSessionEvent: ((event: SessionEvent) => void) | null = null;

  setContextPersistDir(dir: string, scopePath?: string): void {
    this.contextTracker.setPersistDir(dir);
    if (scopePath) this.contextTracker.setScopePath(scopePath);
  }
  private maxSubAgents = 8;
  public sessionManager: SessionManager | null = null;
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

  private persistenceCtx(): PersistenceContext {
    return {
      sessionId: this.sessionId,
      messages: this.messages,
      sessionManager: this.sessionManager,
      activeInboundChannel: this.activeInboundChannel,
      linkedContextSessionId: this.linkedContextSessionId,
      toolExecutor: this.toolExecutor,
      options: this.options,
      sessionPermissionStore: this.sessionPermissionStore,
      getPersistStore: () => this.getPersistStore(),
    };
  }

  private _permissionCtx(): PermissionContext {
    return {
      toolExecutor: this.toolExecutor as unknown as PermissionContext['toolExecutor'],
      options: this.options,
      isDelegatedWorker: this.isDelegatedWorker,
      turnApprovedAll: this.turnApprovedAll,
      userCancelledTurn: this.userCancelledTurn,
      pendingPermissions: this.pendingPermissions,
      emit: (event) => this.emit(event),
      persistPermissionGrant: (toolId, decision) => this.persistPermissionGrant(toolId, decision),
    };
  }

  private getPersistStore(): StorageAdapter | null {
    return this.sessionManager?.getStorageAdapter() ?? null;
  }

  private resolveContinuationInstructionBlock(userText: string): string | null {
    return resolveContinuationInstructionBlockHelper(this.persistenceCtx(), userText);
  }

  private noteTurnOutcome(content: string): void {
    return noteTurnOutcomeHelper(this.persistenceCtx(), content);
  }

  recordCrewFeedback(crewId: string, positive: boolean): void {
    this.crewOrchestrator.recordFeedback(crewId, positive);
  }

  recordTrial(sessionId: string, trial: ExperienceTrial): void {
    this.experienceEngine.recordTrial(sessionId, trial);
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

  private isMessagingChannelContext(): boolean {
    if (this.options.channelSession) {
      // Voice sessions are channel sessions but NOT messaging channels —
      // they should not trigger messaging-channel conduct (questionnaires, etc.)
      if (parseChannelBindingFromSessionId(this.sessionId) === 'voice') return false;
      return true;
    }
    return isMessagingChannel(this.activeInboundChannel);
  }

  private async waitForOpenClarification(prompt: string, _source?: ClarificationSource): Promise<string> {
    if (this.userCancelledTurn) {
      const err = new Error('Turn aborted');
      err.name = 'AbortError';
      throw err;
    }
    this.turnState.setPhase('awaiting_permission', 'clarification');
    this.discardStreamPreambleBeforeQuestionnaire();

    const messageId = generateMessageId();
    const host = this.options.crewPrivateHost;
    const crew = this.options.promptProfile === 'crew_private' && host
      ? { crewId: host.id, name: host.name, callsign: host.callsign, color: host.color, icon: host.icon }
      : undefined;
    const clarMsg: Message = {
      id: messageId,
      sessionId: this.sessionId,
      role: 'assistant',
      content: prompt,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
      crew,
    };

    const store = this.getPersistStore();
    if (store?.insertMessage) {
      try {
        store.insertMessage({
          id: clarMsg.id,
          sessionId: clarMsg.sessionId,
          role: clarMsg.role,
          content: clarMsg.content,
          createdAt: clarMsg.createdAt,
        });
      } catch { /* best-effort */ }
    }

    this.activeClarificationResume = {
      kind: this.activeClarificationResume?.kind ?? 'questionnaire',
      questionnaireMessageId: messageId,
      userText: this.activeClarificationResume?.userText,
      delegateCrewIds: this.activeClarificationResume?.delegateCrewIds,
      primaryCrewId: this.activeClarificationResume?.primaryCrewId,
      crewIntakeFromPicker: this.activeClarificationResume?.crewIntakeFromPicker,
    };
    this.emit({ type: 'message_received', message: clarMsg, elapsed: 0 });

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

    if (response && response !== '(skipped)') {
      this.messages.push({ role: 'user', content: response });
    }

    this.turnState.setPhase('running', 'resuming');
    this.emit({
      type: 'loading_start',
      stage: this.options.promptProfile === 'crew_private' ? 'crew_private' : 'thinking',
    });
    return response;
  }

  private async waitForQuestionnaireResponse(questionnaire: QuestionnairePayload): Promise<string> {
    if (this.userCancelledTurn) {
      const err = new Error('Turn aborted');
      err.name = 'AbortError';
      throw err;
    }
    const payload: QuestionnairePayload = questionnaire.source
      ? questionnaire
      : { ...questionnaire, source: this.clarificationSource() };

    if (!shouldUseQuestionnaireClarification(payload)) {
      const prompt = payload.questions.map((q) => q.prompt).filter(Boolean).join('\n') || 'Could you clarify?';
      getLogger().warn('CLARIFICATION', 'Text-only questionnaire redirected to plain chat');
      return this.waitForOpenClarification(prompt, payload.source);
    }

    this.turnState.setPhase('awaiting_permission', 'clarification');

    // Drop any assistant preamble streamed before ask_clarification in this step
    this.discardStreamPreambleBeforeQuestionnaire();

    const messageId = generateMessageId();
    const record: QuestionnaireRecord = { payload, status: 'pending' };
    const questionnaireMsg = this.buildQuestionnaireMessage(messageId, record);

    // Messaging channels have no questionnaire modal — populate content so Telegram/Slack/Discord can reply.
    if (this.isMessagingChannelContext()) {
      questionnaireMsg.content = formatQuestionnaireForMessagingChannel(payload);
      getLogger().info('CHANNEL', `Clarification on messaging channel (${this.activeInboundChannel ?? 'channelSession'}): len=${questionnaireMsg.content.length}`);
    }

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
    if (this.isMessagingChannelContext()) {
      updatedMsg.content = questionnaireMsg.content;
    }
    this.updateQuestionnaireMessage(messageId, answered);
    clearQuestionnaireResumeStateHelper(this.persistenceCtx());
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
    return buildQuestionnaireMessageHelper(this.persistenceCtx(), messageId, record);
  }

  private persistQuestionnaireMessage(msg: Message): void {
    return persistQuestionnaireMessageHelper(this.persistenceCtx(), msg);
  }

  private updateQuestionnaireMessage(messageId: string, record: QuestionnaireRecord): void {
    return updateQuestionnaireMessageHelper(this.persistenceCtx(), messageId, record);
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
    this.sessionPermissionStore = new SessionPermissionStore(this.sessionId);
    this.scopePath = normalize(resolve(options.scopePath!));
    this._pgPool = options.pgPool ?? null;
    const crewHost = options.crewPrivateHost;
    this.contextTracker = new ContextTracker(null, this.sessionId,
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
    this.subAgents.ingestBackgroundResultsForSession(this.sessionId);
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
      const service = getCrewSuggestionService(this.getPersistStore());
      if (!service) return [];
      await service.ensureReady();
      type CatalogSearchStore = {
        searchCatalog: (q: string, n: number) => Promise<Array<Record<string, unknown> & { ftsRank: number }>>;
        searchRosterCrews: (q: string, n: number) => Promise<Array<Record<string, unknown> & { ftsRank: number }>>;
        listRecruitedCatalogIds: () => Promise<Set<string>>;
      };
      const catalogStore = (this.getPersistStore() as { getCrewCatalogStore?: () => CatalogSearchStore | null })
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
        for (const [name, handler] of options.toolExecutor.getHandlers()) {
          this.toolExecutor.registerHandler(name, handler);
        }
        // Copy permission handlers from shared toolkit executor
        const permHandler = options.toolExecutor.getPermissionRequestHandler();
        if (permHandler) this.toolExecutor.setPermissionRequestHandler(permHandler);
        const channelPermHandler = options.toolExecutor.getChannelPermissionRequestHandler();
        if (channelPermHandler) this.toolExecutor.setChannelPermissionRequestHandler(channelPermHandler);
        const beforeHook = options.toolExecutor.getBeforeToolHook();
        if (beforeHook) this.toolExecutor.setBeforeToolHook(beforeHook);
      } else {
        // Plain mock object from tests — wrap it
        this.toolExecutor = new EnhancedToolExecutor(options.toolRegistry, this.scopePath);
        const mockObj = options.toolExecutor as Partial<EnhancedToolExecutor>;
        if (mockObj.execute) this.toolExecutor.execute = mockObj.execute;
        if (mockObj.setPermissionRequestHandler) this.toolExecutor.setPermissionRequestHandler = mockObj.setPermissionRequestHandler;
        if (mockObj.setBeforeToolHook) this.toolExecutor.setBeforeToolHook = mockObj.setBeforeToolHook;
        if (mockObj.setScopePath) this.toolExecutor.setScopePath = mockObj.setScopePath;
      }
      this.toolRegistry = options.toolRegistry;
    } else {
      const effectiveScope = this.scopePath;
      const toolkit = createDefaultToolkit(effectiveScope);
      this.toolRegistry = toolkit.registry;
      // Use EnhancedToolExecutor for parallel/doom-loop/repair capabilities
      this.toolExecutor = new EnhancedToolExecutor(toolkit.registry, effectiveScope);
      // Copy handlers from factory executor
      for (const [name, handler] of toolkit.executor.getHandlers()) {
        this.toolExecutor.registerHandler(name, handler);
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
      runSubAgent: (instruction, toolsList, timeout, background) =>
        this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
      onTokenUsage: (input, output) => {
        this.tokenTracker.addTokenUsage(input, output);
        this.onTokenLog?.({ inputTokens: input, outputTokens: output, costUsd: 0 });
      },
      gitManager: this.gitManager ?? undefined,
      onSessionEvent: this.onSessionEvent ?? undefined,
      modelName: this.config.provider.activeModel,
    });

    // Reset permissions for each new session — automation runs reuse the shared executor snapshot.
    if (this.toolExecutor) {
      if (!this.options.automationRun) {
        this.toolExecutor.getPermissionManager().resetForNewSession(this.sessionId);
      }
      this.toolExecutor.setSessionContextKind(this.options.contextKind);
      if (this.options.channelSession) {
        this.toolExecutor.setAlwaysPromptPermissions(true);
      }
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
      const userCmds = options.config['commands'] as UserCommandConfig[] | undefined;
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
    this.maxSubAgents = options.config.maxSubAgents ?? 8;
    this.subAgents.setMaxConcurrent(this.maxSubAgents);
    if (this.toolExecutor instanceof EnhancedToolExecutor) {
      this.toolExecutor.setMaxToolConcurrency(Math.max(this.maxSubAgents, 8));
    }

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
      this._turnFeedbackService = new TurnFeedbackService(() => this.getPersistStore());
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
      this._memoryFabric = getMemoryFabricInstance() ?? new MemoryFabric(this._pgPool);
      if (!getMemoryFabricInstance()) {
        setMemoryFabricInstance(this._memoryFabric);
      }
    }
    return this._memoryFabric;
  }

  private get memoryEmbedder(): EmbeddingProvider | null {
    if (!this._memoryEmbedder) {
      this._memoryEmbedder = getEmbedderInstance() ?? new OnnxEmbeddingProvider();
      if (!getEmbedderInstance()) {
        setEmbedderInstance(this._memoryEmbedder as OnnxEmbeddingProvider);
      }
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
    return buildMemoryContextHelper(
      {
        graphRagRetriever: this.graphRagRetriever,
        messages: this.messages,
        reformulateQuery: (q) => this.reformulateQuery(q),
        sessionId: this.sessionId,
        options: this.options,
        config: this.config,
        memoryFabric: this.memoryFabric,
        memoryEmbedder: this.memoryEmbedder,
        usesCompactContext: () => this.usesCompactContext(),
        setMemoryContextNodeIds: (ids) => { this._memoryContextNodeIds = ids; },
      } as MemoryContextContext,
    );
  }

  /**
   * Reformulate a user message into a standalone search query using conversation context.
   * Short follow-ups like "yes", "continue", "what about X?" get expanded into full
   * queries so RAG retrieval finds relevant memory instead of matching on noise.
   * Falls back to the raw message if reformulation fails.
   */
  private async reformulateQuery(rawQuery: string): Promise<string> {
    return reformulateQueryHelper(
      {
        usesCompactContext: () => this.usesCompactContext(),
        messages: this.messages,
        config: this.config,
        provider: this.provider,
      } as ReformulateQueryContext,
      rawQuery,
    );
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
    return ingestWebSearchResultHelper(
      {
        config: this.config,
        provider: this.provider,
        _pgPool: this._pgPool,
        sessionId: this.sessionId,
        options: this.options,
      } as WebIngestContext,
      toolId,
      args,
      output,
    );
  }

  // ─── Health + Checkpoint
  getHealth(): any {
    return getHealthHelper({
      sessionId: this.sessionId,
      tokenTracker: this.tokenTracker,
      toolExecutor: this.toolExecutor,
      _responseTimes: this._responseTimes,
      _experienceEngine: this._experienceEngine,
      subAgents: this.subAgents,
      _sessionStartTime: this._sessionStartTime,
      _llmCallCount: this._llmCallCount,
      _toolExecCount: this._toolExecCount,
      _errorCount: this._errorCount,
      _maxSessionCost: this._maxSessionCost,
      config: this.config,
      getContextWindow: () => this.getContextWindow(),
      _compactionCount: this._compactionCount,
    } as HealthContext);
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
   * Cancel an in-progress completion. Aborts the active stream, pending UI waits, and tool executions.
   */
  cancel(): void {
    this.userCancelledTurn = true;
    this.toolExecutor?.setTurnAborted(true);
    this.toolExecutor?.setThirdPartyTurnPolicy(null);
    this.abortAllPendingTurnWaits();
    this.abortClarificationWait();
    this._abortSignalController?.abort();
    this.runStateMgr.cancel(this.sessionId);
    this.commandQueue.cancelSession(this.sessionId);
    this.stopTurnHeartbeat();
    this.turnState.cancel();
    this.emitTurnState('cancelled');
    this.emit({ type: 'task_aborted', reason: 'Stopped by user' });
    this.emit({ type: 'loading_end' });
    if (this.scope) {
      this.scope.dispose();
      this.scope = null;
    }
    this._abortSignalController = null;
    this.lifecycle.forceTransition('idle');
    this.subAgents.cancelAll();
    this.sessionRunner.interrupt();
  }

  /** True while a user-initiated stop is tearing down the active turn. */
  isUserCancelled(): boolean {
    return this.userCancelledTurn;
  }

  /** Resolve or reject every human-in-the-loop wait so nothing blocks after Stop. */
  private abortAllPendingTurnWaits(): void {
    for (const [requestId, entry] of this.pendingPermissions) {
      try {
        entry.resolve('deny');
      } catch { /* ignore */ }
      this.pendingPermissions.delete(requestId);
    }

    if (this.pendingStepCap) {
      const resolve = this.pendingStepCap;
      this.pendingStepCap = null;
      resolve(false);
    }

    if (this.pendingStepApproval) {
      this.pendingStepApproval('cancelled', false);
      this.pendingStepApproval = null;
    }
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

  /**
   * Shared runSubAgent callback for createAiSdkTools / SessionRunner.
   * Always routes through SubAgentManager (Fiber + concurrency pool).
   */
  private async runDelegatedSubAgent(
    instruction: string,
    toolsList: string[] | undefined,
    timeout: number,
    background?: boolean,
  ): Promise<{ success: boolean; output: string; elapsed: number; agentId?: string }> {
    // Capture inbound channel context so background sub-agents can reply on the
    // same thread even after this turn has ended.
    const exec = this.toolExecutor;
    const channelContext = exec && (exec.getInboundSourceChannel() || exec.getInboundSourceThreadId())
      ? {
          channel: exec.getInboundSourceChannel() ?? undefined,
          threadId: exec.getInboundSourceThreadId() ?? undefined,
          messageId: exec.getInboundSourceMessageId() ?? undefined,
        }
      : undefined;
    const task = this.subAgents.spawn(instruction, toolsList ?? [], timeout, this.maxSubAgents, undefined, !!background, channelContext);
    if (background) {
      this.emit({ type: 'task_backgrounded', taskId: task.id } as EngineEvent);
      return {
        success: true,
        output: `[Sub-agent started in background — task ${task.id}]`,
        elapsed: 0,
        agentId: task.id,
      };
    }
    const completed = await this.subAgents.waitFor(task.id);
    return {
      success: completed?.status === 'completed',
      output: completed?.result ?? '',
      elapsed: (completed?.endTime ?? Date.now()) - (completed?.startTime ?? Date.now()),
      agentId: task.id,
    };
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

  setFallbackModel(model: string): void {
    this.fallbackModel = model;
  }

  getFallbackModel(): string | null {
    return this.fallbackModel;
  }

  // ─── Autonomous Diagnostics System Initialization ───
  private async initializeDiagnosticsAsync(): Promise<void> {
    return initializeDiagnosticsAsyncHelper({
      scopePath: this.scopePath,
      diagnosticsSystem: this.diagnosticsSystem,
      setSessionContext: (_ctx) => { /* session context stored by diagnostics system */ },
      emit: (event) => this.emit(event),
      setScopePath: (path) => { this.scopePath = path; },
      toolExecutor: this.toolExecutor,
    } as DiagnosticsContext);
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
        || snap.phase === 'awaiting_step_cap') {
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

  private waitForStepCap(currentSteps: number): Promise<boolean> {
    if (this.options.channelSession) {
      this.stepCapExtra++;
      return Promise.resolve(true);
    }
    this.turnState.setPhase('awaiting_step_cap', `steps:${currentSteps}`);
    this.emit({ type: 'step_cap_reached', currentSteps, maxSteps: this.completionStepBudget() });
    return new Promise((resolve) => {
      this.pendingStepCap = (cont) => {
        if (this.userCancelledTurn) {
          resolve(false);
          return;
        }
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
    return checkConnectivityHelper(
      {
        connectivityChecked: this.connectivityChecked,
        setConnectivityChecked: (v) => { this.connectivityChecked = v; },
        getBaseUrl: () => this.getBaseUrl(),
        getApiKey: () => this.getApiKey(),
        config: this.config,
        emit: (event) => this.emit(event),
      } as ConnectivityContext,
      baseUrl,
    );
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

  async sendMessage(content: string, options?: { instruction?: string; userId?: string; channelId?: string; sourceChannel?: string; sourceMessageId?: string; retry?: boolean; delegateCrewIds?: string[]; crewSuggestionResolved?: boolean; crewIntakeFromPicker?: boolean; primaryCrewId?: string; forceWebSearch?: boolean; voiceTurn?: boolean; userMessagePersisted?: boolean; voiceContinuation?: boolean; voiceMergeIntoMessage?: { messageId: string; prefixContent: string }; resumeCrewIntake?: { originalUserText: string; intakeAnswer: string; delegateCrewIds: string[]; primaryCrewId?: string }; clientSituation?: ClientSituation | null }): Promise<Message> {
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
    this.userCancelledTurn = false;
    this.subAgents.ingestBackgroundResultsForSession(this.sessionId);
    this.toolExecutor?.setTurnAborted(false);

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

    // ─── UNIFIED: Hydrate storage cache for this session before any persistence ───
    try {
      const store = this.getPersistStore();
      if (this.sessionId && store && typeof (store as { ensureSessionHydrated?: (sessionId: string) => Promise<void> }).ensureSessionHydrated === 'function') {
        await (store as { ensureSessionHydrated: (sessionId: string) => Promise<void> }).ensureSessionHydrated(this.sessionId);
      }
    } catch { /* best-effort — persistence will guard against FK violations */ }

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
    this.pendingVoiceMerge = options?.voiceMergeIntoMessage ?? null;
    this.pendingDelegateCrewIds = options?.delegateCrewIds?.length ? [...options.delegateCrewIds] : null;
    if (options?.clientSituation) {
      this.clientSituation = options.clientSituation;
    }

    if (!options?.retry) {
      const continuationBlock = this.resolveContinuationInstructionBlock(cleanContent);
      if (continuationBlock) {
        this.pendingInstruction = this.pendingInstruction
          ? `${this.pendingInstruction}\n\n${continuationBlock}`
          : continuationBlock;
      }
    }

    const messagingChannelInbound = options?.sourceChannel === 'telegram'
      || options?.sourceChannel === 'slack'
      || options?.sourceChannel === 'discord'
      || options?.sourceChannel === 'email';
    this.activeInboundChannel = messagingChannelInbound ? (options?.sourceChannel ?? null) : null;
    this.toolExecutor?.setMessagingPermissionMode(messagingChannelInbound);
    this.toolExecutor?.setInboundSourceChannel(messagingChannelInbound ? (options?.sourceChannel ?? null) : null);
    this.toolExecutor?.setInboundSourceThreadId(messagingChannelInbound ? (options?.channelId ?? null) : null);
    this.toolExecutor?.setInboundSourceMessageId(messagingChannelInbound ? (options?.sourceMessageId ?? null) : null);
    this.toolExecutor?.setPermissionPromptHook((details) => {
      this.emit({
        type: 'permission_required',
        requestId: randomUUID(),
        tool: details.toolId,
        path: details.path,
        riskLevel: details.riskLevel,
        forAutomation: details.forAutomation,
        integrationPreview: details.integrationPreview,
      });
    });
    if (!options?.retry) {
      const clarificationBlock = buildClarificationPolicyInstruction(this.isMessagingChannelContext() || messagingChannelInbound);
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${clarificationBlock}`
        : clarificationBlock;
    }

    const searchStatus = isWebSearchAvailableForChat(this.config);
    if (this.options.channelSession || messagingChannelInbound) {
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
        const store = this.getPersistStore();
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
    if (!options?.retry && !options?.voiceContinuation) {
      const turnBoundary = this.messages.length > 0
        ? `\n[TURN ${this.currentTurnId} — treat prior messages as context only unless the user references them]`
        : '';
      this.messages.push({ role: 'user', content: cleanContent + turnBoundary });
    }

    // Record in context tracker
    if (!options?.voiceContinuation) {
      this.contextTracker.record('user', cleanContent);
    }

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content: cleanContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
      ...(messagingChannelInbound && options?.sourceMessageId ? {
        metadata: {
          ...(options?.sourceChannel ? { channel: options.sourceChannel } : {}),
          // Store platform IDs in metadata — persistUserMessage extracts these
          // into dedicated DB columns (platform_message_id, platform_chat_id).
          // Using Record<string, unknown> cast because MessageMetadata is strict.
          ...({ platformMessageId: Number(options.sourceMessageId) } as Record<string, unknown>),
          ...(options?.channelId ? { platformChatId: Number(options.channelId) } as Record<string, unknown> : {}),
        } as Record<string, unknown>,
      } : {}),
    } as Message;

    if (!options?.retry && !options?.voiceContinuation) {
      if (!options?.userMessagePersisted) {
        this.persistUserMessage(userMessage);
        this.emit({ type: 'message_sent', message: userMessage });
      }
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
        this.sessionManager?.persistSessionFields?.(this.sessionId, {
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
    const lastAssistantEntry = [...this.messages].reverse().find((m) => m.role === 'assistant');
    const decision = this.decisionEngine.classify(cleanContent, conversationLen, {
      lastAssistantMessage: typeof lastAssistantEntry?.content === 'string' ? lastAssistantEntry.content : undefined,
      voiceTurn: options?.voiceTurn === true,
    });

    // ─── MODEL CAPABILITY CHECK: warn if model lacks function calling for task intents ───
    const isTaskIntent = decision.messageClass === 'task';
    if (isTaskIntent && !this._capabilityWarningEmitted) {
      const caps = this.cachedModelInfo.get(this.config.provider.activeModel)?.capabilities ?? [];
      if (!caps.includes('function_calling')) {
        this._capabilityWarningEmitted = true;
        this.emit({
          type: 'model_capability_warning',
          model: this.config.provider.activeModel,
          missing: ['function_calling'],
          message: `This model (${this.config.provider.activeModel}) does not support function calling. It cannot execute tools or take actions. Switch to a model with function calling for autonomous execution.`,
        });
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
    });

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
        let missionTask = cleanContent;
        if (options?.crewIntakeFromPicker && needsCrewDeploymentIntake(cleanContent)) {
          const primary = delegatedMembers.find((m) => m.crew.id === options.primaryCrewId) ?? delegatedMembers[0];
          this.activeClarificationResume = {
            kind: 'crew_intake',
            questionnaireMessageId: '',
            userText: cleanContent,
            delegateCrewIds: delegateIds,
            primaryCrewId: options.primaryCrewId,
            crewIntakeFromPicker: true,
          };
          const questionnaire = buildCrewDeploymentIntakeQuestionnaire(
            cleanContent,
            primary?.crew.name,
          );
          const intakeAnswer = await this.waitForQuestionnaireResponse(questionnaire);
          if (intakeAnswer && intakeAnswer !== '(skipped)') {
            missionTask = `${cleanContent}\n\n[User provided planning details]\n${intakeAnswer.trim()}`;
          }
        }
        return await this.executeCrewMission(delegatedMembers, missionTask, startTime, classificationContext);
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
    // Never on voice turns: fast-reply bypasses the per-turn voice [INSTRUCTION] block.
    if (decision.executionPath === 'fast_reply' && !options?.voiceTurn) {
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
        // The current user message was already pushed to history above — drop it
        // from the recent window so it isn't sent twice.
        const recentHistory = this.messages.slice(-4).filter(m => m.role !== 'system');
        const lastRecent = recentHistory[recentHistory.length - 1];
        if (lastRecent?.role === 'user' && typeof lastRecent.content === 'string' && lastRecent.content.startsWith(cleanContent)) {
          recentHistory.pop();
        }
        const fastMessages = [
          { role: 'system' as const, content: fastPrompt + userNote },
          ...recentHistory,
          { role: 'user' as const, content: cleanContent },
        ];
        try {
          const model = createAiSdkModel(this.config, this.getApiKey());
          const streamPromise = (async () => {
            const r = await streamText({ model, messages: fastMessages as ModelMessage[], maxOutputTokens: 256 });
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
    });

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

       // Normal mode: run completion loop directly
       if (!this.options.channelSession && !(await this.checkConnectivity())) {
         throw new Error('Cannot reach LLM provider. Check your internet connection.');
       }
       const assistantMessage = await this.runCompletionLoop(startTime);
       this.noteTurnOutcome(assistantMessage.content);

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

      // If cancelled by user, propagate abort so the turn registry/UI finalize as cancelled.
      if (error instanceof Error && error.name === 'AbortError') {
        if (this.userCancelledTurn) {
          throw error;
        }
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
        this.noteTurnOutcome(fallbackContent);
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
      this.activeInboundChannel = null;
      this.toolExecutor?.setMessagingPermissionMode(false);
      this.toolExecutor?.setInboundSourceChannel(null);
      this.toolExecutor?.setInboundSourceThreadId(null);
      this.toolExecutor?.setInboundSourceMessageId(null);
      this.toolExecutor?.setPermissionPromptHook(undefined);
      this.turnWebSearchPolicy = 'off';
      this.forcedWebSearchToolName = null;
      this.pendingVoiceMerge = null;
      this.toolExecutor?.setTurnAborted(false);
      this.toolExecutor?.setThirdPartyTurnPolicy(null);
      this.userCancelledTurn = false;
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
    await this.compactContext();

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
    let integrationAccessPolicy: ThirdPartyTurnPolicy | undefined;
    if (this.options.prepareIntegrationTools && lastUserText) {
      try {
        const prep = await this.options.prepareIntegrationTools(lastUserText);
        if (typeof prep === 'string') {
          integrationHint = prep;
        } else if (prep) {
          integrationHint = prep.hint;
          integrationAccessPolicy = prep.policy;
          this.toolExecutor?.setThirdPartyTurnPolicy(prep.policy ?? null);
        }
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
      async (instruction, toolsList, timeout, background) =>
        this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
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
    );

    if (this.options.promptProfile === 'crew_private') {
      const denyCrewOrchestration = new Set(['spawn_crew_workers', 'delegate_to_crew', 'crew_response']);
      for (const key of Object.keys(tools)) {
        if (denyCrewOrchestration.has(key)) delete tools[key];
      }
    }

    if (integrationHint !== undefined || integrationAccessPolicy !== undefined) {
      const reconciled = reconcileIntegrationHintWithActiveTools(
        integrationHint,
        integrationAccessPolicy,
        Object.keys(tools),
      );
      integrationHint = reconciled.hint;
      integrationAccessPolicy = reconciled.policy;
      this.toolExecutor?.setThirdPartyTurnPolicy(reconciled.policy ?? null);
    }

    const model = createAiSdkModel(this.config, this.getApiKey());

    let aiMessages = this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const toolCount = Object.keys(tools).length;
    const rebuildAiMessages = () => this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const budget = await this.ensureOutputBudget(aiMessages, tools, rebuildAiMessages);
    aiMessages = budget.messages;
    const turnMaxOutputTokens = budget.maxOutputTokens;

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
      this.pendingVoiceMerge ?? undefined,
    );
    this.activeStreamHandler = streamHandler;

    try {
      this.turnState.setStage('thinking');
      this.emit({ type: 'loading_start', stage: 'thinking' });

      // Log tool setup for debugging
      getLogger().info('AGENT', `Starting streamText with ${toolCount} tools, model: ${this.config.provider.activeModel}, maxOutputTokens: ${turnMaxOutputTokens}`);

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
        maxOutputTokens: turnMaxOutputTokens,
        stopWhen: ({ steps }) => steps.length >= stepLimit(),
        toolChoice: 'auto',
        ...(googleProviderOptions ? { providerOptions: googleProviderOptions } : {}),
        prepareStep: async ({ stepNumber, messages }) => {
          this.turnState.setStage('execution', stepNumber);
          const stepMessages = messages.map((m) => ({
            content: this.modelMessageContentToText(m.content),
          }));
          const stepEstimate = this.estimateTurnInputTokens(stepMessages, tools);
          try {
            resolveEffectiveMaxOutputTokens({
              configured: this.config.maxOutputTokens,
              contextWindow: this.getContextWindow(),
              estimatedInputTokens: stepEstimate,
              modelCaps: this.getActiveModelCaps(),
            });
          } catch (error) {
            getLogger().warn(
              'AGENT',
              `Context budget exceeded at step ${stepNumber} (~${stepEstimate} tokens) — stopping tool loop`,
            );
            if (stepNumber > 0) throw new Error('STEP_CAP_STOP');
            throw error;
          }
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
      let streamError: Error | null = null;
      try {
        for await (const chunk of result.fullStream) {
          streamHandler.handleEvent(chunk);
          if (chunk.type === 'text-delta') {
            this.partialTurnContent = streamHandler.getState().accumulatedContent;
          }
          if (chunk.type === 'finish') finishEmitted = true;
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        getLogger().warn('AGENT', `streamText failed: ${streamError.message}`);
        if (streamError.name === 'AbortError') {
          throw streamError;
        }
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
      if (this.pendingVoiceMerge) {
        const phase2Body = content.replace(/⟨voice⟩[\s\S]*?⟨\/voice⟩\s*/gi, '').trim();
        const prefix = this.pendingVoiceMerge.prefixContent.trim();
        content = phase2Body ? `${prefix}\n\n${phase2Body}` : prefix;
      }
      
      // ─── CRITICAL FIX: Populate tool execution log from stream handler ───
      const streamToolExecs = streamHandler.getState().toolExecutions;
      if (streamToolExecs && streamToolExecs.length > 0) {
        getLogger().info('AGENT', `Recovered ${streamToolExecs.length} tool executions from stream handler`);
        this.toolCallLogForReflection.push(...streamToolExecs.map(t => ({ name: t.tool, success: t.success, output: t.output, elapsed: t.elapsed })));
      }
      const toolExecs = this.toolCallLogForReflection.filter(t => t.success).length;
      getLogger().info('AGENT', `Total tool executions in turn: ${this.toolCallLogForReflection.length}, successful: ${toolExecs}`);

      // Generic self-healing: if response is essentially empty (whitespace or <3 chars),
      // or the tool loop crashed (e.g. malformed tool-call arguments), retry once.
      // When tools already ran, retry WITHOUT tools to force a plain-text summary.
      if (content.length < 3 || streamError) {
        const toolSummary = this.toolCallLogForReflection
          .map(t => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'} — ${t.output.slice(0, 300)}`)
          .join('\n');
        const worked = toolExecs > 0;
        const textOnlyRetry = worked || !!streamError;
        getLogger().warn(
          'AGENT',
          `Response too short (${content.length} chars, ${toolExecs} tools${streamError ? ', stream error' : ''}) — retrying${textOnlyRetry ? ' text-only' : ' with tools'}`,
        );
        try {
          const retryMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
            ...aiMessages,
            ...(worked ? [{ role: 'assistant' as const, content: text || '(executed tools)' }] : []),
            {
              role: 'user' as const,
              content: worked || streamError
                ? `[SYSTEM] You just ran these tools:\n${toolSummary || '(see prior tool activity)'}\n\nNow respond to the user based on these results. Do not call more tools. Be thorough and actionable.`
                : `[SYSTEM] The user said: "${aiMessages[aiMessages.length - 1]?.content?.slice(0, 500)}"\n\nUse the appropriate tools to answer. Prefer connected MCP integration tools when the request targets an external service — do not scan the local filesystem as a substitute. Do not return empty.`,
            },
          ];
          const retryResult = streamText({
            model: createAiSdkModel(this.config, this.getApiKey()),
            messages: retryMessages,
            ...(textOnlyRetry
              ? {}
              : {
                tools: createAiSdkTools(
                  this.toolRegistry!,
                  this.toolExecutor!,
                  this.sessionId,
                  (e) => this.emit(e),
                  async () => 'continue',
                  (instruction, toolsList, timeout, background) =>
                    this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                ),
                stopWhen: stepCountIs(50),
                toolChoice: 'auto' as const,
              }),
            maxRetries: 1,
            maxOutputTokens: turnMaxOutputTokens,
          });
          let retryText = '';
          for await (const chunk of retryResult.fullStream) { streamHandler.handleEvent(chunk); }
          retryText = (streamHandler.getState().accumulatedContent || '').trim();
          if (retryText) content = text.trim() ? text.trim() + '\n\n' + retryText : retryText;
        } catch (retryErr) {
          getLogger().warn(
            'AGENT',
            `Empty-response retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
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
      // Only push assistant content — tool ledger is persisted via persistToolLedger (not in agent history).
      this.messages.push({ role: 'assistant', content });
      await this.compactContext();
      await this.reinforceMemoryContext();

      return this.tagCrewPrivateAssistant({
        id: this.pendingVoiceMerge?.messageId ?? generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant' as const,
        content,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      });
    } catch (error) {
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
      if (error instanceof Error && (error.name === 'NoOutputGeneratedError' || error.message.includes('No output generated'))) {
        const toolSummary = this.toolCallLogForReflection
          .map((t) => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'}`)
          .join('\n');
        const partial = this.partialTurnContent.trim();
        const content = partial
          || (toolSummary
            ? `I ran tools but could not finish a reply:\n${toolSummary}\n\nSend *continue* to resume.`
            : 'I could not generate a reply for that request. Send *continue* or try again.');
        const recoveryMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content,
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        emit({ type: 'message_received', message: recoveryMessage, elapsed: Date.now() - startTime });
        return recoveryMessage;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      getLogger().error('COMPLETION', `AI SDK streamText failed: ${errorMsg}`);
      this.emit({ type: 'error', code: 'AI_SDK_ERROR', message: errorMsg, recoverable: false });
      throw error;
    } finally {
      this.activeStreamHandler = null;
      this.toolExecutor?.setThirdPartyTurnPolicy(null);
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
    extractMemoriesHelper(
      {
        config: this.config,
        provider: this.provider,
        memoryExtractor: this.memoryExtractor,
        setMemoryExtractor: (e) => { this.memoryExtractor = e; },
        secretSauce: this.secretSauce,
        memoryFabric: this.memoryFabric,
        memoryEmbedder: this.memoryEmbedder,
        chatTurnMemoryIngester: this.chatTurnMemoryIngester,
        setChatTurnMemoryIngester: (i) => { this.chatTurnMemoryIngester = i; },
        userChatMemoryIngester: this.userChatMemoryIngester,
        setUserChatMemoryIngester: (i) => { this.userChatMemoryIngester = i; },
        sessionId: this.sessionId,
        options: this.options,
      } as MemoryExtractionContext,
      userMessage,
      assistantResponse,
    );
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
    return buildIdentityBlockHelper(
      {
        secretSauce: this.secretSauce,
        persona: this.persona,
        options: this.options,
      } as IdentityContext,
    );
  }

  setClientSituation(situation: ClientSituation | null): void {
    this.clientSituation = situation;
  }

  applyPersona(persona: AgentPersonaConfig | null): void {
    this.persona = persona;
    if (persona) {
      this.secretSauce.identity.seedFromPersona(persona);
    }
    this.rebuildSystemPrompt();
  }

  getPersona(): AgentPersonaConfig | null {
    return this.persona;
  }

  private createSectionContext(): SectionContext {
    return {
      getProviderId: () => this.config.provider.activeProvider,
      getModelId: () => this.config.provider.activeModel,
      buildIdentityBlock: () => this.buildIdentityBlock(),
      scopePath: this.scopePath,
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
      getPersona: () => this.persona,
      getClientSituation: () => this.clientSituation,
      linkedContextBlock: () => this.buildLinkedContextPromptBlock(),
    };
  }

  private buildLinkedContextPromptBlock(): string | null {
    return buildLinkedContextPromptBlockHelper(
      {
        options: this.options,
        linkedContextSessionId: this.linkedContextSessionId,
        sessionManager: this.sessionManager,
      } as LinkedContextContext,
    );
  }

  private registerPromptSections(systemOverride?: string): void {
    registerPromptSectionsHelper(
      {
        promptAssembly: this.promptAssembly,
        options: this.options,
        usesCompactContext: () => this.usesCompactContext(),
        createSectionContext: () => this.createSectionContext(),
      },
      systemOverride,
    );
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
    switchModelHelper(
      {
        usesCompactContext: () => this.usesCompactContext(),
        config: this.config,
        cachedModelInfo: this.cachedModelInfo,
        tokenTracker: this.tokenTracker,
        setPromptEngine: (ctx) => { this.promptEngine = new PromptEngine(ctx); },
        sessionManager: this.sessionManager,
        sessionId: this.sessionId,
        rebuildPromptAssembly: () => this.rebuildPromptAssembly(),
        syncSessionRuntimeRecord: (patch) => this.syncSessionRuntimeRecord(patch),
        emit: (event) => this.emit(event),
        _capabilityWarningEmitted: this._capabilityWarningEmitted,
        setCapabilityWarningEmitted: (v) => { this._capabilityWarningEmitted = v; },
      } as SwitchModelContext,
      modelId,
      contextWindow,
    );
  }

  private syncSessionRuntimeRecord(patch: {
    providerId?: string;
    modelId?: string;
  }): void {
    try {
      this.sessionManager?.syncActiveSessionRuntime?.(patch);
    } catch { /* best-effort */ }
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
    return detectTaskTypeHelper(content);
  }

  /**
   * Trial a model with a minimal API call BEFORE committing it.
   * Returns true if the model works, false if it's grounded.
   */
  async trialModel(modelId: string): Promise<boolean> {
    return trialModelHelper(
      {
        cachedModelInfo: this.cachedModelInfo,
        groundedModels: this.groundedModels,
        provider: this.provider,
        config: this.config,
        emit: (event) => this.emit(event),
      } as ModelTrialContext,
      modelId,
    );
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
    return listModelsHelper(
      {
        cachedModelInfo: this.cachedModelInfo,
        provider: this.provider,
        config: this.config,
        emit: (event) => this.emit(event),
      } as ModelListContext,
    );
  }

  /** Re-attach interactive permission prompts after an ephemeral automation run. */
  bindPermissionHandler(): void {
    bindPermissionHandlerHelper(this._permissionCtx());
  }

  /**
   * Grant tools a scheduled automation will need without prompting.
   * Permissions are persisted so the worker can run without interactive prompts.
   */
  async ensureAutomationToolsApproved(
    toolIds: string[],
  ): Promise<{ ok: boolean; denied?: string[]; error?: string }> {
    return ensureAutomationToolsApprovedHelper(this._permissionCtx(), toolIds);
  }

  /** Show automation notification channel questionnaire in chat. */
  async promptAutomationNotifyChannels(questionnaire: QuestionnairePayload): Promise<string> {
    return this.waitForQuestionnaireResponse(questionnaire);
  }

  /** Grant notify tool permissions without prompting (automation channel selection). */
  grantAutomationNotifyTools(toolIds: string[]): void {
    grantAutomationNotifyToolsHelper(this._permissionCtx(), toolIds);
  }

  /**
   * Respond to a pending permission request from the tool executor.
   */
  respondToPermission(requestId: string, choice: 'allow_once' | 'allow_always' | 'deny'): void {
    this.resolvePermissionRequest(requestId, choice);
  }

  respondToPermissionInstruction(requestId: string, instruction: string): void {
    const text = instruction.trim();
    if (!text) return;
    this.resolvePermissionRequest(requestId, { type: 'instruct', instruction: text });
  }

  private resolvePermissionRequest(requestId: string, result: PermissionHandlerResult): void {
    resolvePermissionRequestHelper(this._permissionCtx(), requestId, result);
  }

  /**
   * Approve or deny all pending permission requests at once.
   */
  respondToPermissionBatch(choice: 'allow_once' | 'allow_always' | 'deny'): void {
    respondToPermissionBatchHelper(this._permissionCtx(), choice);
  }

  /** Persist Telegram (or other channel) permission decisions from inline buttons. */
  recordToolPermissionDecision(toolName: string, decision: PermissionDecision): void {
    recordToolPermissionDecisionHelper(this._permissionCtx(), toolName, decision);
  }

  formatChannelToolPermissions(): string {
    return formatChannelToolPermissionsHelper(this.persistenceCtx());
  }

  revokeChannelToolPermissions(tools?: string[], revokeAll = false): string {
    return revokeChannelToolPermissionsHelper(this.persistenceCtx(), tools, revokeAll);
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
    this.scope = new Scope();
    this.messages.push({ role: 'user', content: `/research ${question}` });
    this.turnApprovedAll = false;
    const result = await researchHelper(
      {
        sessionId: this.sessionId,
        emit: (event) => this.emit(event),
        researchEngineCapability: this.researchEngineCapability,
        agent: this,
        sessionLogger: this.sessionLogger,
        lifecycle: this.lifecycle,
      } as ResearchContext,
      question,
    );
    this.messages.push({ role: 'assistant', content: result.content });
    this.scope = null;
    return result as Message;
  }

  /**
   * End the session — records diary entry and updates identity.
   */
  endSession(): void {
    endSessionHelper(this._sessionLifecycleCtx());
  }

  /**
   * Run background summarization of memories and diary.
   * Non-blocking — failures are silently ignored.
   */
  private async runSummarization(): Promise<void> {
    return runSummarizationHelper(this._sessionLifecycleCtx());
  }

  private _sessionLifecycleCtx(): SessionLifecycleContext {
    return {
      contextTracker: this.contextTracker,
      secretSauce: this.secretSauce,
      messages: this.messages,
      simpleComplete: (prompt) => this.simpleComplete(prompt),
    };
  }

  /**
   * Simple non-streaming completion for internal tasks (summarization, memory extraction).
   */
  private async simpleComplete(prompt: string): Promise<string> {
    return simpleCompleteHelper(
      { provider: this.provider, config: this.config } as SimpleCompleteContext,
      prompt,
    );
  }

  /**
   * Decompose a complex task into subtasks and delegate to specialist sub-agents in parallel.
   */
  async decomposeAndDelegate(task: string): Promise<{
    subResults: Array<{ specialist: SpecialistType; output: string; elapsed: number }>;
    synthesized: string;
    totalElapsed: number;
  }> {
    return decomposeAndDelegateHelper(
      {
        emit: (event) => this.emit(event),
        provider: this.provider,
        config: this.config,
        subAgents: this.subAgents,
        maxSubAgents: this.maxSubAgents,
        specialistRegistry: this.specialistRegistry,
        agentBus: this.agentBus,
        sessionId: this.sessionId,
      } as DecomposeContext,
      task,
    );
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
  /** Exposed for vitals/diagnostics — returns the experience engine if initialized. */
  get experienceEngineInstance(): ExperienceEngine | null { return this._experienceEngine; }
  /** Exposed for vitals/diagnostics — returns the growth engine if initialized. */
  get growthEngineInstance(): GrowthEngine | null { return this._growthEngine; }
  /** Exposed for vitals/diagnostics — returns the pending checkpoint if any. */
  get pendingCheckpoint(): { resolve: (action: unknown) => void; reject: (err: Error) => void; checkpointId: string } | null { return this._pendingCheckpoint; }

  // Store the last compaction summary for iterative updates
  private lastCompactionSummary: string | null = null;

  /** Public wrapper for compactContext — used by TaskExecutor for adaptive context compaction. */
  async compactContextNow(): Promise<boolean> {
    return this.compactContext();
  }

  private async compactContext(promptEstimate?: number): Promise<boolean> {
    return compactContextHelper(
      {
        getContextWindow: () => this.getContextWindow(),
        tokenTracker: this.tokenTracker,
        compactionMarkerIndices: this.compactionMarkerIndices,
        messages: this.messages,
        emit: (event) => this.emit(event),
        lastCompactionSummary: this.lastCompactionSummary,
        setLastCompactionSummary: (s) => { this.lastCompactionSummary = s; },
        simpleComplete: (prompt) => this.simpleComplete(prompt),
        setMessages: (msgs) => { this.messages = msgs as never; },
        setCompactionMarkerIndices: (indices) => { this.compactionMarkerIndices = indices; },
        _compactionCount: this._compactionCount,
        setCompactionCount: (n) => { this._compactionCount = n; },
        sessionManager: this.sessionManager,
        sessionId: this.sessionId,
      } as CompactContext,
      promptEstimate,
    );
  }

  private buildAiMessagesForTurn(opts: {
    lastUserText: string;
    compact: boolean;
    integrationHint?: string;
  }): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const aiMessages = buildCompletionMessages(
      this.messages.map((m) => ({
        role: m.role,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
      })),
      opts.compact,
      3,
      this.config.provider.activeProvider,
    ).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    if (this.pendingInstruction) {
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${userMsg.content}\n\n[INSTRUCTION]\n${this.pendingInstruction}\n[/INSTRUCTION]` };
      }
      this.pendingInstruction = null;
    }

    const turnCtx = this.prepareTurnContext(opts.lastUserText);
    if (turnCtx.block) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[TURN CONTEXT]')) {
        aiMessages[userIdx] = { role: 'user', content: `${turnCtx.block}\n\n${userMsg.content}` };
      }
    }

    if (this.clientSituation) {
      const situationBlock = formatClientSituationBlock(this.clientSituation);
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[CLIENT_SITUATION]')) {
        aiMessages[userIdx] = { role: 'user', content: `${situationBlock}\n\n${userMsg.content}` };
      }
    }

    if (opts.integrationHint) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[INTEGRATION')) {
        aiMessages[userIdx] = { role: 'user', content: `${opts.integrationHint}\n\n${userMsg.content}` };
      }
    }

    if (!opts.compact && this.lastRagResults.length > 0) {
      const ragCtx = this.promptEngine.buildRagContext(this.lastRagResults);
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${ragCtx}\n\n${userMsg.content}` };
      }
    }

    return aiMessages;
  }

  /** Compact history when needed and ensure the prompt leaves room for model output. */
  private async ensureOutputBudget(
    aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    tools: Record<string, unknown>,
    rebuild: () => Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  ): Promise<{ messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; maxOutputTokens: number }> {
    const contextWindow = this.getContextWindow();
    const modelCaps = this.getActiveModelCaps();
    let messages = aiMessages;
    for (let attempt = 0; attempt < 3; attempt++) {
      const estimatedInput = this.estimateTurnInputTokens(messages, tools);
      try {
        const maxOutputTokens = resolveEffectiveMaxOutputTokens({
          configured: this.config.maxOutputTokens,
          contextWindow,
          estimatedInputTokens: estimatedInput,
          modelCaps,
        });
        getLogger().info(
          'AGENT',
          `Prompt budget: ~${estimatedInput} input / ${contextWindow} window → maxOutput=${maxOutputTokens}`,
        );
        return { messages, maxOutputTokens };
      } catch (error) {
        if (!(error instanceof ContextBudgetExceededError) || attempt >= 2) throw error;
        getLogger().warn('AGENT', `Prompt too large (~${estimatedInput} tokens) — compacting before LLM call`);
        const compacted = await this.compactContext(estimatedInput);
        if (!compacted) throw error;
        messages = rebuild();
      }
    }
    throw new ContextBudgetExceededError(this.estimateTurnInputTokens(messages, tools), contextWindow);
  }

  private modelMessageContentToText(content: unknown): string {
    return modelMessageContentToTextHelper(content);
  }

  private estimateToolSchemaChars(tools: Record<string, unknown>): number {
    return estimateToolSchemaCharsHelper(tools);
  }

  private estimateTurnInputTokens(
    messages: Array<{ content: string }>,
    tools: Record<string, unknown>,
  ): number {
    return estimatePromptTokens(
      messages,
      Object.keys(tools).length,
      this.estimateToolSchemaChars(tools),
    );
  }

  private tagCrewPrivateAssistant(msg: Message): Message {
    return tagCrewPrivateAssistantHelper(
      { options: this.options } as CrewPrivateContext,
      msg,
    );
  }

  public emit(event: EngineEvent, isUpdateFlag?: boolean): void {
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
      // Persist assistant rows from the Agent (like user turns) so DB writes don't depend solely on WS subscribers.
      if (crewMsg?.role === 'assistant' && crewMsg.content?.trim()) {
        this.persistAssistantMessage(crewMsg);
      }
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

  public persistAssistantMessage(msg: Message): void {
    return persistAssistantMessageHelper(this.persistenceCtx(), msg);
  }

  /** Persist user turn to the session store (DB) — independent of WS subscribers. */
  private persistUserMessage(msg: Message): void {
    return persistUserMessageHelper(this.persistenceCtx(), msg);
  }

  public getApiKey(): string | undefined {
    return getProviderCredentialsHelper(this._providerCredentialsCtx()).apiKey;
  }

  private getBaseUrl(): string | undefined {
    return getProviderCredentialsHelper(this._providerCredentialsCtx()).baseUrl;
  }

  private _providerCredentialsCtx(): ProviderCredentialsContext {
    return { config: this.config } as ProviderCredentialsContext;
  }

  /**
   * Get the user's timezone from config, falling back to system timezone.
   */
  private getUserTimezone(): string {
    return getUserTimezoneHelper(this._timezoneCtx());
  }

  /**
   * Get the UTC offset string for the user's timezone (e.g. "+05:30", "-04:00").
   */
  private getUtcOffset(): string {
    return getUtcOffsetHelper(this._timezoneCtx());
  }

  private _timezoneCtx(): TimezoneContext {
    return { clientSituation: this.clientSituation, config: this.config } as TimezoneContext;
  }

  public getActiveModelCaps(): {
    hasReasoning: boolean;
    contextWindow?: number;
    outputTokenLimit?: number;
  } {
    return getActiveModelCapsHelper(
      { cachedModelInfo: this.cachedModelInfo, config: this.config } as ModelCapsContext,
    );
  }

  public getContextWindow(): number {
    return getContextWindowHelper(
      { config: this.config, cachedModelInfo: this.cachedModelInfo, tokenTracker: this.tokenTracker } as ContextWindowContext,
    );
  }

  private toFriendlyError(error: unknown): { message: string; actions: RemediationAction[] } {
    return toFriendlyErrorHelper(error);
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

  public async superviseCrewMission(
    mission: CrewMissionResult,
    cleanContent: string,
    startTime: number,
  ): Promise<string> {
    return superviseCrewMissionHelper(this, mission, cleanContent, startTime);
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
      });
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
      const store = this.getPersistStore();
      const catalogStore = (store?.getCrewCatalogStore?.() as CrewCatalogRecruitStore | null) ?? null;
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
    return publishCrewMissionResponsesHelper(this, mission, members, startTime);
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
    return executeCrewMissionHelper(this, members, cleanContent, startTime, _classificationContext);
  }

  /**
   * Auto-delegation: before Agent-X responds, check if any enabled crew
   * member's expertise matches the user message.
   * Uses LLM-powered semantic matching (scalable to any domain).
   */
  private extractTasksFromResponse(content: string): void {
    return extractTasksFromResponseHelper(this, content);
  }

  getMaxSubAgents(): number {
    return this.maxSubAgents;
  }

  setMaxSubAgents(limit: number): void {
    this.maxSubAgents = Math.max(1, Math.min(32, limit));
    this.subAgents.setMaxConcurrent(this.maxSubAgents);
  }

  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm;
    this.sessionPermissionStore = new SessionPermissionStore(this.sessionId);
    this.restoreSessionPermissions();
    this.subAgents.ingestBackgroundResultsForSession(this.sessionId);
    if (this.options.channelSession) {
      registerChannelPermissionBridge(this.sessionId, {
        list: () => this.formatChannelToolPermissions(),
        revoke: (tools, revokeAll) => this.revokeChannelToolPermissions(tools, revokeAll),
      });
    }
  }

  private persistPermissionGrant(toolName: string, decision: PermissionDecision): void {
    return persistPermissionGrantHelper(this.persistenceCtx(), toolName, decision);
  }

  private restoreSessionPermissions(): void {
    return restoreSessionPermissionsHelper(this.persistenceCtx());
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
    return detectAtMentionsHelper(this, content);
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

export { Agent as AgentFacade };
