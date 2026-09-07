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
  ThinkingMode,
  OutputMode,
  AdoptionAgentMessage,
} from '@agentx/shared';
import { FailoverReason, generateMessageId, getLogger, type ChannelKind, getConfigDir, formatClientSituationBlock, isMessagingChannel, formatQuestionnaireForMessagingChannel, shouldUseQuestionnaireClarification, type PermissionHandlerResult, type PermissionOutcomeRecord, parseChannelBindingFromSessionId, allowsCrewInvolvement, crewParticipationMode, deniesAutonomousCrewTools, THINKING_MODE_TOOL_BUDGET, THINKING_MODE_REASONING_EFFORT, THINKING_MODE_SKIP_RETRIEVAL, THINKING_MODE_SKIP_REFORMULATE, THINKING_MODE_SKIP_EXTRACT_MEMORIES, THINKING_MODE_ALLOW_DEEP_SEARCH, DEFAULT_THINKING_MODE, DEFAULT_OUTPUT_MODE, isValidThinkingMode, isValidOutputMode, isInterAgentMessagingEnabled, isSubagentAdmissionEnabled } from '@agentx/shared';
import { summarizeToolAction, type PermissionOutcomeEmit } from '../services/tool/ToolPermissionService.js';
import { Scope } from '../concurrency/Scope.js';
import { getAttachmentService } from '../attachments/index.js';
import { materializeAttachment, cleanupDocumentTemps } from '../documents/DocumentPipeline.js';
import { join, resolve, normalize } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

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
import { getAgentProcessRegistry } from '../tools/AgentProcessRegistry.js';
import { EngineeringCrew, type EngineeringCrewResult, type SessionContext } from '../engineering-crew/EngineeringCrew.js';
import { SubAgentManagerSpawner } from '../engineering-crew/SubAgentSpawner.js';
import { routeCodingTask, type RouterDecision, type RouterContext, type LLMIntentClassifier } from '../engineering-crew/CodingTaskRouter.js';
import { EngineeringCrewStore } from '../engineering-crew/EngineeringCrewStore.js';
import { setCrewDelegator } from '../tools/builtin/delegate-to-crew.js';
import { setCrewHubSearcher } from '../tools/builtin/search-crew-hub.js';
import { buildCrewRosterHintBlock } from '../crew/crew-roster-hint.js';
import { createCrewKeywordExpander } from '../crew/crew-keyword-expander.js';
import { getCrewSuggestionService } from '../crew/get-crew-store.js';
import {
  ensureCrewMembersOnRoster,
  resolveMentionedCrewMembers,
  type CrewCatalogRecruitStore,
} from '../crew/crew-mission-deploy.js';
import {
  buildCrewDeploymentIntakeQuestionnaire,
  needsCrewDeploymentIntake,
} from '../crew/crew-deployment-intake.js';
import { buildCrewSuggestionSearchQuery } from './crew-auto-compose.js';
import { scoreMatchCandidates, type RawMatchRow } from '../crew/CrewMatchService.js';
import { setToolRegistryInstance } from '../commands/builtin/tools.js';
import { CrewManager } from '../crew/CrewManager.js';
import { MemoryFabric, setMemoryFabricInstance, getMemoryFabricInstance } from '../neural/MemoryFabric.js';
import { OnnxEmbeddingProvider, setEmbedderInstance, getEmbedderInstance } from '../neural/OnnxEmbeddingProvider.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import type { EmbeddingProvider } from '@agentx/shared';
import { PromptAssembly, type SourceSnapshot, buildClarificationPolicyInstruction, type SectionContext } from '../prompt/assembly/index.js';
import { registerChannelPermissionBridge } from '../channels/channel-permission-bridge.js';

import {
  buildCompletionMessages,
  isCompactContextProfile,
} from './context-profile.js';
import { ErrorShield } from './ErrorShield.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import { registerPerformanceTuneTarget } from '../performance/PerformanceGovernor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { createDefaultToolkit } from '../tools/toolkit.js';
import { createDefaultRegistry } from '../commands/index.js';
import { getHarnessService } from '../harness/HarnessService.js';
import { reviewAutoRefine, trackTurnForAutoRefine } from '../harness/auto-refine.js';
import { getGoalService } from '../goal/GoalService.js';
import { maybeSyncGoalFromUserPrompt } from '../goal/goal-from-prompt.js';
import { applyAdoptionTurnPolicy, clearAdoptionTurnPolicy } from '../adoption/adoption-turn-policy.js';
import { CLARIFICATION_AWAITING_USER } from './ClarificationTurnPause.js';
import { getExecutableSkillRegistry } from '../executable-skills/ExecutableSkillRegistry.js';
import { getRuntimeCapabilityManager } from '../synthetic/RuntimeCapabilityManager.js';
import { getDurableTurnStore } from '../durable-turn/DurableTurnStore.js';
import { getSessionGenerationManager } from '../session-generation/SessionGenerationManager.js';
import { isEngineShuttingDown } from '../runtime/ShutdownGate.js';
import { SessionAlreadyActiveError } from '../session-lease/errors.js';
import { CompactionFileTracker } from './CompactionFileTracker.js';
import { registerCompactionFileTracker, unregisterCompactionFileTracker } from './CompactionFileTrackerAccess.js';
import { GitManager } from '../session/GitManager.js';
import { BackgroundQueue } from '../session/BackgroundQueue.js';
import { FileWatcher } from '../session/FileWatcher.js';
import { ModelRouter } from '../session/ModelRouter.js';
import type { TaskType } from '../session/ModelRouter.js';
import { setBackgroundQueueInstance } from '../commands/builtin/tasks.js';
import { setRecipeEngineInstance } from '../commands/builtin/recipe.js';
import type { VoiceSessionSpeaker } from '../voice/VoiceSession.js';
import { RecipeEngine } from '../session/RecipeEngine.js';
import { setUserCommandRegistryInstance } from '../commands/builtin/commands.js';
import { getRAGEngineInstance, setIndexerEventBus } from '../commands/builtin/rag_index.js';
import type { UserCommandConfig } from '../commands/UserCommandRegistry.js';
import { UserCommandRegistry } from '../commands/UserCommandRegistry.js';
import { buildRagContext } from '../prompt/PromptEngine.js';
import { CategoryDetector, deriveReasoningMode, type CategoryResult } from '../prompt/CategoryDetector.js';
import { CodebaseContextDetector, type CodebaseContext } from '../prompt/CodebaseContextDetector.js';
import { CodingTurnGuard } from './CodingTurnGuard.js';
import { TaskStateManager } from './TaskStateManager.js';
import { TurnFeedbackLogger, type TurnOutcome } from './TurnFeedbackLogger.js';
import { CACHE_BOUNDARY_MARKER } from '../communication/prompt/PromptComposer.js';
import { DecisionEngine } from './DecisionEngine.js';
import type { DecisionResult } from './DecisionEngine.js';
import { profileRequest } from './request-profile.js';
import { parseKbMentionSourceIds, runTurnJourney } from './TurnJourney.js';
import { buildMentionContextBlock, messageTextFromRow } from './mention-context.js';
import { getArticleStoreInstance } from '../articles/ArticleStore.js';
import type { KbDocumentTurnPolicy } from '../knowledge-base/kb-document-access-guard.js';
import { AgentBus, getAgentBus } from './AgentBus.js';
import { SteerMessageHandler } from './SteerMessageHandler.js';
import {
  deliverInterAgentMessage,
  processPendingInterAgentMessages,
  type InterAgentDeliveryContext,
} from '../inter-agent-messaging/InterAgentMessageDelivery.js';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';
import { SpecialistRegistry } from './SpecialistRegistry.js';
import type { SpecialistType } from './SpecialistRegistry.js';
import { ReflectionLoop } from './ReflectionLoop.js';
import { TreeOfThoughts } from '../reasoning/TreeOfThoughts.js';
import { ResearchEngine } from '../reasoning/ResearchEngine.js';
import { CrewOrchestrator, buildCrewPrivateFastReplyPrompt, type CrewMember } from './CrewOrchestrator.js';
import {
  crewDelegationMatchesTask,
  isGeneralKnowledgeQuery,
} from './crew-auto-compose.js';
import { CrewMissionOrchestrator, type CrewMissionOptions, type CrewMissionResult } from './CrewMissionOrchestrator.js';
import { setCrewMissionDeps } from '../tools/builtin/spawn-crew-workers.js';
import { setCustomCrewCreateAgent } from '../tools/builtin/create-custom-crew.js';
import { isMissionInProgress } from './crew-mission-registry.js';
import { evaluateCrewDelegation } from './crew-delegation-guard.js';
import { ContextTracker } from './ContextTracker.js';
import { TurnFeedbackService } from '../feedback/TurnFeedbackService.js';
import { AutonomousDiagnosticsSystem } from './AutonomousDiagnosticsSystem.js';

import { TodoManager } from './TodoManager.js';
import {
  MAX_COMPLETION_CONTINUATIONS,
  buildCompletionContinuationPrompt,
  buildIncompleteTurnFooter,
  evaluateTurnCompletionGate,
  getIncompleteTodos,
} from './TurnCompletionGate.js';
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
import { withSpan } from '../observability/tracer.js';
import { reconcileIntegrationHintWithActiveTools } from '../integrations/integration-tool-availability.js';
import type { ThirdPartyTurnPolicy } from '../integrations/third-party-access.js';
import { buildGoogleAiSdkProviderOptions } from '../providers/google/gemini-metadata.js';
import { buildCommandCodeAiSdkProviderOptions } from '../providers/commandcode/commandcode-metadata.js';
import { createAiSdkStreamHandler, consumeStreamWithWatchdog, STREAM_IDLE_TIMEOUT_MS } from './AiSdkStreamHandler.js';
import type { PartPersistFn } from './AiSdkStreamHandler.js';
import { applyRichResponsePolicy } from './rich-response-policy.js';
import {
  applyInstructedActionConsent,
  detectsExplicitDeliverableRequest,
  detectsSessionProactiveConsentWaiver,
} from '../services/tool/proactive-deliverable-consent.js';
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
import { getLoadingSteps, generateDiff, modelMessageContentToText as modelMessageContentToTextHelper, estimateToolSchemaChars as estimateToolSchemaCharsHelper, toFriendlyError as toFriendlyErrorHelper, detectTaskType as detectTaskTypeHelper, checkConnectivity as checkConnectivityHelper, buildIdentityBlock as buildIdentityBlockHelper, simpleComplete as simpleCompleteHelper, endSession as endSessionHelper, getHealth as getHealthHelper, initializeDiagnosticsAsync as initializeDiagnosticsAsyncHelper, research as researchHelper, compactContext as compactContextHelper, findLatestCompactionFileSet, tagCrewPrivateAssistant as tagCrewPrivateAssistantHelper, buildLinkedContextPromptBlock as buildLinkedContextPromptBlockHelper, getProviderCredentials as getProviderCredentialsHelper, getProviderFactoryOptions as getProviderFactoryOptionsHelper, getUserTimezone as getUserTimezoneHelper, getUtcOffset as getUtcOffsetHelper, type ConnectivityContext, type SimpleCompleteContext, type SessionLifecycleContext, type HealthContext, type DiagnosticsContext, type ResearchContext, type CompactContext, type CrewPrivateContext, type LinkedContextContext, type ProviderCredentialsContext, type TimezoneContext } from './agent-helpers.js';

import {
  superviseCrewMission as superviseCrewMissionHelper,
  publishCrewMissionResponses as publishCrewMissionResponsesHelper,
  executeCrewMission as executeCrewMissionHelper,
  extractTasksFromResponse as extractTasksFromResponseHelper,
  parseCrewMentionKeys,
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
  persistSessionToolFindings as persistSessionToolFindingsHelper,
  reformulateQuery as reformulateQueryHelper,
  buildMemoryContext as buildMemoryContextHelper,
  type MemoryExtractionContext,
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
  /** Skip the empty-response self-healing retry for benchmark/headless callers. */
  skipEmptyResponseRetry?: boolean;
  /** Thinking mode for this turn — controls tool budget, reasoning depth, retrieval. */
  thinkingMode?: import('@agentx/shared').ThinkingMode;
  /** Output mode for this turn — controls response verbosity and format. */
  outputMode?: import('@agentx/shared').OutputMode;
  /** Lease owner namespace (e.g. `ui:web`, `channel:telegram`) for session lease attribution. */
  leaseOwnerNamespace?: string;
}

/** Parse Yes/No from clarify-first questionnaire answers (`Shall I …?: Yes`). */
function isAffirmativeConsentAnswer(answer: string): boolean {
  const raw = (answer ?? '').trim();
  if (!raw || raw === '(skipped)') return false;
  const afterColon = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1).trim() : raw;
  const v = afterColon.toLowerCase();
  if (/^(no|nope|nah|cancel|deny|decline)\b/.test(v)) return false;
  return /^(yes|yeah|yep|y|sure|ok|okay|go ahead|proceed|do it|allow|approve)\b/.test(v);
}

/** Telegram/Discord numeric ids only. WhatsApp ids are alphanumeric and must not become NaN. */
function toNullableBigintId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
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
  /** User choice when starting a turn with leftover incomplete TASKS. */
  private todoDispositionThisTurn: 'continue' | 'skip' | 'defer' | null = null;
  private goalContinuationThisTurn = false;
  private durableTurnFailedThisTurn = false;
  private pendingVoiceMerge: { messageId: string; prefixContent: string } | null = null;
  private pendingDelegateCrewIds: string[] | null = null;
  private turnWebSearchPolicy: WebSearchTurnPolicy = 'off';
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  public todoManager: TodoManager;
  private _crewManager: CrewManager | null = null;
  private get crewManager(): CrewManager {
    if (!this._crewManager) {
      this._crewManager = new CrewManager();
    }
    return this._crewManager;
  }
  private userChatMemoryIngester: UserChatMemoryIngester | null = null;
  private chatTurnMemoryIngester: ChatTurnMemoryIngester | null = null;
  private sessionFindingsIngester: import('../neural/SessionFindingsIngester.js').SessionFindingsIngester | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: EnhancedToolExecutor;
  private toolRegistry?: ToolRegistry;
  private pendingPermissions = new Map<string, { resolve: (choice: PermissionHandlerResult) => void; toolName: string; path: string; riskLevel: string }>();
  private permissionQueue: Array<{ toolId: string; path: string; riskLevel: string; context?: { args?: unknown; integrationPreview?: string }; resolve: (value: PermissionHandlerResult) => void }> | undefined;
  private activePermissionId: string | null = null;
  private processPermissionQueueFn: ((choice?: PermissionHandlerResult) => void) | undefined;
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
  private decisionEngine: DecisionEngine;
  private categoryDetector: CategoryDetector;
  private currentDecision: DecisionResult | null = null;
  private currentCategory: CategoryResult | null = null;
  private currentUserMessage = '';
  private currentSpeaker: VoiceSessionSpeaker | null = null;
  private currentVoiceTurn = false;
  private currentThinkingMode: ThinkingMode = 'medium';
  private currentOutputMode: OutputMode = 'moderate';

  private logTurnOutcome(startTime: number, success: boolean, _userMessage: string): void {
    const taskState = this.taskStateManager.getCurrent();
    if (!taskState) return;
    const toolPolicy = this.getToolPolicy();
    const outcome: TurnOutcome = {
      sessionId: this.sessionId,
      turnId: `turn-${startTime}`,
      category: taskState.category,
      sub: taskState.sub,
      phase: taskState.phase,
      toolChoice: toolPolicy.choice,
      allowedTools: toolPolicy.allowedIds,
      stepCap: toolPolicy.stepCap,
      toolsUsed: taskState.toolsUsed,
      toolCallCount: this.toolLedger.getEntries().length,
      filesRead: taskState.filesRead.length,
      filesWritten: taskState.filesWritten.length,
      buildsRun: taskState.buildsRun,
      buildsPassed: taskState.buildsPassed,
      buildsFailed: taskState.buildsFailed,
      testsRun: taskState.testsRun,
      testsPassed: taskState.testsPassed,
      testsFailed: taskState.testsFailed,
      success,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
    this.turnFeedbackLogger.log(outcome);
  }

  private getToolPolicy(): { choice: 'auto' | 'none' | 'required'; allowedIds: string[] | undefined; stepCap: number } {
    if (!this.toolRegistry) {
      return { choice: 'auto', allowedIds: undefined, stepCap: 50 };
    }

    const primary = this.currentCategory?.primary ?? 'general';
    const sub = this.currentCategory?.sub;

    // Feedback-driven adjustments are evaluated for telemetry but no longer
    // override tool policy — all tools are always available.
    void this.turnFeedbackLogger?.getAutoAppliedAdjustment(primary, sub);
    void this.turnFeedbackLogger?.getSuggestedAdjustments();

    // ─── Tool Policy ───
    // The MoE category overlay guides the model's BEHAVIOR via prompt instructions.
    // It does NOT restrict which tools are available. Tool restriction caused
    // catastrophic failures: models couldn't find file_write and substituted with
    // web_search loops (96 useless searches for "save_to_article" as a web query).
    //
    // ALL tools are available to ALL categories. The category overlay in the system
    // prompt tells the model which tools to prefer. The model decides.
    //
    // stepCap is a safety net against infinite loops, not a task limiter.
    // 40 steps is enough for complex multi-tool tasks (search → read → write → verify)
    // while preventing the 52-96 iteration search loops seen in failing sessions.
    // ─── Turn mode: thinking mode enforces a tool call budget ───
    // light = 3 tool calls, medium = ~50% of available tools, high = unlimited (40 safety net).
    const modeToolBudget = THINKING_MODE_TOOL_BUDGET[this.currentThinkingMode];
    let stepCap: number;
    if (modeToolBudget === -1) {
      // 50% of available tools (computed at runtime, minimum 5)
      const toolCount = this.toolExecutor?.getRegistry()?.list().length ?? 20;
      stepCap = Math.max(5, Math.floor(toolCount / 2));
    } else if (modeToolBudget > 0) {
      stepCap = modeToolBudget;
    } else {
      stepCap = 40; // unlimited safety net
    }

    // If the user explicitly asks to open/browse a URL in a browser, force the
    // model to call a tool (browser_open/web_browse) instead of replying with
    // just text or internal reasoning. This fixes cases where cheap/reasoning
    // models emit long "plans" but never actually invoke the browser tools.
    const user = this.currentUserMessage.toLowerCase();
    const wantsBrowser = /\b(open|browse)\b.+\b(in a browser|in the browser|in browser)\b/.test(user) ||
      /\b(open|browse)\b.+\b(browser)\b/.test(user);

    const result: { choice: 'auto' | 'none' | 'required'; allowedIds: string[] | undefined; stepCap: number } = {
      choice: wantsBrowser ? 'required' : 'auto',
      allowedIds: wantsBrowser ? ['browser_open'] : undefined, // undefined = ALL tools available
      stepCap,
    };

    // Voiceprint gate: non-root speakers can only use low-risk tools.
    // If no speaker is set (non-voice turns), the existing policy applies unchanged.
    if (this.currentSpeaker && this.currentSpeaker.isRoot !== true) {
      const lowRiskTools = this.toolRegistry.listByRiskLevel('low');
      const allowedIds = lowRiskTools.map((t) => t.id);
      result.allowedIds = allowedIds.length > 0 ? allowedIds : undefined;
    }

    return result;
  }

  // ─── RAG / Turn Journey
  private lastRagResults: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }> = [];
  private lastJourneyBlock = '';
  private lastMentionContextBlock = '';

  // ─── Reflection & Learning (lazy-init)
  private _reflectionLoop: ReflectionLoop | null = null;

  // ─── Neural memory (lazy-init)
  private _turnFeedbackService: TurnFeedbackService | null = null;
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
    kind: 'questionnaire' | 'crew_intake' | 'open_clarification';
    questionnaireMessageId: string;
    userText?: string;
    delegateCrewIds?: string[];
    primaryCrewId?: string;
    crewIntakeFromPicker?: boolean;
  } | null = null;
  /** Original user text for the in-flight turn (clarification resume). */
  private pendingTurnUserText = '';
  private _missionEventSeq = 0;
  private missionContextProvider?: () => { revision: number; block: string };
  private lastMissionContextRevision = -1;
  /** Last TodoManager revision injected via prepareStep (mid-turn checklist refresh). */
  private lastTodosRevisionInjected = -1;
  private pendingStepApproval: ((stepId: string, approved: boolean, description?: string) => void) | null = null;
  private pendingStepCap: ((continueRun: boolean) => void) | null = null;
  /** Set when the user hits Stop — stream/tools must halt immediately. */
  private userCancelledTurn = false;
  private turnState = new TurnStateManager();
  public toolLedger = new ToolLedger();
  public codingTurnGuard: CodingTurnGuard;
  public taskStateManager: TaskStateManager;
  public turnFeedbackLogger: TurnFeedbackLogger;
  private codebaseContextDetector: CodebaseContextDetector;
  private codebaseContext: CodebaseContext | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  public partialTurnContent = '';
  private currentTurnId: string | null = null;
  /** Desktop/main agent step budget — long missions must not stop at ~25 tools. */
  private readonly maxCompletionSteps = 80;
  private readonly crewPrivateCompletionSteps = 80;
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

  get bypassPermissions(): boolean {
    return this.toolExecutor?.getPermissionManager().isAllAllowed() ?? false;
  }

  setBypassPermissions(enabled: boolean): void {
    this.toolExecutor?.getPermissionManager().setBypassPermissions(enabled);
    this.sessionPermissionStore.setBypass(enabled);
    this.emit({ type: 'bypass_permissions_changed', enabled, sessionId: this.sessionId });
  }

  /** Update the thinking mode for subsequent turns (and current turn if in progress). */
  setCurrentThinkingMode(mode: ThinkingMode): void {
    this.currentThinkingMode = mode;
  }

  /** Update the output mode for subsequent turns (and current turn if in progress). */
  setCurrentOutputMode(mode: OutputMode): void {
    this.currentOutputMode = mode;
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
  private get inputNormalizer(): InputNormalizer {
    if (!this._inputNormalizer) {
      this._inputNormalizer = new InputNormalizer();
      this._inputNormalizer.setWorkspaceRoot(this.scopePath);
      this._inputNormalizer.setSessionId(this.sessionId);
    }
    return this._inputNormalizer;
  }
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
  public get runStateMgr(): RunStateManager {
    if (!this._runStateMgr) {
      this._runStateMgr = new RunStateManager(this.options.leaseOwnerNamespace);
    }
    return this._runStateMgr;
  }
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
      setCustomCrewCreateAgent(this);
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
  private compactionFileTracker = new CompactionFileTracker();
  private compactionInFlight = false;
  private steerHandler: SteerMessageHandler;
  private followUpAgentMessages: string[] = [];
  private interAgentAutoBlocks: string[] = [];
  sessionLogger: SessionLogger | null = null;
  onTokenLog: ((opts: { inputTokens: number; outputTokens: number; costUsd: number; crewId?: string }) => void) | null = null;
  onSessionEvent: ((event: SessionEvent) => void) | null = null;

  setContextPersistDir(dir: string, scopePath?: string): void {
    this.contextTracker.setPersistDir(dir);
    if (scopePath) this.contextTracker.setScopePath(scopePath);
  }
  private maxSubAgents = 8;
  /** #16: Active Engineering Crew instance — set during crew runs so the REST API can cancel it. */
  private activeCrew: EngineeringCrew | null = null;
  private unregisterPerformanceTune: (() => void) | null = null;
  public sessionManager: SessionManager | null = null;
  private enabledCrewSessionIds: Set<string> = new Set();

  setTelegramConnected(connected: boolean, chatId?: number | null): void {
    const nextChatId = chatId ?? this._telegramChatId;
    if (this._telegramConnected === connected && this._telegramChatId === nextChatId) return;
    this._telegramConnected = connected;
    this._telegramChatId = nextChatId;
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

  /** Session is waiting on the user (open question or questionnaire in flight). */
  isSessionPausedForUserInput(): boolean {
    return this.isAwaitingClarification() || this.activeClarificationResume != null;
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
    kind: 'questionnaire' | 'crew_intake' | 'open_clarification';
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
      thinkingMode: this.currentThinkingMode,
      outputMode: this.currentOutputMode,
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
      permissionQueue: this.permissionQueue,
      activePermissionId: this.activePermissionId,
      processPermissionQueue: this.processPermissionQueueFn,
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

  private clarificationSource(): ClarificationSource | undefined {
    if (this.options.promptProfile === 'crew_private' && this.options.crewPrivateHost) {
      return {
        kind: 'crew',
        name: this.options.crewPrivateHost.name,
        callsign: this.options.crewPrivateHost.callsign,
      };
    }
    if (this.options.promptProfile !== 'crew_worker') {
      return { kind: 'agent', name: this.persona?.name ?? 'Agent-X' };
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
      kind: 'open_clarification',
      questionnaireMessageId: messageId,
      userText: this.pendingTurnUserText || this.activeClarificationResume?.userText,
      delegateCrewIds: this.activeClarificationResume?.delegateCrewIds,
      primaryCrewId: this.activeClarificationResume?.primaryCrewId,
      crewIntakeFromPicker: this.activeClarificationResume?.crewIntakeFromPicker,
    };
    this.emit({ type: 'message_received', message: clarMsg, elapsed: 0 });
    this.emit({ type: 'clarification_paused', messageId });

    throw new Error(CLARIFICATION_AWAITING_USER);
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

    if (this.options.promptProfile === 'voice') {
      return this.waitForVoiceClarification(payload);
    }

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

  private async waitForVoiceClarification(questionnaire: QuestionnairePayload): Promise<string> {
    if (this.userCancelledTurn) {
      const err = new Error('Turn aborted');
      err.name = 'AbortError';
      throw err;
    }

    this.turnState.setPhase('awaiting_permission', 'clarification');
    this.discardStreamPreambleBeforeQuestionnaire();

    const messageId = generateMessageId();
    this.activeClarificationResume = {
      kind: this.activeClarificationResume?.kind ?? 'questionnaire',
      questionnaireMessageId: messageId,
      userText: this.activeClarificationResume?.userText,
      delegateCrewIds: this.activeClarificationResume?.delegateCrewIds,
      primaryCrewId: this.activeClarificationResume?.primaryCrewId,
      crewIntakeFromPicker: this.activeClarificationResume?.crewIntakeFromPicker,
    };
    this.emit({ type: 'clarification_required', questionnaire });

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

    this.discardStreamPreambleBeforeQuestionnaire();
    this.turnState.setPhase('running', 'resuming');
    this.emit({
      type: 'loading_start',
      stage: 'thinking',
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
    registerCompactionFileTracker(this.sessionId, this.compactionFileTracker);
    this.eventBus = options.eventBus ?? new AgentEventBus();
    this.steerHandler = new SteerMessageHandler(this.eventBus);
    this._onPart = options.onPart;

    // ─── Initialize Autonomous Diagnostics System ───
    this.diagnosticsSystem = new AutonomousDiagnosticsSystem();
    this.initializeDiagnosticsAsync(); // Fire and forget, but log results
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
    this.subAgents.setParentAgent(this);
    this.subAgents.ingestBackgroundResultsForSession(this.sessionId);
    setSubAgentManagerInstance(this.subAgents);
    // Process Supervisor (docs/engineering-crew/DESIGN.md Section 4.6): let AgentProcessRegistry
    // push proactive process_status_changed events into this session when a `shell_background`
    // process this session started exits or crashes, instead of only reporting status the next
    // time the user happens to ask.
    getAgentProcessRegistry().registerSessionEventBus(this.sessionId, this.eventBus);

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
          output: `Crew delegation blocked: this is a general information question. Answer directly as ${this.persona?.name ?? 'Agent-X'} (use web search if needed).`,
        };
      }
      if (!crewDelegationMatchesTask(taskDescription, [member])) {
        return {
          success: false,
          output: `Crew delegation blocked: @${member.crew.callsign} does not have expertise for this task. Answer directly as ${this.persona?.name ?? 'Agent-X'}.`,
        };
      }
      const guard = await this.guardCrewDelegation(taskDescription, [member]);
      if (!guard.allowed) {
        return {
          success: false,
          output: `Crew delegation blocked: ${guard.reason} Handle this yourself as ${this.persona?.name ?? 'Agent-X'}.`,
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
    this.todoManager = new TodoManager(this.eventBus, this.sessionId);
    registerSessionTodoManager(this.sessionId, this.todoManager);
    setIndexerEventBus(this.eventBus);
    // crewManager is lazy — created on first access via getter
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
    this.toolExecutor?.setConfig(this.config);
    setToolRegistryInstance(this.toolRegistry ?? null);
    setCustomCrewCreateAgent(this);

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
      // Messaging channels always prompt. Voice uses normal risk rules and
      // spoken confirmation only — never a bypass chip or UI modal.
      if (this.options.channelSession && this.options.promptProfile !== 'voice') {
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

    // Wire permission requests to event bus (skipped for ephemeral automation workers and messaging channel sessions).
    // Voice-only sessions bind the handler so the voice engine can collect spoken confirmation.
    if (this.toolExecutor && !this.options.automationRun && (!this.options.channelSession || this.options.promptProfile === 'voice')) {
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
      const cmdRegistry = createDefaultRegistry();
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
      getProviderFactoryOptionsHelper(this._providerCredentialsCtx()),
    );

    // Soft concurrency from Settings → Performance (overrides hardcoded defaults).
    this.unregisterPerformanceTune = registerPerformanceTuneTarget(this);

    // Initialize category detector and task state for MoE prompt assembly
    this.categoryDetector = new CategoryDetector();
    this.taskStateManager = new TaskStateManager();
    this.turnFeedbackLogger = new TurnFeedbackLogger(this.sessionId, this.config.provider.activeModel);
    this.codebaseContextDetector = new CodebaseContextDetector();
    this.codebaseContext = this.codebaseContextDetector.detect(this.scopePath);
    this.codingTurnGuard = new CodingTurnGuard(this.toolLedger, (e) => this.emit(e), this.taskStateManager);

    // Initialize decision engine for message classification and routing
    this.decisionEngine = new DecisionEngine();

    // IntentClassifier removed — DecisionEngine (heuristic) handles all routing

    // Initialize agent mesh components
    this.agentBus = getAgentBus();
    this.agentBus.attachEventBus(this.eventBus);
    this.specialistRegistry = new SpecialistRegistry(this.agentBus);
    // reflectionLoop is lazy-init (created on first access)

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

  // ─── Turn feedback
  get turnFeedbackService(): TurnFeedbackService {
    if (!this._turnFeedbackService) {
      this._turnFeedbackService = new TurnFeedbackService(() => this.getPersistStore());
    }
    return this._turnFeedbackService;
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
        messages: this.messages,
        reformulateQuery: (q) => this.reformulateQuery(q),
        sessionId: this.sessionId,
        options: this.options,
        memoryFabric: this.memoryFabric,
        memoryEmbedder: this.memoryEmbedder,
        usesCompactContext: () => this.usesCompactContext(),
        setMemoryContextNodeIds: (ids) => { this._memoryContextNodeIds = ids; },
        speakerId: this.currentSpeaker?.id,
        // Skip retrieval for voice merges/continuations — the prior turn already loaded context.
        // Also skip when thinking mode is 'light' — no RAG retrieval for quick turns.
        skipRetrieval: !!this.pendingVoiceMerge || THINKING_MODE_SKIP_RETRIEVAL[this.currentThinkingMode],
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
    // Skip reformulation in light thinking mode — saves a model call for quick turns.
    if (THINKING_MODE_SKIP_REFORMULATE[this.currentThinkingMode]) return rawQuery;
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

  // ─── Health + Checkpoint
  getHealth(): any {
    return getHealthHelper({
      sessionId: this.sessionId,
      tokenTracker: this.tokenTracker,
      toolExecutor: this.toolExecutor,
      _responseTimes: this._responseTimes,
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

  /** #16: Get the active Engineering Crew instance (if running) for cancellation. */
  getActiveCrew(): EngineeringCrew | null {
    return this.activeCrew;
  }

  /** #14: Get the SubAgentManager — used by standalone REST API crew runs. */
  getSubAgentManager(): SubAgentManager {
    return this.subAgents;
  }

  setScopePath(path: string): void {
    this.scopePath = normalize(resolve(path));
    this.toolExecutor?.setScopePath(this.scopePath);
    this._inputNormalizer?.setWorkspaceRoot(this.scopePath);
    this._inputNormalizer?.setSessionId(this.sessionId);
  }

  /**
   * Cancel an in-progress completion. Aborts the active stream, pending UI waits, and tool executions.
   */
  cancel(): void {
    this.userCancelledTurn = true;
    this.toolExecutor?.setTurnAborted(true);
    this.toolExecutor?.setThirdPartyTurnPolicy(null);
    this.toolExecutor?.setKbDocumentTurnPolicy(null);
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

  setCrewManager(crewManager: CrewManager): void {
    this._crewManager = crewManager;
    setCustomCrewCreateAgent(this);
  }

  get crew(): CrewManager {
    return this.crewManager;
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
    const fireAndForget =
      !!background && !!(this.options.channelSession || channelContext?.channel);

    if (isSubagentAdmissionEnabled() && fireAndForget) {
      const admitted = this.subAgents.spawnAdmitted(
        instruction,
        toolsList ?? [],
        timeout,
        undefined,
        channelContext,
      );
      if (admitted.mode === 'admitted' && admitted.handle) {
        return {
          success: true,
          output: JSON.stringify({
            admitted: true,
            taskId: admitted.handle.taskId,
            childSessionId: admitted.handle.childSessionId,
            status: admitted.handle.status,
            message: 'Sub-agent admitted — completion arrives via subagent_admitted_complete event.',
          }),
          elapsed: 0,
          agentId: admitted.handle.taskId,
        };
      }
      if (admitted.mode === 'blocking' && admitted.result) {
        return { success: false, output: admitted.result, elapsed: 0 };
      }
    }

    const task = this.subAgents.spawn(instruction, toolsList ?? [], timeout, this.maxSubAgents, undefined, !!background, channelContext);
    // On desktop chat the parent ALWAYS waits for the child to finish
    // so it can merge results and continue the turn. Fire-and-forget only when the
    // user is on a messaging channel (or inbound channel context) and asked not to wait.
    if (fireAndForget) {
      this.emit({ type: 'task_backgrounded', taskId: task.id } as EngineEvent);
      return {
        success: true,
        output: `[Sub-agent started in background — task ${task.id}]`,
        elapsed: 0,
        agentId: task.id,
      };
    }
    if (background) {
      // Parallel desktop spawn: still mark as backgrounded for UI, but await below.
      this.emit({ type: 'task_backgrounded', taskId: task.id } as EngineEvent);
    }
    const completed = await this.subAgents.waitFor(task.id);
    return {
      success: completed?.status === 'completed',
      output: completed?.result ?? completed?.status ?? '',
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
    // Auto-continue while sub-agents are still working, or on messaging channels.
    if (this.options.channelSession || this.subAgents.hasOutstandingWork()) {
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
    const agentName = this.persona?.name ?? 'Agent-X';
    const defaultSystem = [
      `You are ${agentName} composing a short outbound Telegram message.`,
      callsign ? `If this message is to the owner, address them by callsign "${callsign}" — not a public honorific.` : '',
      'Reply with ONLY the message body — warm, concise, no markdown headers, no tool names, no meta commentary.',
    ].filter(Boolean).join(' ');
    const messages = [
      { role: 'system' as const, content: options?.systemHint ?? defaultSystem },
      { role: 'user' as const, content: userPrompt },
    ];
    const r = await withSpan('llm.outbound', 'llm', async (span) => {
      span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
      span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
      span.setAttribute('gen_ai.usage.total_cost', 0);
      span.setAttribute('llm.input_messages', JSON.stringify(messages));
      const result = await streamText({
        model,
        messages,
        maxOutputTokens: options?.maxTokens ?? 280,
      });
      let text = '';
      for await (const chunk of result.textStream) text += chunk;
      const trimmed = text.trim();
      span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content: trimmed }]));
      return trimmed;
    });
    if (!r) throw new Error('Model returned an empty message');
    return r;
  }

  async sendMessage(content: string, options?: { instruction?: string; userId?: string; channelId?: string; sourceChannel?: string; sourceMessageId?: string; retry?: boolean; delegateCrewIds?: string[]; crewSuggestionResolved?: boolean; crewIntakeFromPicker?: boolean; primaryCrewId?: string; forceWebSearch?: boolean; voiceTurn?: boolean; userMessagePersisted?: boolean; voiceContinuation?: boolean; voiceMergeIntoMessage?: { messageId: string; prefixContent: string }; resumeCrewIntake?: { originalUserText: string; intakeAnswer: string; delegateCrewIds: string[]; primaryCrewId?: string }; clientSituation?: ClientSituation | null; attachments?: import('@agentx/shared').TurnAttachment[]; /** How to treat leftover incomplete TASKS at turn start. */ todoDisposition?: 'continue' | 'skip' | 'defer'; speaker?: VoiceSessionSpeaker | null; /** Thinking mode — controls tool budget, reasoning depth, retrieval. */ thinkingMode?: ThinkingMode; /** Output mode — controls response verbosity and format. */ outputMode?: OutputMode; goalContinuation?: boolean }): Promise<Message> {
    const startTime = Date.now();
    if (isEngineShuttingDown()) {
      throw new Error('server_shutting_down');
    }
    if (options?.userMessagePersisted === false && this.isSessionPausedForUserInput()) {
      getLogger().warn('AGENT', `Skipping internal turn while session ${this.sessionId} awaits user input`);
      throw new Error('session_awaiting_user_input');
    }
    const turnId = `turn-${startTime}`;
    this.currentTurnId = turnId;
    this.syncDurableTurnStart(turnId);

    return withSpan('agent.turn', 'agent', async (span) => {
      span.setAttribute('trace.kind', 'turn');
      span.setAttribute('trace.domain', 'AGENT');
      span.setAttribute('session.id', this.sessionId);
      span.setAttribute('turn.id', turnId);

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

      if (isInterAgentMessagingEnabled()) {
        this.interAgentAutoBlocks = [];
        await this.processInboundInterAgentMessages();
      }

      // ─── UNIFIED: Ensure single session run + enqueue for concurrency ───
      try {
        await this.runStateMgr.ensureRunning(this.sessionId);
      } catch (e) {
        this.lifecycle.forceTransition('idle');
        this.scope = null;
        if (e instanceof SessionAlreadyActiveError) {
          throw e;
        }
        throw e;
      }
      void this.commandQueue.enqueue(this.sessionId, {
        turnId,
        sessionId: this.sessionId,
        channel: (options?.sourceChannel ?? 'api') as ChannelKind,
        userId: options?.userId ?? 'user',
        receivedAt: startTime,
        text: content,
        attachments: options?.attachments ?? [],
        metadata: {},
      });
      this.turnState.start(this.currentTurnId!, 'receiving');
    this.toolLedger.reset();
    this.codingTurnGuard?.resetForTurn();
    this.currentSpeaker = options?.speaker ?? null;
    this.currentVoiceTurn = options?.voiceTurn === true;
    this.toolExecutor?.setCurrentUserMessageProvider(() => this.currentUserMessage);
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
    this.lastTodosRevisionInjected = -1;

    // Reset per-turn anti-duplicate sentinel
    this._turnMessageEmitted = false;

    // ─── UNIFIED: Normalize input ───
    let cleanContent = content;
    let resolvedAttachments: import('@agentx/shared').NormalizedAttachment[] = [];
    try {
      const normalized = await this.inputNormalizer.sanitize({
        turnId: `turn-${startTime}`,
        sessionId: this.sessionId,
        channel: 'api',
        userId: 'user',
        receivedAt: startTime,
        text: content,
        attachments: options?.attachments ?? [],
        metadata: {},
      });
      cleanContent = normalized.cleanText;
      resolvedAttachments = normalized.cleanAttachments;
      if (normalized.warnings.length > 0) {
        getLogger().warn('NORMALIZE', `${normalized.warnings.length} input warnings`);
      }
    } catch {
      // Fall through with original content if normalization fails
    }

    this.currentUserMessage = cleanContent;
    if (detectsSessionProactiveConsentWaiver(cleanContent)) {
      this.toolExecutor?.setSkipLowRiskProactiveConsent(true);
    }

    // ─── Attachments remain lightweight refs; heavy content is fetched on demand for the model prompt ───
    // Avoid loading extracted text into the user content that is persisted/emitted to the UI.

    // Store the per-message instruction for injection during completion (not in history)
    this.pendingInstruction = options?.instruction || null;
    this.mergeInterAgentAutoBlocksIntoPendingInstruction();
    await this.injectSyntheticIntelligenceTurn(cleanContent);
    this.pendingVoiceMerge = options?.voiceMergeIntoMessage ?? null;
    this.pendingDelegateCrewIds = options?.delegateCrewIds?.length ? [...options.delegateCrewIds] : null;
    if (options?.clientSituation) {
      this.clientSituation = options.clientSituation;
    }

    // Leftover TASKS from a prior turn — honor the user's pre-send disposition.
    this.todoDispositionThisTurn = options?.todoDisposition ?? null;
    this.goalContinuationThisTurn = options?.goalContinuation === true;

    // ─── Turn modes: thinking effort + output verbosity ───
    // If the caller explicitly provides a mode, use it. Otherwise preserve the
    // currently-set mode (set via setCurrentThinkingMode/setCurrentOutputMode or
    // a prior sendMessage call). This prevents steer/stop-and-send/voice/automation
    // paths from silently resetting to defaults.
    if (isValidThinkingMode(options?.thinkingMode)) {
      this.currentThinkingMode = options!.thinkingMode!;
    } else if (!this.currentThinkingMode) {
      this.currentThinkingMode = DEFAULT_THINKING_MODE;
    }
    if (isValidOutputMode(options?.outputMode)) {
      this.currentOutputMode = options!.outputMode!;
    } else if (!this.currentOutputMode) {
      this.currentOutputMode = DEFAULT_OUTPUT_MODE;
    }
    getLogger().info('AGENT', `Turn modes: thinking=${this.currentThinkingMode}, output=${this.currentOutputMode}`);

    if (!options?.goalContinuation) {
      applyAdoptionTurnPolicy({
        sessionId: this.sessionId,
        userText: cleanContent,
        goalContinuation: false,
        sourceChannel: options?.sourceChannel,
        voiceTurn: options?.voiceTurn === true,
        thinkingMode: this.currentThinkingMode,
        outputMode: this.currentOutputMode,
      });
      maybeSyncGoalFromUserPrompt(this.sessionId, cleanContent, this.currentThinkingMode);
    } else {
      applyAdoptionTurnPolicy({
        sessionId: this.sessionId,
        userText: cleanContent,
        goalContinuation: true,
        thinkingMode: this.currentThinkingMode,
        outputMode: this.currentOutputMode,
      });
    }

    if (this.todoDispositionThisTurn === 'skip') {
      this.todoManager.clear();
    } else if (this.todoDispositionThisTurn === 'defer' && this.todoManager.hasIncomplete()) {
      const parked = this.todoManager.getIncomplete()
        .map((t) => `- #${t.id} ${t.title} (${t.status})`)
        .join('\n');
      const deferBlock = [
        '[TODO_DISPOSITION: DEFER]',
        'The user parked an incomplete checklist to ask something else.',
        'Answer the NEW user message only. Do NOT resume parked items this turn.',
        'Completion gate is disabled for the parked checklist this turn.',
        'Parked items (keep on disk for a later turn):',
        parked,
        '[/TODO_DISPOSITION]',
      ].join('\n');
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${deferBlock}`
        : deferBlock;
    } else if (this.todoDispositionThisTurn === 'continue' && this.todoManager.hasIncomplete()) {
      const open = this.todoManager.getIncomplete()
        .map((t) => `- #${t.id} ${t.title} (${t.status})`)
        .join('\n');
      const contBlock = [
        '[TODO_DISPOSITION: CONTINUE]',
        'The user wants the incomplete checklist finished this turn.',
        'Prioritize open TASKS items (completion gate applies). Also address their latest message if relevant.',
        'Open items:',
        open,
        '[/TODO_DISPOSITION]',
      ].join('\n');
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${contBlock}`
        : contBlock;
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
      || options?.sourceChannel === 'email'
      || options?.sourceChannel === 'whatsapp';
    this.activeInboundChannel = messagingChannelInbound ? (options?.sourceChannel ?? null) : null;
    this.toolExecutor?.setMessagingPermissionMode(messagingChannelInbound);
    this.toolExecutor?.setInboundSourceChannel(messagingChannelInbound ? (options?.sourceChannel ?? null) : null);
    this.toolExecutor?.setInboundSourceThreadId(messagingChannelInbound ? (options?.channelId ?? null) : null);
    this.toolExecutor?.setInboundSourceMessageId(messagingChannelInbound ? (options?.sourceMessageId ?? null) : null);
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
    if (options?.forceWebSearch && !searchStatus.available) {
      throw new Error('Web search is not available. Enable a provider in Settings → Tools.');
    }
    if (this.turnWebSearchPolicy !== 'off') {
      const searchInstr = buildWebSearchTurnInstruction(this.turnWebSearchPolicy);
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${searchInstr}`
        : searchInstr;
    }

    if (
      !options?.retry
      && !this.options.channelSession
      && this.options.promptProfile !== 'crew_private'
      && !options?.delegateCrewIds?.length
      && crewParticipationMode(this.options.contextKind, this.sessionId) === 'explicit_only'
    ) {
      try {
        const priorUserMessages = this.messages
          .filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .slice(-3);
        const store = this.getPersistStore();
        const rosterHint = await buildCrewRosterHintBlock({
          message: cleanContent,
          sessionId: this.sessionId,
          contextKind: this.options.contextKind,
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

    // Add user message (clean, without instruction) — only for real user turns
    const realUserTurn =
      !options?.retry
      && !options?.voiceContinuation
      && !options?.goalContinuation
      && cleanContent.trim().length > 0;

    if (realUserTurn) {
      const turnBoundary = this.messages.length > 0
        ? `\n[TURN ${this.currentTurnId} — treat prior messages as context only unless the user references them]`
        : '';
      this.messages.push({
        role: 'user',
        content: cleanContent + turnBoundary,
        attachments: resolvedAttachments,
      } as CompletionMessage);
      this.contextTracker.record('user', cleanContent);
      this.pendingTurnUserText = cleanContent;
    } else if (!options?.voiceContinuation && options?.instruction) {
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${options.instruction}`
        : options.instruction;
    } else if (!options?.voiceContinuation && !options?.goalContinuation && cleanContent.trim()) {
      // Internal turn text (no user bubble) — treat as instruction
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${cleanContent}`
        : cleanContent;
    }

    const messageMetadata: Record<string, unknown> = {};
    if (options?.voiceTurn) messageMetadata['voiceTurn'] = true;
    if (options?.speaker) {
      messageMetadata['speakerId'] = options.speaker.id;
      messageMetadata['speakerName'] = options.speaker.name ?? 'anonymous';
    }
    if (messagingChannelInbound && options?.sourceMessageId) {
      if (options?.sourceChannel) messageMetadata['channel'] = options.sourceChannel;
      const platformMessageId = toNullableBigintId(options.sourceMessageId);
      if (platformMessageId != null) messageMetadata['platformMessageId'] = platformMessageId;
      else messageMetadata['sourceMessageId'] = String(options.sourceMessageId);
      if (options?.channelId) {
        const platformChatId = toNullableBigintId(options.channelId);
        if (platformChatId != null) messageMetadata['platformChatId'] = platformChatId;
        else messageMetadata['sourceChatId'] = String(options.channelId);
      }
    }

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content: cleanContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
      attachments: resolvedAttachments,
      ...(Object.keys(messageMetadata).length > 0 ? { metadata: messageMetadata } : {}),
    } as Message;

    if (realUserTurn && !options?.userMessagePersisted) {
      this.persistUserMessage(userMessage);
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
        this.sessionManager?.persistSessionFields?.(this.sessionId, {
          tokensUsed: this.tokenTracker.tokensUsed,
          tokenAvailable: ctxWindow,
        });
      } catch { /* best-effort */ }
    }

    // Reset turn-level permission auto-approve from any prior batch approval
    this.turnApprovedAll = false;
    this.toolExecutor?.getPermissionManager().revokeOneTimePermissions();
    // Clear per-turn inline tool consent, then re-apply from this user turn
    // ("yes please", "save it to Articles", "don't ask again").
    this.toolExecutor?.clearToolConsent();
    if (this.toolExecutor) {
      const lastAssistant = [...this.messages].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string');
      applyInstructedActionConsent(
        this.toolExecutor,
        cleanContent,
        typeof lastAssistant?.content === 'string' ? lastAssistant.content : undefined,
      );
    }

    const isCrewPrivate = this.options.promptProfile === 'crew_private';

    // ─── DECISION ENGINE (heuristic — zero LLM calls) ───
    const conversationLen = this.messages.filter(m => m.role === 'user').length;
    const lastAssistantEntry = [...this.messages].reverse().find((m) => m.role === 'assistant');
    const decision = this.decisionEngine.classify(cleanContent, conversationLen, {
      lastAssistantMessage: typeof lastAssistantEntry?.content === 'string' ? lastAssistantEntry.content : undefined,
      voiceTurn: options?.voiceTurn === true,
      goalActive: getGoalService().getStatus(this.sessionId).status === 'active',
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

    getLogger().info('CLASSIFY', `class=${decision.messageClass} conf=${decision.confidence} msg="${cleanContent.slice(0, 60)}"`);

    // Emit as the general decision event for UI consumption
    this.emit({
      type: 'decision_made',
      messageClass: decision.messageClass,
      executionPath: decision.executionPath,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
    });

    // ─── CREW ROUTING — gated by session policy (super-session = Agent-X only) ───
    if (this.options.promptProfile !== 'crew_private') {
    const crewCtx = { contextKind: this.options.contextKind, sessionId: this.sessionId };

    // ─── RESUME CREW INTAKE after session restore (questionnaire already answered) ───
    if (options?.resumeCrewIntake && this.crewOrchestrator && allowsCrewInvolvement('resume_intake', crewCtx.contextKind, crewCtx.sessionId)) {
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

    // ─── @MENTION ROUTING — user explicitly invoked crew (roster + Hub catalog) ───
    if (allowsCrewInvolvement('mention', crewCtx.contextKind, crewCtx.sessionId) && this.crewOrchestrator) {
      const mentionKeys = parseCrewMentionKeys(cleanContent);
      if (mentionKeys.length > 0) {
        const store = this.getPersistStore();
        const catalogStore = (store?.getCrewCatalogStore?.() as CrewCatalogRecruitStore | null) ?? null;
        const { members: mentionedMembers, unresolved } = await resolveMentionedCrewMembers(
          this.crewManager,
          this,
          catalogStore,
          cleanContent,
        );
        if (mentionedMembers.length > 0) {
          const attachmentCtx = await this.buildAttachmentContextForMission();
          const missionTask = attachmentCtx
            ? `${cleanContent}\n\n${attachmentCtx}`
            : cleanContent;
          return await this.executeCrewMission(mentionedMembers, missionTask, startTime, classificationContext);
        }
        if (unresolved.length > 0) {
          const labels = unresolved.map((k) => `@${k}`).join(', ');
          const failText =
            `I couldn't involve ${labels} — that specialist isn't on this session roster and couldn't be resolved from the Crew Hub. `
            + `Add them to the crew roster (or open a private chat with them), then try the @mention again.`;
          const failMsg: Message = {
            id: generateMessageId(),
            sessionId: this.sessionId,
            role: 'assistant',
            content: failText,
            toolCalls: null,
            createdAt: new Date().toISOString(),
            tokenCount: Math.ceil(failText.length / 4),
          };
          this.messages.push({ role: 'assistant', content: failText });
          this.persistAssistantMessage(failMsg);
          this.emit({ type: 'message_received', message: failMsg, elapsed: Date.now() - startTime });
          this.lifecycle.forceTransition('idle');
          this.scope = null;
          this.runStateMgr.release(this.sessionId);
          this.commandQueue.release(this.sessionId);
          return failMsg;
        }
      }
    }

    // ─── USER-APPROVED CREW SUGGESTION — deploy selected specialists ───
    if (allowsCrewInvolvement('delegate_picker', crewCtx.contextKind, crewCtx.sessionId) && this.pendingDelegateCrewIds?.length && this.crewOrchestrator) {
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
        message: `Selected crew specialists could not be attached to this session. Continuing with ${this.persona?.name ?? 'Agent-X'}.`,
        recoverable: true,
      });
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
          try { identityBlock = this.persona?.name ?? ''; } catch { /* test env */ }
          fastPrompt = this.decisionEngine.buildFastReplyPrompt(identityBlock);
          const callsign = this.config.user?.callsign;
          userNote = callsign ? `\nAddress the user by their callsign "${callsign}".` : '';
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
          const streamPromise = withSpan('llm.fast_reply', 'llm', async (span) => {
            span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
            span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
            span.setAttribute('gen_ai.usage.total_cost', 0);
            span.setAttribute('llm.input_messages', JSON.stringify(fastMessages));
            const r = await streamText({ model, messages: fastMessages as ModelMessage[], maxOutputTokens: 256 });
            let text = '';
            for await (const chunk of r.textStream) { text += chunk; }
            span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content: text }]));
            return text;
          });
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
    // Category detection drives tool selection, prompt overlay, and reasoning mode
    this.currentCategory = this.categoryDetector.detect(content);
    const reasoningMode = deriveReasoningMode(this.currentCategory.primary, content);
    this.taskStateManager.startTask(content, this.currentCategory.primary, this.currentCategory.sub);
    this.emit({ type: 'intent_detected', intent: this.currentCategory.primary, confidence: this.currentCategory.confidence });
    this.emit({
      type: 'category_detected',
      primary: this.currentCategory.primary,
      sub: this.currentCategory.sub,
      confidence: this.currentCategory.confidence,
      reasoningMode,
      relevantToolCategories: [],
    });

    // ─── TURN JOURNEY: default research pipeline (chat + voice)
    // Prefetch local knowledge + inject stage order so users need not direct tools.
    this.lastRagResults = [];
    this.lastJourneyBlock = '';
    this.lastMentionContextBlock = '';
    {
      const requestProfile = profileRequest(content);
      const referencesLocalContext = /@(?:kb|template|article|session)\[/.test(content) || (options?.attachments?.length ?? 0) > 0;
      const skipJourney =
        this.currentDecision.skipRag === true
        || this.currentDecision.skipTools === true
        || (requestProfile.isConsumerRequest && !referencesLocalContext);
      const toolIds = this.toolRegistry?.list().map((t) => t.id) ?? [];
      try {
        const journey = await runTurnJourney({
          userText: content,
          skip: skipJourney,
          compact: this.usesCompactContext(),
          voiceTurn: options?.voiceTurn === true,
          availableToolIds: toolIds,
        });
        this.lastRagResults = journey.ragResults;
        this.lastJourneyBlock = journey.journeyBlock;
        // Pin KB documents for this turn — hard-deny disk/shell fallbacks on originals.
        const kbMentions = journey.mentionedKb.length > 0
          ? journey.mentionedKb
          : parseKbMentionSourceIds(content);
        if (kbMentions.length > 0) {
          const policy: KbDocumentTurnPolicy = {
            active: true,
            sourceIds: kbMentions.map((m) => m.sourceId),
            names: kbMentions.map((m) => m.name || m.sourceId),
          };
          this.toolExecutor?.setKbDocumentTurnPolicy(policy);
        } else {
          this.toolExecutor?.setKbDocumentTurnPolicy(null);
        }
        if (journey.ragResults.length > 0) {
          this.emit({
            type: 'rag_queried',
            resultCount: journey.ragResults.length,
            elapsed: journey.elapsedMs,
          });
        }
        if (journey.journeyBlock) {
          this.emit({
            type: 'turn_journey',
            stages: journey.stages,
            localHitCount: journey.ragResults.length,
            elapsedMs: journey.elapsedMs,
            voiceTurn: options?.voiceTurn === true,
          });
        }
      } catch (e) {
        getLogger().warn('TURN_JOURNEY', e instanceof Error ? e.message : String(e));
        // Still enforce @kb disk ban even if journey prefetch failed.
        const kbMentions = parseKbMentionSourceIds(content);
        if (kbMentions.length > 0) {
          this.toolExecutor?.setKbDocumentTurnPolicy({
            active: true,
            sourceIds: kbMentions.map((m) => m.sourceId),
            names: kbMentions.map((m) => m.name || m.sourceId),
          });
        }
      }
    }

    try {
      this.lastMentionContextBlock = await buildMentionContextBlock({
        userText: content,
        currentSessionId: this.sessionId,
        loadArticle: async (id) => {
          const store = getArticleStoreInstance();
          if (!store) return null;
          const payload = await store.getContent(id);
          if (!payload) return null;
          return {
            title: payload.record.title,
            kind: payload.record.contentFormat,
            content: payload.content ?? '',
          };
        },
        loadSession: async (id) => {
          if (id === this.sessionId) return null;
          const session = this.sessionManager?.getSessionById(id);
          const page = await this.getPersistStore()?.getMessagesPage?.(id, { limit: 16 });
          if (!page) return null;
          return {
            title: session?.title?.trim() || 'Untitled session',
            messages: page.messages.map((row) => ({
              role: String(row['role'] ?? ''),
              content: messageTextFromRow(row),
            })),
          };
        },
      });
    } catch (e) {
      getLogger().warn('MENTION_CONTEXT', e instanceof Error ? e.message : String(e));
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
      const shouldUseToT = reasoningMode === 'tree';

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

       // ─── Engineering Crew pipeline (design doc Section 4.1) ───
       // Substantial software-engineering tasks route through the isolated
       // Engineering Crew (Architect → Coder ⇄ Verifier → Reviewer) instead of
       // the single-LLM completion loop. Trivial coding stays on the fast path.
       const crewCtx = await this.buildCrewRouterContext();
       const crewRoute = await routeCodingTask(content, this.currentCategory, crewCtx, this.buildLLMIntentClassifier());
       if (crewRoute.useEngineeringCrew) {
         this.emit({ type: 'loading_start', stage: 'engineering_crew' });
         getLogger().info('ENGINEERING_CREW', `Routing to Engineering Crew: ${crewRoute.reason}`);
         const crewMessage = await this.runEngineeringCrew(content, startTime, crewRoute);
         this.noteTurnOutcome(crewMessage.content);
         const stepExec2 = loadSteps[2];
         if (stepExec2) this.emit({ type: 'loading_step_update', stepId: stepExec2.id, label: stepExec2.label, status: 'completed' });
         const stepVerify2 = loadSteps[3];
         if (stepVerify2) this.emit({ type: 'loading_step_update', stepId: stepVerify2.id, label: stepVerify2.label, status: 'completed' });
         this.contextTracker.record('assistant', crewMessage.content, this.options.crewPrivateHost?.name);
         this.extractTasksFromResponse(crewMessage.content);
         this.extractMemories(content, crewMessage.content);
         this.persistSessionToolFindings(content);
         this.toolCallLogForReflection = [];
         this.stopTurnHeartbeat();
         this.turnState.complete();
         this.emitTurnState('done');
         this.emit({ type: 'loading_end' });
         void this.maybeEnqueueFollowUpAgentMessages();
         this.logTurnOutcome(startTime, true, content);
         return crewMessage;
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
      this.persistSessionToolFindings(content);

      void getRuntimeCapabilityManager()?.observeTurn({
        sessionId: this.sessionId,
        userText: content,
        tools: this.toolCallLogForReflection,
      });

      // Run reflection loop for continuous improvement
      if (this.toolCallLogForReflection.length >= 2) {
        void this.reflectionLoop.reflect(this, content, this.toolCallLogForReflection, assistantMessage.content);
      }

      this.toolCallLogForReflection = [];
      this.stopTurnHeartbeat();
      this.turnState.complete();
      this.emitTurnState('done');
      this.emit({ type: 'loading_end' });

      void this.maybeEnqueueFollowUpAgentMessages();

      // Log turn outcome for feedback loop
      this.logTurnOutcome(startTime, true, content);

      return assistantMessage;
    } catch (error) {
      this.durableTurnFailedThisTurn = true;
      this.stopTurnHeartbeat();
      this.turnState.cancel();
      this.emitTurnState('cancelled');
      this.emit({ type: 'loading_end' });

      // Log failed turn outcome
      this.logTurnOutcome(startTime, false, content);

      // User stop must win over provider/anomaly classification — cancel can surface
      // non-AbortError teardown errors from the SDK or in-flight tool work.
      if (this.userCancelledTurn) {
        if (error instanceof Error && error.name === 'AbortError') {
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

      // ─── UNIFIED: Classify error via ErrorClassifier ───
      const classified = this.errorClassifier.classify(error);
      this.telemetry.markError(`turn-${startTime}`, classified.reason, classified.providerMessage ?? '');

      // If aborted without an explicit user stop, surface a friendly cancelled line.
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
      this.syncDurableTurnFinish(
        this.userCancelledTurn ? 'cancelled' : this.durableTurnFailedThisTurn ? 'error' : 'complete',
      );
      this.durableTurnFailedThisTurn = false;
      this.activeInboundChannel = null;
      this.toolExecutor?.setMessagingPermissionMode(false);
      this.toolExecutor?.setInboundSourceChannel(null);
      this.toolExecutor?.setInboundSourceThreadId(null);
      this.toolExecutor?.setInboundSourceMessageId(null);
      this.turnWebSearchPolicy = 'off';
      this.pendingVoiceMerge = null;
      this.todoDispositionThisTurn = null;
      this.goalContinuationThisTurn = false;
      clearAdoptionTurnPolicy();
      this.toolExecutor?.setTurnAborted(false);
      this.toolExecutor?.setThirdPartyTurnPolicy(null);
      this.toolExecutor?.setKbDocumentTurnPolicy(null);
      this.userCancelledTurn = false;
      this.completeTurnTelemetry(startTime);
      trackTurnForAutoRefine(this);
      this.lifecycle.forceTransition('idle');
      this.scope = null;
      this.runStateMgr.release(this.sessionId);
      this.commandQueue.release(this.sessionId);
    }
    });
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

  /**
   * Engineering Crew pipeline — runs a substantial software-engineering task
   * through the isolated Architect → Coder ⇄ Verifier → Reviewer workflow
   * (design doc Section 4). The crew uses the engine's own `SubAgentManager` for
   * LLM-backed role execution, with the verifier deny-listed from file-write
   * tools so it cannot cheat. The result is surfaced as a single assistant
   * message; if the crew is blocked or fails, the summary explains why rather
   * than claiming false success.
   */
  private async runEngineeringCrew(objective: string, startTime: number, route?: RouterDecision): Promise<Message> {
    const spawner = new SubAgentManagerSpawner(this.subAgents);
    const crew = new EngineeringCrew(spawner, this.scopePath, route?.priorTaskId, {
      modelId: this.config.provider.activeModel,
      providerId: this.config.provider.activeProvider,
    });
    // #16: Store the active crew instance so the REST API can cancel it
    this.activeCrew = crew;

    this.emit({
      type: 'category_detected',
      primary: 'coding',
      sub: 'engineering_crew',
      confidence: 1.0,
      reasoningMode: 'standard',
      relevantToolCategories: [],
    });

    // Build session context: conversation history + prior plan state (if resuming)
    const conversationHistory = this.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let priorPlan = null;
    if (route?.resumePriorRun && route.priorTaskId) {
      // Try DB first, then checkpoint file
      const store = this.getCrewStore();
      if (store) {
        priorPlan = await store.loadRun(route.priorTaskId);
      }
      if (!priorPlan) {
        priorPlan = EngineeringCrew.loadCheckpoint(route.priorTaskId);
      }
    }

    const sessionCtx: SessionContext = {
      sessionId: this.sessionId,
      conversationHistory,
      priorPlan,
      latestUserMessage: objective,
    };
    crew.setSessionContext(sessionCtx);

    // Pass the DB store to the crew for per-round checkpointing (#2)
    crew.setStore(this.getCrewStore());

    // #12: Wire progress callback to emit real-time events on the Agent's event bus
    crew.setProgressCallback((event) => {
      this.emit({
        type: 'loading_step_update',
        stepId: event.taskId ? `crew-${event.taskId}-round-${event.round}` : `crew-round-${event.round}`,
        label: `${event.role}: ${event.topic}`,
        status: 'active',
      } as EngineEvent);
    });

    // Resume or fresh start
    if (route?.resumePriorRun && priorPlan) {
      getLogger().info('ENGINEERING_CREW', `Resuming crew ${crew.taskId} with ${priorPlan.phases.length} prior phase(s)`);
      crew.resume(priorPlan, objective);
    } else {
      crew.kickoff(objective);
    }

    let result: EngineeringCrewResult;
    try {
      result = await crew.run(30, 60 * 60_000);
      if (route?.resumePriorRun) result.resumed = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      getLogger().error('ENGINEERING_CREW', `Crew run threw: ${msg}`);
      result = { success: false, blocked: false, summary: `Engineering Crew encountered an error: ${msg}`, rounds: 0, timedOut: false };
    } finally {
      // #16: Clear the active crew reference
      this.activeCrew = null;
    }

    // Persist the crew run to the database for future resume
    if (result.plan) {
      const store = this.getCrewStore();
      if (store) {
        void store.saveRun(result.plan, this.sessionId, result.summary, result.rounds).catch(() => { /* best-effort */ });
      }
    }

    const summary = this.formatCrewResult(result, crew.taskId);
    const assistantMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'assistant',
      content: summary,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: estimateOutputTokens(summary),
    };
    this.messages.push({ role: 'assistant', content: summary });
    this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });
    return assistantMessage;
  }

  /**
   * Build router context for the coding-task router — checks whether a prior
   * Engineering Crew run exists for this session so the router can signal resume.
   */
  private async buildCrewRouterContext(): Promise<RouterContext> {
    const ctx: RouterContext = { sessionId: this.sessionId };
    const store = this.getCrewStore();
    if (!store) return ctx;
    try {
      const incomplete = await store.findIncompleteRunBySession(this.sessionId);
      if (incomplete) {
        ctx.hasPriorRun = true;
        ctx.hasIncompleteRun = true;
        ctx.priorTaskId = incomplete.taskId;
        ctx.priorObjective = incomplete.objective;
      } else {
        const latest = await store.findLatestRunBySession(this.sessionId);
        if (latest) {
          ctx.hasPriorRun = true;
          ctx.priorObjective = latest.objective;
        }
      }
    } catch { /* best-effort — router will just not resume */ }
    return ctx;
  }

  /** Get the EngineeringCrewStore if a pg pool is available. */
  private getCrewStore(): EngineeringCrewStore | null {
    if (!this._pgPool) return null;
    return new EngineeringCrewStore(this._pgPool as import('pg').Pool);
  }

  /**
   * Build a lightweight LLM intent classifier for ambiguous routing decisions (#10).
   * Uses a short prompt with the active provider to classify whether a coding message
   * is substantial enough to warrant the full Engineering Crew pipeline.
   * Returns undefined if no provider is available (router falls back to heuristics).
   */
  private buildLLMIntentClassifier(): LLMIntentClassifier | undefined {
    if (!this.provider) return undefined;
    return async (userMessage: string, priorObjective?: string) => {
      const prompt = `Is this coding request a substantial software-engineering task that needs planning, implementation, and verification (answer YES), or a trivial fix/explanation that a single LLM turn can handle (answer NO)?

${priorObjective ? `Prior work context: ${priorObjective.slice(0, 200)}` : ''}

Request: "${userMessage.slice(0, 500)}"

Answer strictly YES or NO.`;
      try {
        let text = '';
        const stream = this.provider!.complete({
          messages: [{ role: 'user', content: prompt }],
          model: this.config.provider.activeModel,
          temperature: 0,
          maxTokens: 10,
          stream: true,
        });
        for await (const chunk of stream) {
          if (chunk.type === 'text_delta' && chunk.content) {
            text += chunk.content;
          }
        }
        return text.toUpperCase().includes('YES');
      } catch {
        return false; // On error, default to fast path
      }
    };
  }

  /** Format the Engineering Crew result into a user-facing assistant message. */
  private formatCrewResult(result: EngineeringCrewResult, taskId: string): string {
    const lines: string[] = [];
    if (result.success) {
      lines.push('**Engineering Crew — Task Complete**');
      lines.push('');
      lines.push(`All phases verified by the independent Verifier. Task ID: \`${taskId}\`.`);
    } else if (result.blocked) {
      lines.push('**Engineering Crew — Blocked**');
      lines.push('');
      lines.push('The crew could not complete this task due to a blocking issue. The summary below explains what needs to be resolved before retrying.');
    } else if (result.timedOut) {
      lines.push('**Engineering Crew — Timed Out**');
      lines.push('');
      lines.push('The crew did not finish within the allotted rounds/time.');
    } else {
      lines.push('**Engineering Crew — Incomplete**');
      lines.push('');
      lines.push('The crew could not complete this task. See the summary below for details.');
    }
    if (result.resumed) {
      lines.push('');
      lines.push('_This run resumed from a prior checkpoint._');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(result.summary);

    if (result.plan) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('**Plan summary:**');
      for (const phase of result.plan.phases) {
        const icon = phase.status === 'verified' ? '[x]' : phase.status === 'blocked' ? '[!]' : '[ ]';
        lines.push(`- ${icon} ${phase.title} (${phase.id}) — ${phase.status}`);
        if (phase.verification && phase.verification.length > 0) {
          for (const v of phase.verification) {
            lines.push(`  - ${v.passed ? 'PASS' : 'FAIL'}: ${v.criterion}`);
          }
        }
      }
    }
    // #5: Display cost tracking in the result
    if (result.cost) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push(`**Cost:** ${result.cost.totalTokens.toLocaleString()} tokens (~$${result.cost.estimatedCost.toFixed(4)})`);
    }
    return lines.join('\n');
  }

  private async runCompletionLoop(startTime: number): Promise<Message> {
    const lastUserMsg = [...this.messages].reverse().find((m) => m.role === 'user');
    const lastUserText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
      : '';
    return withSpan('llm.chat', 'llm', async (span) => {
    span.setAttribute('gen_ai.usage.total_cost', 0);
    this.currentUserMessage = lastUserText;
    await this.reconcileSystemPrompt();
    await this.compactContext();

    const emit = (e: EngineEvent) => this.emit(e);
    const registry = this.toolRegistry;
    const executor = this.toolExecutor;
    if (!registry) throw new Error('Tool registry not initialized');
    if (!executor) throw new Error('Tool executor not initialized');

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
    const toolPolicy = this.getToolPolicy();
    this.emit({
      type: 'tool_policy_applied',
      choice: toolPolicy.choice,
      allowedIds: toolPolicy.allowedIds,
      stepCap: toolPolicy.stepCap,
      category: this.currentCategory?.primary ?? 'general',
      sub: this.currentCategory?.sub,
    });
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
      (toolId, success, output, elapsed, args, metadata) => {
        const path = typeof args?.path === 'string' ? args.path : undefined;
        const command = typeof args?.command === 'string' ? args.command
          : typeof args?.cmd === 'string' ? args.cmd
          : undefined;
        const exitCode = typeof metadata?.exitCode === 'number' ? metadata.exitCode : undefined;
        this.toolLedger.record({ name: toolId, success, output, elapsed, path, command, exitCode });
        this.toolCallLogForReflection.push({ name: toolId, success, output, elapsed });
        this.codingTurnGuard?.onToolExecuted(toolId, success, args ?? {}, this.currentCategory, exitCode);
        this.turnState.touch();
      },
      span,
      toolPolicy.allowedIds,
      (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
    );

    if (this.options.promptProfile === 'crew_private' || deniesAutonomousCrewTools(this.options.contextKind, this.sessionId)) {
      const denyCrewOrchestration = new Set(['spawn_crew_workers', 'delegate_to_crew', 'crew_response']);
      for (const key of Object.keys(tools)) {
        if (denyCrewOrchestration.has(key)) delete tools[key];
      }
    }

    // ─── Turn mode: remove deep_web_search when not allowed by thinking mode ───
    if (!THINKING_MODE_ALLOW_DEEP_SEARCH[this.currentThinkingMode]) {
      delete tools['deep_web_search'];
    }

    if (integrationHint !== undefined || integrationAccessPolicy !== undefined) {
      const reconciled = reconcileIntegrationHintWithActiveTools(
        integrationHint,
        integrationAccessPolicy,
        Object.keys(tools),
        registry.list().map((t) => t.id),
      );
      integrationHint = reconciled.hint;
      integrationAccessPolicy = reconciled.policy;
      this.toolExecutor?.setThirdPartyTurnPolicy(reconciled.policy ?? null);
    }

    const model = createAiSdkModel(this.config, this.getApiKey());

    let aiMessages = await this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const toolCount = Object.keys(tools).length;
    const rebuildAiMessages = async () => this.buildAiMessagesForTurn({
      lastUserText,
      compact,
      integrationHint,
    });
    const budget = await this.ensureOutputBudget(aiMessages, tools, rebuildAiMessages);
    aiMessages = budget.messages;
    // ─── Turn mode: output length is prompt-guided; do not cap maxOutputTokens per mode ───
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

      // ─── Turn mode: override reasoning effort from thinking mode ───
      const modeReasoningEffort = THINKING_MODE_REASONING_EFFORT[this.currentThinkingMode];
      const effectiveReasoningEffort = modeReasoningEffort ?? this.config.provider.activeReasoningEffort;

      // Log tool setup for debugging
      getLogger().info('AGENT', `Starting streamText with ${toolCount} tools, provider: ${this.config.provider.activeProvider}, model: ${this.config.provider.activeModel}, reasoningEffort: ${effectiveReasoningEffort ?? '(default)'} (mode: ${this.currentThinkingMode}), maxOutputTokens: ${turnMaxOutputTokens}`);

      let stepCapContinuations = 0;
      const stepBudget = this.completionStepBudget();
      const stepLimit = () => stepBudget;
      const googleProviderOptions = this.config.provider.activeProvider === 'google'
        ? buildGoogleAiSdkProviderOptions(
          this.config.provider.activeModel,
          effectiveReasoningEffort,
        )
        : undefined;
      const commandCodeProviderOptions = this.config.provider.activeProvider === 'commandcode'
        ? buildCommandCodeAiSdkProviderOptions(effectiveReasoningEffort)
        : undefined;
      const aiSdkProviderOptions = googleProviderOptions ?? commandCodeProviderOptions;
      const sdkMessages = await this.buildSdkMessages(aiMessages);
      span.setAttribute('llm.input_messages', JSON.stringify(sdkMessages.slice(-20)));
      span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
      span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
      const result = streamText({
        model,
        messages: sdkMessages as unknown as ModelMessage[],
        tools,
        abortSignal: this.abortSignal,
        maxRetries: 2,
        maxOutputTokens: turnMaxOutputTokens,
        stopWhen: ({ steps }) => steps.length >= Math.min(stepLimit(), toolPolicy.stepCap),
        toolChoice: toolPolicy.choice,
        ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
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
          // Keep toolChoice at stream-level "auto". Required tools are driven by
          // turn instructions — forced/named tool selection is not portable across
          // reasoning-capable endpoints.
          // Mid-turn injections: the SDK only reconciles the system prompt once per
          // turn, so checklist / crew updates must be pushed into prepareStep or the
          // model never sees them after the first todo_write.
          if (stepNumber === 0) return {};
          const extras: Array<{ role: 'user'; content: string }> = [];

          // ─── Search loop prevention ───
          // If the model has already called web_search/deep_web_search many times,
          // inject a system message telling it to STOP searching and produce the result.
          // This prevents the 52-96 iteration search loops seen in failing sessions.
          const searchCalls = this.toolCallLogForReflection.filter(
            t => t.name === 'web_search' || t.name === 'deep_web_search'
          ).length;
          if (searchCalls >= 4 && stepNumber > 0) {
            getLogger().warn('AGENT', `Search loop detected (${searchCalls} searches at step ${stepNumber}) — forcing result production`);
            extras.push({
              role: 'user',
              content: `[SYSTEM] You have already searched ${searchCalls} times. You have enough information. STOP searching. Do NOT call web_search or deep_web_search again. Produce the final result NOW — write the file, deliver the itinerary, answer the question. Use file_write if the user asked to save something. Do not search again.`,
            });
          }

          const todosRev = this.todoManager.getRevision();
          if (todosRev > this.lastTodosRevisionInjected && this.todoManager.getItems().length > 0) {
            this.lastTodosRevisionInjected = todosRev;
            extras.push({
              role: 'user',
              content: this.todoManager.formatActiveBlock({
                deferred: this.todoDispositionThisTurn === 'defer',
              }),
            });
          }

          const provider = this.missionContextProvider;
          if (provider) {
            const { revision, block } = provider();
            if (block.trim() && revision > this.lastMissionContextRevision) {
              this.lastMissionContextRevision = revision;
              extras.push({
                role: 'user',
                content: `[TEAM UPDATE — new crew activity]\n${block}\n[/TEAM UPDATE]`,
              });
            }
          }

          // Verification gate: if files were written in a coding turn but no build/test
          // has been run, inject a reminder so the model verifies before finishing.
          const verificationReminder = this.codingTurnGuard?.getVerificationReminder();
          if (verificationReminder) {
            extras.push({ role: 'user', content: verificationReminder });
          }

          if (extras.length === 0) return {};
          return { messages: [...messages, ...extras] };
        },
      });

      let finishEmitted = false;
      let stalled = false;
      let streamError: Error | null = null;
      try {
        const watchdogOutcome = await consumeStreamWithWatchdog(result.fullStream, (chunk) => {
          streamHandler.handleEvent(chunk);
          if (chunk.type === 'text-delta') {
            this.partialTurnContent = streamHandler.getState().accumulatedContent;
          }
          if (chunk.type === 'finish') finishEmitted = true;
        });
        stalled = watchdogOutcome.stalled;
        if (stalled) {
          // The stream went silent (no chunk at all — including no tool-result for an
          // already-dispatched tool call) for longer than the idle watchdog allows.
          // Fail this turn explicitly and immediately instead of hanging indefinitely
          // while the model waits on a tool call that will never resolve.
          streamError = new Error(
            'STREAM_STALLED: no stream activity received for ' +
            `${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s — the provider connection likely dropped mid-turn.`,
          );
          getLogger().warn('AGENT', streamError.message);
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        getLogger().warn('AGENT', `streamText failed: ${streamError.message}`);
        // Surface stream errors (including rate limits and transient server errors) so callers can detect them
        const errStr = streamError.message || '';
        const isTransient = /429|rate.?limit|too many requests|quota|overloaded|503|queue is full|service unavailable|bad gateway|502|500|internal server error|timeout|timed out|econnreset|enetunreach|fetch failed/i.test(errStr);
        this.emit({
          type: 'provider_error',
          provider: this.config.provider.activeProvider,
          model: this.config.provider.activeModel,
          message: streamError.message,
          recoverable: isTransient,
          actions: isTransient ? [{ type: 'retry', label: 'Retry' }] : undefined,
        });
        if (streamError.name === 'AbortError') {
          throw streamError;
        }
      }

      // Fallback: if stream ended without finish event, emit one now to ensure message is recorded
      if (!finishEmitted) {
        const state = streamHandler.getState();
        if (state.accumulatedContent || state.toolCallCount > 0 || (state.accumulatedReasoning || '').trim()) {
          // Do not await result.usage when the watchdog already gave up on the stream;
          // the usage promise can stay pending forever and deadlock sendMessage.
          streamHandler.handleEvent({ type: 'finish', usage: stalled ? undefined : await result.usage });
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

      // ─── HARD VERIFICATION GATE ───
      // If the CodingTurnGuard says verification is required but hasn't passed,
      // we must NOT let the turn finish. Inject a forced verification message
      // and re-run the model with tools so it actually verifies its work.
      // This is the structural enforcement that prevents claiming success without proof.
      if (this.codingTurnGuard?.mustBlockFinish() && !this.options.skipEmptyResponseRetry) {
        const forcedMsg = this.codingTurnGuard.getForcedVerificationMessage();
        getLogger().warn('AGENT', `Verification gate BLOCKING turn finish — forcing verification before completion`);
        this.emit({ type: 'verification_gate_blocked', reason: 'code written but not verified — forcing build/test/endpoint check' });
        try {
          const forcedResult = await withSpan('llm.verification_gate', 'llm', async (span) => {
            span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
            span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
            const gatePolicy = this.getToolPolicy();
            const gateTools = createAiSdkTools(
              this.toolRegistry!,
              this.toolExecutor!,
              this.sessionId,
              (e) => this.emit(e),
              async () => 'continue',
              (instruction, toolsList, timeout, background) =>
                this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
              (toolId, success, output, elapsed, args, metadata) => {
                const path = typeof args?.path === 'string' ? args.path : undefined;
                const command = typeof args?.command === 'string' ? args.command
                  : typeof args?.cmd === 'string' ? args.cmd
                  : undefined;
                const exitCode = typeof metadata?.exitCode === 'number' ? metadata.exitCode : undefined;
                this.toolLedger.record({ name: toolId, success, output, elapsed, path, command, exitCode });
                this.toolCallLogForReflection.push({ name: toolId, success, output, elapsed });
                this.codingTurnGuard?.onToolExecuted(toolId, success, args ?? {}, this.currentCategory, exitCode);
                this.turnState.touch();
              },
              span,
              gatePolicy.allowedIds,
              (toolId: string, args: Record<string, unknown>) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
            );
            const gateMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
              ...aiMessages,
              ...(text ? [{ role: 'assistant' as const, content: text }] : []),
              { role: 'user' as const, content: forcedMsg },
            ];
            const gateStream = streamText({
              model: createAiSdkModel(this.config, this.getApiKey()),
              messages: gateMessages,
              tools: gateTools,
              toolChoice: 'required',
              stopWhen: stepCountIs(15),
              maxRetries: 1,
            });
            // Consume the gate stream — the stream handler processes tool results
            // and the onToolExecuted callback in the main stream loop will fire
            // via the tool execution callback in createAiSdkTools.
            const gateHandler = createAiSdkStreamHandler(
              this.emit.bind(this),
              this.sessionId,
              (inputTokens, outputTokens) => {
                this.tokenTracker.addTokenUsage(inputTokens, outputTokens);
              },
              this._onPart,
              this.config.provider.activeModel,
            );
            await consumeStreamWithWatchdog(gateStream.fullStream, (chunk) => {
              gateHandler.handleEvent(chunk);
            });
            return gateHandler.getState().accumulatedContent || '';
          });
          // Append the verification results to the content
          if (forcedResult) {
            content = content
              ? `${content}\n\n---\n**Verification:**\n${forcedResult}`
              : forcedResult;
          }
          // Check if verification now passed
          if (!this.codingTurnGuard?.mustBlockFinish()) {
            getLogger().info('AGENT', 'Verification gate PASSED after forced verification round');
          } else {
            getLogger().warn('AGENT', 'Verification gate STILL not passed after forced round — allowing turn to end with warning');
            content = content
              ? `${content}\n\n[WARNING] Verification was not completed successfully. The code may not work as expected.`
              : '[WARNING] Verification was not completed successfully. The code may not work as expected.';
          }
        } catch (gateError) {
          getLogger().warn('AGENT', `Forced verification round failed: ${(gateError as Error).message}`);
        }
      }

      // Generic self-healing: if response is essentially empty (whitespace or <3 chars),
      // or the tool loop crashed (e.g. malformed tool-call arguments), retry once.
      // When tools already ran, retry WITHOUT tools to force a plain-text summary.
      // Reasoning-only models (answer only in thinking) also force a text-only rewrite.
      // Benchmark callers can opt out to fail fast instead of retrying a stalled provider.
      const priorReasoning = (streamHandler.getState().accumulatedReasoning || '').trim();
      const reasoningOnlyEmpty = content.length < 3 && priorReasoning.length >= 40;
      if (!this.options.skipEmptyResponseRetry && (content.length < 3 || streamError)) {
        const toolSummary = this.toolCallLogForReflection
          .map(t => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'} — ${t.output.slice(0, 300)}`)
          .join('\n');
        const worked = toolExecs > 0;
        const textOnlyRetry = worked || !!streamError || reasoningOnlyEmpty;
        getLogger().warn(
          'AGENT',
          `Response too short (${content.length} chars, ${toolExecs} tools, reasoning=${priorReasoning.length}${streamError ? ', stream error' : ''}${reasoningOnlyEmpty ? ', reasoning-only' : ''}) — retrying${textOnlyRetry ? ' text-only' : ' with tools'}`,
        );
        try {
          const reasoningHint = reasoningOnlyEmpty
            ? `\n\nYour prior reasoning (rewrite as the user-visible reply — do not leave the answer only in thinking):\n${priorReasoning.slice(0, 8000)}`
            : '';
          const retryMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
            ...aiMessages,
            ...(worked ? [{ role: 'assistant' as const, content: text || '(executed tools)' }] : []),
            ...(reasoningOnlyEmpty && !worked
              ? [{ role: 'assistant' as const, content: '(reasoning produced; no user-visible text)' }]
              : []),
            {
              role: 'user' as const,
              content: worked || streamError
                ? `[SYSTEM] You just ran these tools:\n${toolSummary || '(see prior tool activity)'}\n\nNow respond to the user based on these results. Do not call more tools. Be thorough and actionable.`
                : reasoningOnlyEmpty
                  ? `[SYSTEM] You produced detailed reasoning but ZERO user-visible assistant text. The user cannot see thinking/reasoning. Write the complete answer now as normal markdown message text. Do not call tools. Do not put the answer only in thinking.${reasoningHint}`
                  : `[SYSTEM] The user said: "${aiMessages[aiMessages.length - 1]?.content?.slice(0, 500)}"\n\nUse the appropriate tools to answer. Prefer connected MCP integration tools when the request targets an external service — do not scan the local filesystem as a substitute. Do not return empty.`,
            },
          ];
          const retryText = await withSpan('llm.retry', 'llm', async (span) => {
            span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
            span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
            span.setAttribute('gen_ai.usage.total_cost', 0);
            span.setAttribute('llm.input_messages', JSON.stringify(retryMessages));
            const retryPolicy = this.getToolPolicy();
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
                    undefined,
                    span,
                    retryPolicy.allowedIds,
                    (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
                  ),
                  stopWhen: stepCountIs(Math.min(stepBudget, 40)),
                  toolChoice: retryPolicy.choice,
                }),
              maxRetries: 1,
              maxOutputTokens: turnMaxOutputTokens,
            });
            let retryOutput = '';
            // Reset before consuming the retry stream — without this, the retry's text
            // gets silently glued onto the prior (empty/too-short) response with no
            // separator, producing a concatenated duplicate message. See the identical
            // pattern in the transition-phrase continuation above and the comment on
            // streamHandler.reset() in AiSdkStreamHandler.ts.
            streamHandler.reset();
            await consumeStreamWithWatchdog(retryResult.fullStream, (chunk) => streamHandler.handleEvent(chunk));
            retryOutput = (streamHandler.getState().accumulatedContent || '').trim();
            span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content: retryOutput }]));
            return retryOutput;
          });
          if (retryText) content = text.trim() ? text.trim() + '\n\n' + retryText : retryText;
        } catch (retryErr) {
          getLogger().warn(
            'AGENT',
            `Empty-response retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
      }

      // Last resort: model answered only in reasoning — surface that as the reply
      // rather than the generic apology (UI already showed the Thought panel).
      if (content.length < 3) {
        const reasoningFallback = (streamHandler.getState().accumulatedReasoning || '').trim();
        if (reasoningFallback.length >= 40) {
          getLogger().warn('AGENT', `Promoting ${reasoningFallback.length} chars of reasoning to user-visible reply`);
          content = reasoningFallback;
        }
      }

      // ─── Transition-phrase continuation ───
      // If the model stopped with text that promises a question/choice but never
      // actually called ask_clarification, force a continuation so the model
      // actually calls the tool instead of just narrating its intent.
      if (!this.userCancelledTurn && !this.options.delegatedWorker && !streamError) {
        const transitionPhrases = [
          'one quick choice', 'let me ask', 'let me clarify', 'quick question',
          'before i', 'so i can build', 'so i can prepare', 'so i can create',
          'let me know', 'which would you prefer', 'would you prefer',
          'i\'ll ask', 'i will ask', 'need to know', 'a few questions',
          'question 1 of', 'question 2 of', 'question 3 of', 'question 4 of',
          'please choose', 'pick one', 'select one', 'reply with',
        ];
        const lowerContent = content.toLowerCase();
        const hasTransition = transitionPhrases.some(p => lowerContent.includes(p));
        // Free-text choice dumps: "Question N of M" / bullet Yes-No / A) B) lists without ask_clarification
        const hasTextChoiceDump = (
          /question\s+\d+\s+of\s+\d+/i.test(content)
          || (/\b(yes|no)\b/i.test(content) && /^\s*[-*•]\s+/m.test(content) && /\?/.test(content))
          || (/^\s*([A-D][).]|[-*•])\s+\S+/m.test(content) && /\b(which|choose|prefer|option|select)\b/i.test(content))
        );
        const calledClarify = this.toolCallLogForReflection.some(t => t.name === 'ask_clarification');
        const calledAnyTool = this.toolCallLogForReflection.length > 0;

        if ((hasTransition || hasTextChoiceDump) && !calledClarify && !this.options.skipEmptyResponseRetry) {
          getLogger().warn(
            'AGENT',
            `Choice-without-questionnaire detected (${content.length} chars, ${toolExecs} tools, no ask_clarification) — forcing continuation to call ask_clarification`,
          );
          try {
            const contMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
              ...aiMessages,
              { role: 'assistant', content: content || '(prior work)' },
              {
                role: 'user',
                content: `[SYSTEM] You presented a choice question as plain text (or said you would ask), but you did NOT call ask_clarification. You MUST call ask_clarification NOW with a single_choice or multi_choice question (one question only). Do not output any assistant text — just call the tool. Never list Yes/No or A/B options as markdown bullets.`,
              },
            ];
            const contText = await withSpan('llm.transition_retry', 'llm', async (span) => {
              span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
              span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
              span.setAttribute('gen_ai.usage.total_cost', 0);
              span.setAttribute('llm.input_messages', JSON.stringify(contMessages));
              const contPolicy = this.getToolPolicy();
              const contTools = createAiSdkTools(
                this.toolRegistry!,
                this.toolExecutor!,
                this.sessionId,
                (e) => this.emit(e),
                async () => 'continue',
                (instruction, toolsList, timeout, background) =>
                  this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                undefined,
                span,
                contPolicy.allowedIds,
                (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
              );
              const contResult = streamText({
                model,
                messages: contMessages as unknown as ModelMessage[],
                tools: contTools,
                abortSignal: this.abortSignal,
                maxRetries: 1,
                maxOutputTokens: turnMaxOutputTokens,
                stopWhen: stepCountIs(Math.min(stepBudget, 40)),
                toolChoice: contPolicy.choice,
                ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
              });
              // Reset before consuming — `streamHandler` is reused across the original turn
              // and this continuation, and without resetting, `accumulatedContent` below would
              // be the ORIGINAL response text with the continuation's text appended directly
              // (no separator), silently gluing two unrelated model responses into one message.
              streamHandler.reset();
              await consumeStreamWithWatchdog(contResult.fullStream, (chunk) => streamHandler.handleEvent(chunk));
              return (streamHandler.getState().accumulatedContent || '').trim();
            });
            if (contText) content = contText;
            // Update tool exec count after continuation
            const newToolExecs = streamHandler.getState().toolExecutions || [];
            if (newToolExecs.length > 0) {
              this.toolCallLogForReflection.push(...newToolExecs.map(t => ({ name: t.tool, success: t.success, output: t.output, elapsed: t.elapsed })));
            }
          } catch (contErr) {
            if (contErr instanceof Error && contErr.name === 'AbortError') throw contErr;
            getLogger().warn('AGENT', `Transition-phrase continuation failed: ${contErr instanceof Error ? contErr.message : String(contErr)}`);
          }
        }

        // Also: if the model ran tools but produced no meaningful text and no
        // questionnaire, force a text continuation so the user gets a response.
        if (calledAnyTool && content.length < 20 && !calledClarify && !this.options.skipEmptyResponseRetry) {
          getLogger().warn('AGENT', `Tools ran (${toolExecs}) but response is too short (${content.length} chars) — forcing text continuation`);
          try {
            const toolSummary = this.toolCallLogForReflection
              .map(t => `- ${t.name}: ${t.success ? 'OK' : 'FAILED'} — ${(t.output || '').slice(0, 300)}`)
              .join('\n');
            const contMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
              ...aiMessages,
              { role: 'assistant', content: '(executed tools, no text response)' },
              {
                role: 'user',
                content: `[SYSTEM] You just ran these tools:\n${toolSummary}\n\nNow respond to the user based on these results. If you need to ask a structured question, call ask_clarification. Otherwise, provide a complete answer. Do not return empty or just a transition phrase.`,
              },
            ];
            const contText = await withSpan('llm.text_continuation', 'llm', async (span) => {
              span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
              span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
              span.setAttribute('gen_ai.usage.total_cost', 0);
              span.setAttribute('llm.input_messages', JSON.stringify(contMessages));
              const contPolicy = this.getToolPolicy();
              const contResult = streamText({
                model: createAiSdkModel(this.config, this.getApiKey()),
                messages: contMessages,
                tools: createAiSdkTools(
                  this.toolRegistry!,
                  this.toolExecutor!,
                  this.sessionId,
                  (e) => this.emit(e),
                  async () => 'continue',
                  (instruction, toolsList, timeout, background) =>
                    this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                  undefined,
                  span,
                  contPolicy.allowedIds,
                  (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
                ),
                stopWhen: stepCountIs(Math.min(stepBudget, 40)),
                toolChoice: contPolicy.choice,
              });
              // Reset before consuming — see the identical comment on the transition-phrase
              // continuation above; without this the continuation's text gets silently glued
              // onto the prior (too-short) response with no separator.
              streamHandler.reset();
              await consumeStreamWithWatchdog(contResult.fullStream, (chunk) => streamHandler.handleEvent(chunk));
              return (streamHandler.getState().accumulatedContent || '').trim();
            });
            if (contText) content = contText;
          } catch (contErr) {
            if (contErr instanceof Error && contErr.name === 'AbortError') throw contErr;
            getLogger().warn('AGENT', `Text continuation failed: ${contErr instanceof Error ? contErr.message : String(contErr)}`);
          }
        }

        // ─── Action transition phrase detection ───
        // If the model says "saving it" / "writing now" but never called a deliverable
        // tool, do NOT force the write. Ask the user first (unless they already
        // requested a save this turn, waived asks, or bypass is on).
        const actionPhrases = [
          'writing the full', 'writing the complete', 'writing your', 'writing the itinerary',
          'writing the plan', 'writing the surprise', 'writing the mission',
          'saving it', 'saving the', 'saving your', 'save it to', 'save this',
          'building the full', 'building the complete', 'building your',
          'locking the', 'locking in the', 'putting together the',
        ];
        const hasActionTransition = actionPhrases.some(p => lowerContent.includes(p));
        const calledFileWrite = this.toolCallLogForReflection.some(t => t.name === 'file_write' || t.name === 'save_to_article');
        const userAskedSave = detectsExplicitDeliverableRequest(this.currentUserMessage);
        const skipAsk = this.toolExecutor?.getSkipLowRiskProactiveConsent() === true
          || this.bypassPermissions
          || userAskedSave;
        if (hasActionTransition && !calledFileWrite && !this.options.skipEmptyResponseRetry) {
          if (skipAsk) {
            getLogger().warn(
              'AGENT',
              `Action transition detected (${content.length} chars, no file_write) — forcing continuation to write the file`,
            );
            try {
              const contMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
                ...aiMessages,
                { role: 'assistant', content: content || '(prior work)' },
                {
                  role: 'user',
                  content: `[SYSTEM] You just said you would write or save something, but you did NOT call file_write or save_to_article. You MUST call file_write NOW with the full content. Do not search again. Do not output transition text. Call file_write with the complete itinerary/plan content.`,
                },
              ];
              const contText = await withSpan('llm.action_retry', 'llm', async (span) => {
                span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
                span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
                span.setAttribute('gen_ai.usage.total_cost', 0);
                span.setAttribute('llm.input_messages', JSON.stringify(contMessages));
                const contPolicy = this.getToolPolicy();
                const contResult = streamText({
                  model,
                  messages: contMessages as unknown as ModelMessage[],
                  tools: createAiSdkTools(
                    this.toolRegistry!,
                    this.toolExecutor!,
                    this.sessionId,
                    (e) => this.emit(e),
                    async () => 'continue',
                    (instruction, toolsList, timeout, background) =>
                      this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                    undefined,
                    span,
                    contPolicy.allowedIds,
                    (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
                  ),
                  stopWhen: stepCountIs(Math.min(stepBudget, 40)),
                  toolChoice: contPolicy.choice,
                  ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
                });
                // Reset before consuming — see the identical comment on the transition-phrase
                // continuation above; without this the continuation's text gets silently
                // glued onto the prior "I'll write it now" transition text with no separator.
                streamHandler.reset();
                await consumeStreamWithWatchdog(contResult.fullStream, (chunk) => streamHandler.handleEvent(chunk));
                return (streamHandler.getState().accumulatedContent || '').trim();
              });
              if (contText) content = contText;
            } catch (contErr) {
              if (contErr instanceof Error && contErr.name === 'AbortError') throw contErr;
              getLogger().warn('AGENT', `Action transition continuation failed: ${contErr instanceof Error ? contErr.message : String(contErr)}`);
            }
          } else {
            getLogger().info(
              'AGENT',
              'Action transition detected without deliverable tool — converting to user confirmation ask',
            );
            const askSuffix =
              '\n\nWant me to save this as an Article now? Reply yes to save, or no to leave it in chat only.';
            if (!/want me to save this as an article/i.test(content)) {
              content = `${content.trim()}${askSuffix}`;
            }
          }
        }
      }

      if (!content) {
        content = 'I was unable to generate a response. This model may not support function calling — switch to a tool-capable model and try again.';
      }

      // Avoid awaiting the usage promise when the stream was stalled; it may never resolve.
      const usage = stalled ? undefined : await result.usage;
      if (usage) {
        span.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens ?? 0);
        span.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens ?? 0);
      }
      span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content }]));
      span.setAttribute('agent.tool_call_count', this.toolCallLogForReflection.length);
      void result.response?.then(
        (res: { modelId?: string; finishReason?: string } | undefined) => {
          if (res?.modelId) span.setAttribute('gen_ai.response.model', res.modelId);
          if (res?.finishReason) span.setAttribute('gen_ai.response.finish_reason', res.finishReason);
        },
        () => { /* best-effort */ },
      );

      this.sessionLogger?.log({
        type: 'llm_response',
        data: {
          round: 0,
          content: content.slice(0, 1000),
          usage: usage ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } : null,
        },
      });

      // Do not finalize the parent turn while sub-agents still run.
      // Even if the model set background:true, keep the turn alive until they finish
      // (unless the user cancelled). Notify-me fire-and-forget still gets end-of-turn wait
      // for in-chat missions so the main agent can merge results.
      const mergeOutstandingSubAgents = async (): Promise<void> => {
        if (this.userCancelledTurn || this.options.delegatedWorker || !this.subAgents.hasOutstandingWork()) {
          return;
        }
        getLogger().info('AGENT', 'Waiting for outstanding sub-agents before finalizing turn');
        this.emit({ type: 'loading_start', stage: 'execution' });
        const finished = await this.subAgents.awaitOutstanding();
        const summaries = finished
          .filter((t) => t.status === 'completed' || t.status === 'failed')
          .map((t) => {
            const status = t.status === 'completed' ? 'OK' : 'FAILED';
            const body = (t.result || t.status).slice(0, 1200);
            return `### Sub-agent ${t.id.slice(0, 8)} [${status}]\n${body}`;
          });
        if (summaries.length > 0) {
          content = `${content.trim()}\n\n## Sub-agent results\n\n${summaries.join('\n\n')}`.trim();
        }
      };
      await mergeOutstandingSubAgents();

      // Diamond completion gate: never end while TASKS are open or a multi-task
      // request never got a full checklist. Traditional coded loop — not prompt-only.
      // Skip when the user deferred/skipped leftover todos for a new question.
      const skipCompletionGate = this.todoDispositionThisTurn === 'defer'
        || this.todoDispositionThisTurn === 'skip'
        || this.goalContinuationThisTurn;
      if (!this.userCancelledTurn && !this.options.delegatedWorker && !this.isDelegatedWorker && !skipCompletionGate) {
        let completionRound = 0;
        while (completionRound < MAX_COMPLETION_CONTINUATIONS) {
          const gate = evaluateTurnCompletionGate({
            todos: this.todoManager.getItems(),
            userText: lastUserText,
            completionRound,
            exemptGoalContinuation: this.goalContinuationThisTurn,
          });
          if (!gate.block) break;

          this.todoManager.ensureActiveWork(Math.max(1, Math.min(this.maxSubAgents, 4)));
          await mergeOutstandingSubAgents();

          // Re-check after sub-agents finished — model may have left todos stale;
          // still force a continuation so statuses / remaining work are reconciled.
          const gateAfterWait = evaluateTurnCompletionGate({
            todos: this.todoManager.getItems(),
            userText: lastUserText,
            completionRound,
            exemptGoalContinuation: this.goalContinuationThisTurn,
          });
          if (!gateAfterWait.block) break;

          const reason = gateAfterWait.reason;
          completionRound += 1;
          getLogger().warn(
            'AGENT',
            `Completion gate round ${completionRound}/${MAX_COMPLETION_CONTINUATIONS}: ${reason.kind}`
            + (reason.kind === 'incomplete_todos'
              ? ` (${reason.incomplete.length} open / ${reason.total} total)`
              : ` (estimated ${reason.estimatedTasks}, checklist ${reason.checklistSize})`),
          );
          this.emit({
            type: 'task_progress',
            status: 'completion_gate',
            description: reason.kind === 'incomplete_todos'
              ? `Finishing ${reason.incomplete.length} remaining checklist item(s)`
              : `Building full checklist for ~${reason.estimatedTasks} user tasks`,
            details: { round: completionRound, reason: reason.kind },
          });
          this.emit({ type: 'loading_start', stage: 'execution' });

          const contPrompt = buildCompletionContinuationPrompt(reason);
          try {
            const contMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
              ...aiMessages,
              { role: 'assistant', content: content || '(prior work in progress)' },
              { role: 'user', content: contPrompt },
            ];
            const contentBefore = content;
            const contAccum = await withSpan('llm.continuation', 'llm', async (span) => {
              span.setAttribute('gen_ai.system', this.config.provider.activeProvider);
              span.setAttribute('gen_ai.request.model', this.config.provider.activeModel);
              span.setAttribute('gen_ai.usage.total_cost', 0);
              span.setAttribute('llm.input_messages', JSON.stringify(contMessages));
              const contPolicy = this.getToolPolicy();
              const contTools = createAiSdkTools(
                this.toolRegistry!,
                this.toolExecutor!,
                this.sessionId,
                (e) => this.emit(e),
                async () => 'continue',
                (instruction, toolsList, timeout, background) =>
                  this.runDelegatedSubAgent(instruction, toolsList, timeout ?? 120_000, background),
                undefined,
                span,
                contPolicy.allowedIds,
                (toolId, args) => this.codingTurnGuard?.checkToolCall(toolId, args, this.currentCategory) ?? null,
              );
              const contResult = streamText({
                model,
                messages: contMessages as unknown as ModelMessage[],
                tools: contTools,
                abortSignal: this.abortSignal,
                maxRetries: 1,
                maxOutputTokens: turnMaxOutputTokens,
                stopWhen: stepCountIs(Math.min(stepBudget, 40)),
                toolChoice: contPolicy.choice,
                ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
                prepareStep: async ({ stepNumber, messages }) => {
                  if (stepNumber === 0) return {};
                  const todosRev = this.todoManager.getRevision();
                  if (todosRev > this.lastTodosRevisionInjected && this.todoManager.getItems().length > 0) {
                    this.lastTodosRevisionInjected = todosRev;
                    return {
                      messages: [
                        ...messages,
                        { role: 'user' as const, content: this.todoManager.formatActiveBlock({
                          deferred: this.todoDispositionThisTurn === 'defer',
                        }) },
                      ],
                    };
                  }
                  return {};
                },
              });
              // Reset before consuming the completion-gate continuation stream — without
              // this, the handler accumulates on top of the prior response, and the
              // contAccum below already includes the prior content. The concatenation
              // logic at the call site would then either duplicate the prior content
              // (contAccum >= contentBefore branch) or glue two responses together
              // (the else branch), producing the contradictory concatenated message
              // documented in docs/engineering-crew/DESIGN.md Section 2.6.
              streamHandler.reset();
              await consumeStreamWithWatchdog(contResult.fullStream, (chunk) => {
                streamHandler.handleEvent(chunk);
                if (chunk.type === 'text-delta') {
                  this.partialTurnContent = streamHandler.getState().accumulatedContent;
                }
              });
              const output = (streamHandler.getState().accumulatedContent || '').trim();
              span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content: output }]));
              return output;
            });
            // After the reset above, contAccum is ONLY the continuation's text, not the
            // full accumulated buffer. Append it to the prior content — the continuation
            // is meant to complete/extend the prior response, not replace it.
            if (contAccum && contAccum !== contentBefore) {
              content = `${contentBefore}\n\n${contAccum}`.trim();
            }
          } catch (contErr) {
            if (contErr instanceof Error && contErr.name === 'AbortError') throw contErr;
            getLogger().warn(
              'AGENT',
              `Completion gate continuation failed: ${contErr instanceof Error ? contErr.message : String(contErr)}`,
            );
            break;
          }

          await mergeOutstandingSubAgents();
        }

        const stillOpen = getIncompleteTodos(this.todoManager.getItems());
        if (stillOpen.length > 0 && !this.userCancelledTurn) {
          getLogger().warn('AGENT', `Completion gate exhausted with ${stillOpen.length} items still open`);
          content = `${content.trim()}${buildIncompleteTurnFooter(stillOpen)}`.trim();
        }
      }

      if (!content.trim()) {
        content = 'I apologize, I was unable to generate a response.';
      }
      const streamState = streamHandler.getState();
      const outId = (streamState as { messageId?: string }).messageId
        ?? this.pendingVoiceMerge?.messageId
        ?? generateMessageId();
      const finalTokenCount = usage
        ? (usage.inputTokens || 0) + (usage.outputTokens || 0)
        : Math.ceil(content.length / 4);
      // Stream handler toolExecutions can lag behind ToolLedger (ground truth from execute callback).
      const ledgerToolExecs = this.toolLedger.getEntries().map((e) => ({
        tool: e.name,
        success: e.success,
        output: e.output,
        elapsed: e.elapsed,
      }));
      const reflectionToolExecs = this.toolCallLogForReflection.map((t) => ({
        tool: t.name,
        success: t.success,
        output: t.output,
        elapsed: t.elapsed,
      }));
      const finalStreamToolExecs = (streamState.toolExecutions?.length
        ? streamState.toolExecutions
        : ledgerToolExecs.length
          ? ledgerToolExecs
          : reflectionToolExecs);
      const toolParts = finalStreamToolExecs.map((e, i) => {
        const id = `ledger_${i}_${e.tool}`;
        return {
          type: 'tool' as const,
          id,
          tool: {
            id,
            name: e.tool,
            args: {},
            status: e.success ? 'done' : 'error',
            result: e.output,
            elapsed: e.elapsed,
          },
        };
      });
      const textPart = content.trim()
        ? [{ type: 'text' as const, id: `text_${outId}`, content }]
        : [];
      const toolCalls = finalStreamToolExecs.length > 0
        ? finalStreamToolExecs.map((e, i) => ({
            id: `ledger_${i}_${e.tool}`,
            name: e.tool,
            arguments: '{}',
            result: e.output,
          }))
        : null;
      let finalMessage = this.tagCrewPrivateAssistant({
        id: outId,
        sessionId: this.sessionId,
        role: 'assistant' as const,
        content,
        toolCalls,
        createdAt: new Date().toISOString(),
        tokenCount: finalTokenCount,
        ...(toolParts.length || textPart.length
          ? { parts: [...toolParts, ...textPart] }
          : {}),
      });
      let richPartAttached = false;
      try {
        const rich = applyRichResponsePolicy(this.sessionId, finalMessage, {
          category: this.currentCategory?.primary,
          outputMode: this.currentOutputMode,
          voiceTurn: this.currentVoiceTurn,
        });
        finalMessage = rich.message;
        richPartAttached = rich.decision.attached;
        if (rich.decision.mode !== 'off') {
          const parity = rich.decision.parity == null ? '' : ` parity=${rich.decision.parity.toFixed(3)}`;
          getLogger().debug(
            'RICH_RESPONSE',
            `mode=${rich.decision.mode} selected=${rich.decision.selected} attached=${rich.decision.attached}`
              + ` reason=${rich.decision.reason} elapsedMs=${rich.decision.elapsedMs}${parity}`,
          );
        }
      } catch (richError) {
        // Presentation enrichment is optional and must never fail the turn.
        getLogger().warn(
          'RICH_RESPONSE',
          `compiler-bypassed error=${richError instanceof Error ? richError.message : String(richError)}`,
        );
      }

      // The stream handler may have emitted before completion-gate healing. Re-emit
      // a stable-ID update when final content changed or a rich snapshot was attached.
      const contentChangedAfterStream = content.trim() !== streamState.accumulatedContent.trim();
      const mustEmitFinal = !this._turnMessageEmitted
        || streamState.deferredEmptyFinalize
        || contentChangedAfterStream
        || richPartAttached;
      if (mustEmitFinal) {
        this.emit({ type: 'stream_chunk', content: '', fullContent: content });
        this.emit({
          type: 'message_received',
          message: finalMessage,
          elapsed: Date.now() - startTime,
          ...(this._turnMessageEmitted ? { isUpdate: true } : {}),
        }, this._turnMessageEmitted);
      }

      // Stream handler already emitted message_received in its finish case (or we did above).
      // Only push assistant content — tool ledger is persisted via persistToolLedger (not in agent history).
      this.messages.push({ role: 'assistant', content });
      await this.compactContext();
      await this.reinforceMemoryContext();

      return finalMessage;
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
      if (error instanceof Error && error.message === CLARIFICATION_AWAITING_USER) {
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
      this.toolExecutor?.setKbDocumentTurnPolicy(null);
    }
  }, {
    'trace.domain': 'AGENT',
    'trace.kind': 'turn',
    'session.id': this.sessionId,
    'turn.id': this.currentTurnId ?? `turn-${startTime}`,
    'user.text': lastUserText,
    'agent.id': this.currentTurnId ?? `turn-${startTime}`,
    'gen_ai.system': this.config.provider.activeProvider,
    'gen_ai.request.model': this.config.provider.activeModel,
  });
}

  /**
   * Execute a single plan step as a self-contained completion.
   */
  /**
   * Extract memorable facts from the exchange and persist them.
   * Runs asynchronously and silently — never blocks the main flow.
   */
  private extractMemories(userMessage: string, assistantResponse: string): void {
    // Skip memory extraction in light thinking mode — saves a model call for quick turns.
    if (THINKING_MODE_SKIP_EXTRACT_MEMORIES[this.currentThinkingMode]) return;
    extractMemoriesHelper(
      {
        config: this.config,
        provider: this.provider,
        memoryFabric: this.memoryFabric,
        memoryEmbedder: this.memoryEmbedder,
        chatTurnMemoryIngester: this.chatTurnMemoryIngester,
        setChatTurnMemoryIngester: (i) => { this.chatTurnMemoryIngester = i; },
        userChatMemoryIngester: this.userChatMemoryIngester,
        setUserChatMemoryIngester: (i) => { this.userChatMemoryIngester = i; },
        sessionId: this.sessionId,
        options: this.options,
        speakerId: this.currentSpeaker?.id,
      } as MemoryExtractionContext,
      userMessage,
      assistantResponse,
    );
  }

  /** Store web/KB tool outputs in session memory for reuse on later turns. */
  private persistSessionToolFindings(userQueryHint: string): void {
    if (this.toolCallLogForReflection.length === 0) return;
    persistSessionToolFindingsHelper(
      {
        memoryFabric: this.memoryFabric,
        memoryEmbedder: this.memoryEmbedder,
        sessionFindingsIngester: this.sessionFindingsIngester,
        setSessionFindingsIngester: (i) => { this.sessionFindingsIngester = i; },
        sessionId: this.sessionId,
        options: this.options,
      },
      this.toolCallLogForReflection.map((t) => ({
        name: t.name,
        success: t.success,
        output: t.output,
      })),
      userQueryHint,
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
    return buildIdentityBlockHelper({
      persona: this.persona,
      options: this.options,
    });
  }

  setClientSituation(situation: ClientSituation | null): void {
    this.clientSituation = situation;
  }

  setCurrentSpeaker(speaker: VoiceSessionSpeaker | null): void {
    this.currentSpeaker = speaker;
  }

  getCurrentSpeaker(): VoiceSessionSpeaker | null {
    return this.currentSpeaker;
  }

  private speakerContextBlock(speaker: VoiceSessionSpeaker): string {
    if (speaker.isRoot) {
      const callsign = speaker.name ?? 'Root';
      return `[SPEAKER_CONTEXT]\nCurrent speaker: ${callsign} (root). This is the primary owner. Address them by their callsign "${callsign}" whenever you would address them.\n[/SPEAKER_CONTEXT]`;
    }
    if (speaker.recognized) {
      const name = speaker.name ?? 'friend';
      return `[SPEAKER_CONTEXT]\nCurrent speaker: ${name} (friend). You know this person. Address them by their name "${name}" when it is natural to do so.\n[/SPEAKER_CONTEXT]`;
    }
    return `[SPEAKER_CONTEXT]\nCurrent speaker: anonymous (stranger). You do not know this person. Be polite and respond as you would to a stranger. Do not use any saved personal context.\n[/SPEAKER_CONTEXT]`;
  }

  applyPersona(persona: AgentPersonaConfig | null): void {
    this.persona = persona;
    this.rebuildSystemPrompt();
  }

  getPersona(): AgentPersonaConfig | null {
    return this.persona;
  }

  private createSectionContext(): SectionContext {
    return {
      getProviderId: () => this.config.provider.activeProvider,
      getModelId: () => this.config.provider.activeModel,
      getUserMessage: () => this.currentUserMessage,
      getTurnCategory: () => this.currentCategory ?? { primary: 'general', sub: undefined, confidence: 0 },
      getCodebaseContext: () => this.codebaseContext,
      getTaskStateBlock: () => this.taskStateManager.formatStatusBlock(),
      buildIdentityBlock: () => this.buildIdentityBlock(),
      scopePath: this.scopePath,
      telegramConnected: this._telegramConnected,
      userCallsign: this.config.user?.callsign,
      userConfig: this.config.user,
      getUserTimezone: () => this.getUserTimezone(),
      getUtcOffset: () => this.getUtcOffset(),
      crewOrchestrator: this.crewOrchestrator ? {
        getMembers: () => this.crewOrchestrator!.getMembers(),
      } : null,
      enabledCrewSessionIds: this.enabledCrewSessionIds,
      reflectionLoop: this.reflectionLoop ? {
        getCumulativeLearnings: () => this.reflectionLoop.getCumulativeLearnings(),
      } : null,
      contextTracker: this.contextTracker ? {
        getContextSummary: () => this.contextTracker.getContextSummary(),
        getRecentHistory: () => this.contextTracker.getRecentHistory(),
      } : null,
      personaName: this.persona?.name || 'Agent-X',
      turnFeedbackService: { buildPromptContext: () => this.turnFeedbackService.buildPromptContext(this.sessionId) },
      memoryContext: { getContext: () => this.buildMemoryContext() },
      getPersona: () => this.persona,
      getClientSituation: () => this.clientSituation,
      linkedContextBlock: () => this.buildLinkedContextPromptBlock(),
      contextKind: this.options.contextKind,
      sessionId: this.sessionId,
      promptProfile: this.options.promptProfile,
      getTodos: () => this.todoManager.getItems(),
      areTodosDeferredThisTurn: () => this.todoDispositionThisTurn === 'defer',
      bypassPermissions: this.bypassPermissions,
      thinkingMode: this.currentThinkingMode,
      outputMode: this.currentOutputMode,
      getHarnessPromptBlock: () => getHarnessService().getPromptBlock(this.sessionId),
      getGoalPromptBlock: () => getGoalService().getPromptBlock(this.sessionId),
      getExecutableSkillsPromptBlock: () => {
        const registry = getExecutableSkillRegistry();
        if (!registry.isEnabled()) return '';
        if (registry.list().length === 0) {
          registry.refresh(this.scopePath ?? this.config.workspacePath);
        }
        return registry.getMetadataPromptBlock();
      },
      getCapabilitiesPromptBlock: () => getRuntimeCapabilityManager()?.getPromptBlock() ?? '',
    };
  }

  isCompactionInFlight(): boolean {
    return this.compactionInFlight;
  }

  private syncDurableTurnStart(turnId: string): void {
    const durable = getDurableTurnStore();
    if (!durable.isEnabled()) return;
    void getSessionGenerationManager()
      .getGeneration(this.sessionId)
      .then((generation) => durable.create(this.sessionId, generation, turnId))
      .then(() => durable.updateStatus(turnId, 'running'))
      .catch(() => { /* best-effort */ });
  }

  private syncDurableTurnFinish(status: 'complete' | 'error' | 'cancelled'): void {
    const durable = getDurableTurnStore();
    if (!durable.isEnabled() || !this.currentTurnId) return;
    void durable
      .updateStatus(this.currentTurnId, status, this.partialTurnContent || undefined)
      .catch(() => { /* best-effort */ });
  }

  async refineHarness(instructions?: string, scope: 'local' | 'global' = 'local'): Promise<{ ok: boolean; error?: string }> {
    const trajectory = this.messages.slice(-24).map((m) => `${m.role}: ${String(m.content ?? '').slice(0, 500)}`).join('\n');
    const result = await getHarnessService().refine(this.sessionId, {
      scope,
      instructions,
      trajectorySummary: trajectory,
      isCompactionInFlight: () => this.isCompactionInFlight(),
      complete: (prompt) => this.runSimpleComplete(prompt),
    });
    return { ok: result.ok, error: result.error };
  }

  private maybeEnqueueFollowUpAgentMessages(): void {
    if (!this.followUpAgentMessages.length || this.lifecycle.isProcessing()) return;
    if (this.isSessionPausedForUserInput()) return;
    const prompt = this.followUpAgentMessages.join('\n\n');
    this.followUpAgentMessages = [];
    setTimeout(() => {
      if (this.lifecycle.isProcessing() || this.isSessionPausedForUserInput()) return;
      void this.sendMessage('', { userMessagePersisted: false, instruction: prompt });
    }, 400);
  }

  private mergeInterAgentAutoBlocksIntoPendingInstruction(): void {
    if (!this.interAgentAutoBlocks.length) return;
    const block = `[INTER_AGENT_MESSAGES]\n${this.interAgentAutoBlocks.join('\n---\n')}\n[/INTER_AGENT_MESSAGES]`;
    this.pendingInstruction = this.pendingInstruction
      ? `${this.pendingInstruction}\n\n${block}`
      : block;
    this.interAgentAutoBlocks = [];
  }

  private async injectSyntheticIntelligenceTurn(userText: string): Promise<void> {
    try {
      const mgr = getRuntimeCapabilityManager();
      if (!mgr) return;
      const note = await mgr.prepareTurn(userText, this.sessionId);
      if (!note) return;
      this.pendingInstruction = this.pendingInstruction
        ? `${this.pendingInstruction}\n\n${note}`
        : note;
    } catch (err) {
      getLogger().warn('SI_TURN', err instanceof Error ? err.message : String(err));
    }
  }

  private buildInterAgentDeliveryContext(): InterAgentDeliveryContext {
    return {
      sessionId: this.sessionId,
      isProcessing: () => this.lifecycle.isProcessing(),
      appendAutoBlock: (text) => {
        this.interAgentAutoBlocks.push(text);
      },
      queueFollowUp: (text) => {
        this.followUpAgentMessages.push(text);
      },
      steer: (instruction) => {
        if (!this.steerHandler.handleSessionSteer(this.sessionId, instruction)) return false;
        if (this.lifecycle.isProcessing()) {
          this.userCancelledTurn = true;
          this.cancel();
          setTimeout(() => {
            void this.sendMessage('', { userMessagePersisted: false, instruction });
          }, 200);
        }
        return true;
      },
      emitAgentMessage: (msg) => {
        incrementAdoptionMetric('agent_messages_delivered_total');
        this.emit({
          type: 'agent_message',
          message: msg as unknown as Record<string, unknown>,
        });
      },
    };
  }

  private async processInboundInterAgentMessages(): Promise<void> {
    try {
      await processPendingInterAgentMessages(this.buildInterAgentDeliveryContext());
    } catch (e) {
      getLogger().warn('INTER_AGENT', e instanceof Error ? e.message : String(e));
    }
  }

  async deliverInterAgentMessage(msg: AdoptionAgentMessage): Promise<void> {
    if (!isInterAgentMessagingEnabled()) return;
    const wasProcessing = this.lifecycle.isProcessing();
    await deliverInterAgentMessage(this.buildInterAgentDeliveryContext(), msg);
    if (!wasProcessing) {
      if (msg.deliveryMode === 'follow_up') {
        this.maybeEnqueueFollowUpAgentMessages();
      } else if (msg.deliveryMode !== 'steer') {
        this.mergeInterAgentAutoBlocksIntoPendingInstruction();
        const instr = this.pendingInstruction;
        if (instr) {
          this.pendingInstruction = null;
          void this.sendMessage('', { userMessagePersisted: false, instruction: instr });
        }
      }
    }
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
        personaName: this.persona?.name,
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

    // MoE Prompt Assembler is the only prompt system — always use it.
    const gen = await this.promptAssembly.assemble();
    this.emit({
      type: 'prompt_section_inventory',
      sections: gen.sections,
    });
    const dynamicAndCategory = [gen.dynamicSuffix, gen.categoryOverlay].filter(Boolean).join('\n\n');
    const prompt = [gen.staticPrefix, CACHE_BOUNDARY_MARKER, dynamicAndCategory].filter(Boolean).join('');
    this.setSystemPrompt(prompt);
  }

  switchProvider(providerId: ProviderId, apiKey?: string, baseUrl?: string, options?: { apiType?: string; displayName?: string }): void {
    const wasCompact = this.usesCompactContext();
    this.provider = ProviderFactory.create(providerId, apiKey, baseUrl, options);
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
    const ctx = this._permissionCtx();
    bindPermissionHandlerHelper(ctx);
    // Capture values the helper set on the ctx so they persist across _permissionCtx() calls.
    this.permissionQueue = ctx.permissionQueue;
    this.processPermissionQueueFn = ctx.processPermissionQueue;
    this.bindActionConsentHandlers();
  }

  /**
   * Clarify-first + inline outcome chips: before any permission modal, ask
   * "Shall I …?" via questionnaire; persist each decision as a chat part.
   */
  private bindActionConsentHandlers(): void {
    if (!this.toolExecutor) return;

    this.toolExecutor.setActionConsentHandler(async (toolId, args, definition) => {
      const summary = summarizeToolAction(toolId, args, definition);
      const questionnaire: QuestionnairePayload = {
        id: generateMessageId(),
        title: 'Confirm action',
        questions: [{
          id: 'consent',
          prompt: `Shall I ${summary}?`,
          type: 'single_choice',
          required: true,
          allowCustom: false,
          options: [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
          ],
        }],
        source: this.clarificationSource(),
      };
      try {
        const answer = await this.waitForQuestionnaireResponse(questionnaire);
        const proceed = isAffirmativeConsentAnswer(answer);
        return { proceed, answer };
      } catch {
        return { proceed: false, answer: '' };
      }
    });

    this.toolExecutor.setPermissionOutcomeHandler((outcome) => {
      this.persistAndEmitPermissionOutcome(outcome);
    });
  }

  private persistAndEmitPermissionOutcome(outcome: PermissionOutcomeEmit): void {
    const decidedAt = new Date().toISOString();
    const record: PermissionOutcomeRecord = {
      toolId: outcome.toolId,
      toolName: outcome.toolName,
      path: outcome.path,
      riskLevel: outcome.riskLevel,
      decision: outcome.decision,
      label: outcome.label,
      instruction: outcome.instruction,
      actionSummary: outcome.actionSummary,
      decidedAt,
    };
    const messageId = generateMessageId();
    const msg: Message = {
      id: messageId,
      sessionId: this.sessionId,
      role: 'assistant',
      content: '',
      toolCalls: null,
      createdAt: decidedAt,
      tokenCount: 0,
      parts: [{ type: 'permission', id: messageId, permission: record }],
    };
    persistAssistantMessageHelper(this.persistenceCtx(), msg);
    this.emit({
      type: 'message_received',
      message: msg,
      elapsed: 0,
    });
    this.emit({
      type: 'permission_resolved',
      tool: outcome.toolId,
      path: outcome.path,
      riskLevel: outcome.riskLevel,
      decision: outcome.decision,
      label: outcome.label,
      instruction: outcome.instruction,
      actionSummary: outcome.actionSummary,
      decidedAt,
    });
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
    this.toolExecutor?.getPermissionManager().revokeOneTimePermissions();
    this.toolExecutor?.clearToolConsent();
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

  /** End the session — clear ephemeral turn context. */
  endSession(): void {
    unregisterCompactionFileTracker(this.sessionId);
    endSessionHelper(this._sessionLifecycleCtx());
  }

  private _sessionLifecycleCtx(): SessionLifecycleContext {
    return {
      contextTracker: this.contextTracker,
    };
  }

  /**
   * Simple non-streaming completion for internal tasks (summarization, memory extraction).
   */
  async runSimpleComplete(prompt: string): Promise<string> {
    return this.simpleComplete(prompt);
  }

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
  get reflectionLoopInstance(): ReflectionLoop { return this.reflectionLoop; }
  /** Exposed for diagnostics — returns the pending checkpoint if any. */
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
        isRefineInFlight: () => getHarnessService().isRefineInFlight(this.sessionId),
        getCompactionFileSet: () => {
          const snap = this.compactionFileTracker.snapshot();
          if (snap.filesRead.length || snap.filesModified.length) return snap;
          const fromHistory = findLatestCompactionFileSet(this.messages as never);
          if (fromHistory) {
            this.compactionFileTracker.restore(fromHistory);
            return this.compactionFileTracker.snapshot();
          }
          return snap;
        },
        onCompactionComplete: (fileSet) => {
          this.emit({
            type: 'compaction_artifact',
            filesRead: fileSet.filesRead,
            filesModified: fileSet.filesModified,
          });
          this.compactionFileTracker.clear();
          reviewAutoRefine(this, 'compaction');
        },
        onCompactionArtifact: (artifact) => {
          try {
            this.sessionManager?.persistSessionFields?.(this.sessionId, {
              lastCompactionArtifact: artifact,
            });
          } catch { /* best-effort */ }
        },
        setCompactionInFlight: (v) => { this.compactionInFlight = v; },
      } as CompactContext,
      promptEstimate,
    );
  }

  /**
   * Pre-turn document materialization lives in DocumentPipeline —
   * attachments are OCR'd / quality-gated before the LLM loop starts.
   */

  private async buildAiMessagesForTurn(opts: {
    lastUserText: string;
    compact: boolean;
    integrationHint?: string;
  }): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string; attachments?: import('@agentx/shared').NormalizedAttachment[] }>> {
    const service = getAttachmentService();
    let lastUserIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]!.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const visionOk = this.modelSupportsVision();
    const pendingCleanups: string[] = [];
    const messagesWithDocs = await Promise.all(this.messages.map(async (m, idx) => {
      if (m.role !== 'user' || idx !== lastUserIdx) return m;
      const docParts: string[] = [];
      const existingAttachments = (m as { attachments?: import('@agentx/shared').NormalizedAttachment[] }).attachments ?? [];
      const extraAttachments: import('@agentx/shared').NormalizedAttachment[] = [];
      for (const a of existingAttachments) {
        if (a.type === 'folder') {
          if (a.content && a.content.length > 0) {
            docParts.push(a.content);
          } else {
            docParts.push(
              `[Attached workspace folder: ${a.name}]\nExplore this directory with filesystem tools for the user's request.`,
            );
          }
          continue;
        }
        if (a.type !== 'file') continue;

        let absAttachmentPath: string | null = null;
        if (a.storageId) {
          absAttachmentPath = await service.resolveAttachmentPath(a.storageId);
        }
        let candidateText: string | null = null;
        if (a.content && a.content.length > 0) {
          candidateText = a.content;
        } else if (a.storageId) {
          candidateText = await service.extractTextForAgent(a.storageId);
        }

        const doc = await materializeAttachment({
          name: a.name,
          mimeType: a.mimeType,
          absPath: absAttachmentPath,
          candidateText,
          storageId: a.storageId,
          attachmentId: a.id,
          visionOk,
          getBuffer: a.storageId
            ? async () => service.getBuffer(a.storageId!)
            : undefined,
        });
        pendingCleanups.push(...doc.cleanupDirs);
        docParts.push(doc.promptBlock);
        extraAttachments.push(...doc.visionAttachments);
      }
      if (docParts.length === 0 && extraAttachments.length === 0) return m;
      return {
        ...m,
        content: `${m.content}\n\n${docParts.join('\n\n')}`,
        attachments: [...existingAttachments, ...extraAttachments],
      };
    }));
    if (pendingCleanups.length > 0) {
      cleanupDocumentTemps([{
        name: '',
        path: null,
        mimeType: '',
        text: null,
        method: 'none',
        confidence: 'none',
        warnings: [],
        promptBlock: '',
        visionAttachments: [],
        cleanupDirs: pendingCleanups,
      }]);
    }
    const aiMessages = buildCompletionMessages(
      messagesWithDocs.map((m) => ({
        role: m.role,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
        attachments: (m as { attachments?: import('@agentx/shared').NormalizedAttachment[] }).attachments,
      })),
      opts.compact,
      3,
      this.config.provider.activeProvider,
    ).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      attachments: m.attachments,
    }));

    if (this.pendingInstruction) {
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { ...userMsg!, content: `${userMsg.content}\n\n[INSTRUCTION]\n${this.pendingInstruction}\n[/INSTRUCTION]` };
      }
      this.pendingInstruction = null;
    }

    const turnCtx = this.prepareTurnContext(opts.lastUserText);
    if (turnCtx.block) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[TURN CONTEXT]')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${turnCtx.block}\n\n${userMsg.content}` };
      }
    }

    if (this.clientSituation) {
      const situationBlock = formatClientSituationBlock(this.clientSituation);
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[CLIENT_SITUATION]')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${situationBlock}\n\n${userMsg.content}` };
      }
    }

    if (this.currentSpeaker) {
      const speakerBlock = this.speakerContextBlock(this.currentSpeaker);
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[SPEAKER_CONTEXT]')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${speakerBlock}\n\n${userMsg.content}` };
      }
    }

    if (opts.integrationHint) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[INTEGRATION')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${opts.integrationHint}\n\n${userMsg.content}` };
      }
    }

    if (this.lastRagResults.length > 0) {
      const hits = opts.compact ? this.lastRagResults.slice(0, 3) : this.lastRagResults;
      const ragCtx = buildRagContext(hits);
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { ...userMsg!, content: `${ragCtx}\n\n${userMsg.content}` };
      }
    }

    if (this.lastJourneyBlock) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[TURN_JOURNEY]')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${this.lastJourneyBlock}\n\n${userMsg.content}` };
      }
    }

    if (this.lastMentionContextBlock) {
      const userIdx = aiMessages.findLastIndex((m) => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg && !userMsg.content.includes('[PINNED ARTICLE]') && !userMsg.content.includes('[PINNED SESSION]')) {
        aiMessages[userIdx] = { ...userMsg!, content: `${this.lastMentionContextBlock}\n\n${userMsg.content}` };
      }
    }

    return aiMessages;
  }

  private modelSupportsVision(): boolean {
    const modelId = this.config.provider.activeModel;
    const caps = this.cachedModelInfo.get(modelId)?.capabilities ?? [];
    if (caps.includes('vision')) return true;
    const combined = `${this.config.provider.activeProvider} ${modelId}`.toLowerCase();
    return /gpt-4o|gpt-4-turbo|claude-3|claude-4|gemini|llava|vision|pixtral|gpt-5|o4-mini/.test(combined);
  }

  private async buildSdkMessages(
    aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; attachments?: import('@agentx/shared').NormalizedAttachment[] }>,
  ): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: unknown }>> {
    const service = getAttachmentService();
    const visionOk = this.modelSupportsVision();
    const results = [] as Array<{ role: 'user' | 'assistant' | 'system'; content: unknown }>;
    for (const m of aiMessages) {
      const imageAttachments = m.attachments?.filter((a) => a.type === 'image');
      if (m.role === 'user' && imageAttachments && imageAttachments.length > 0) {
        if (!visionOk) {
          const names = imageAttachments.map((a) => a.name).filter(Boolean).join(', ') || 'image';
          results.push({
            role: m.role,
            content: `${m.content}\n\n[Attached image(s) omitted: ${names}. Current model does not support vision — switch to a vision-capable model.]`,
          });
          continue;
        }
        const parts: unknown[] = [{ type: 'text', text: m.content }];
        for (const img of imageAttachments) {
          let dataUrl = img.content;
          if (!dataUrl && img.storageId) {
            const buffer = await service.getBuffer(img.storageId);
            if (buffer) {
              dataUrl = `data:${img.mimeType};base64,${buffer.toString('base64')}`;
            }
          }
          const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const base64 = match[2]!;
            const buffer = Buffer.from(base64, 'base64');
            parts.push({ type: 'image', image: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), mimeType: mime } as any);
          }
        }
        results.push({ role: m.role, content: parts });
      } else {
        results.push({ role: m.role, content: m.content });
      }
    }
    return results;
  }

  /** Compact history when needed and ensure the prompt leaves room for model output. */
  private async ensureOutputBudget(
    aiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; attachments?: import('@agentx/shared').NormalizedAttachment[] }>,
    tools: Record<string, unknown>,
    rebuild: () => Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string; attachments?: import('@agentx/shared').NormalizedAttachment[] }>>,
  ): Promise<{ messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; attachments?: import('@agentx/shared').NormalizedAttachment[] }>; maxOutputTokens: number }> {
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
        messages = await rebuild();
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
    messages: Array<{ content: string; attachments?: Array<{ type?: string }> }>,
    tools: Record<string, unknown>,
  ): number {
    const textTokens = estimatePromptTokens(
      messages,
      Object.keys(tools).length,
      this.estimateToolSchemaChars(tools),
    );
    // Vision tile packing varies by provider; reserve a conservative per-image budget
    // so ensureOutputBudget does not ignore multimodal payload size.
    let imageTokens = 0;
    for (const m of messages) {
      for (const a of m.attachments ?? []) {
        if (a.type === 'image') imageTokens += 1_700;
      }
    }
    return textTokens + imageTokens;
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
        // Attach any files the tool layer registered during this turn.
        const toolAttachments = this.toolExecutor?.getCollectedAttachments() ?? [];
        if (toolAttachments.length > 0) {
          const enriched = toolAttachments.map((a) => ({
            id: a.id,
            type: a.type,
            name: a.name,
            mimeType: a.mimeType ?? 'application/octet-stream',
            content: '',
            isInline: a.type === 'image',
          } as import('@agentx/shared').NormalizedAttachment));
          raw.message.attachments = [...(raw.message.attachments ?? []), ...enriched];
          this.toolExecutor?.clearCollectedAttachments();
        }
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
        this.eventBus.emit(this.sanitizeAttachments(event));
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
    this.eventBus.emit(this.sanitizeAttachments(event));
  }

  private sanitizeAttachments(event: EngineEvent): EngineEvent {
    const raw = event as { message?: { attachments?: Array<{ content?: unknown }> } };
    if (!raw.message?.attachments) return event;
    const sanitized = raw.message.attachments.map((a) => ({ ...a, content: '' }));
    return { ...event, message: { ...(raw.message as Record<string, unknown>), attachments: sanitized } } as EngineEvent;
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
    if (crewParticipationMode(this.options.contextKind, this.sessionId) === 'none') return [];
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
    if (enabled && crewParticipationMode(this.options.contextKind, this.sessionId) === 'none') {
      getLogger().warn('CREW', `Ignoring crew enable on crew-free session ${this.sessionId}`);
      return;
    }
    if (enabled) {
      this.enabledCrewSessionIds.add(crewId);
      const crew = this.crewManager.get(crewId);
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

  /**
   * Extract text from the latest user attachments for crew missions.
   * Ensures @file PDFs are available to specialists without brittle file_read/python loops.
   */
  async buildAttachmentContextForMission(): Promise<string> {
    const lastUser = [...this.messages].reverse().find((m) => m.role === 'user') as
      | { attachments?: import('@agentx/shared').NormalizedAttachment[] }
      | undefined;
    const attachments = lastUser?.attachments ?? [];
    if (attachments.length === 0) return '';

    const service = getAttachmentService();
    const parts: string[] = [];
    const cleanups: string[] = [];
    for (const a of attachments) {
      if (a.type === 'folder') {
        if (a.content) parts.push(a.content);
        continue;
      }
      if (a.type !== 'file') continue;
      let candidateText: string | null = a.content && a.content.length > 0 ? a.content : null;
      if (!candidateText && a.storageId) {
        candidateText = await service.extractTextForAgent(a.storageId);
      }
      let absPath: string | null = null;
      if (a.storageId) {
        absPath = await service.resolveAttachmentPath(a.storageId);
      }
      const doc = await materializeAttachment({
        name: a.name,
        mimeType: a.mimeType,
        absPath,
        candidateText,
        storageId: a.storageId,
        attachmentId: a.id,
        visionOk: false,
        getBuffer: a.storageId ? async () => service.getBuffer(a.storageId!) : undefined,
      });
      cleanups.push(...doc.cleanupDirs);
      parts.push(doc.promptBlock);
    }
    if (cleanups.length > 0) {
      cleanupDocumentTemps([{
        name: '', path: null, mimeType: '', text: null, method: 'none',
        confidence: 'none', warnings: [], promptBlock: '', visionAttachments: [], cleanupDirs: cleanups,
      }]);
    }
    return parts.length > 0 ? `[ATTACHED DOCUMENTS]\n${parts.join('\n\n')}\n[/ATTACHED DOCUMENTS]` : '';
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
        this.crewManager,
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

  /** Retune sub-agent + tool + turn-queue semaphores from the Performance profile. */
  applyPerformanceLanes(lanes: { subAgents: number; toolParallel: number; llmGlobal: number }): void {
    const sub = Math.max(1, Math.min(32, lanes.subAgents));
    const tools = Math.max(1, Math.min(32, lanes.toolParallel));
    this.maxSubAgents = sub;
    this.subAgents.setMaxConcurrent(sub);
    if (this.toolExecutor instanceof EnhancedToolExecutor) {
      this.toolExecutor.setMaxToolConcurrency(tools);
    }
    // CommandQueue also queues (never drops); size it with the LLM lane.
    this.commandQueue.setMaxConcurrent(Math.max(1, Math.min(16, lanes.llmGlobal)));
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
    // Idempotent — SubAgentManager registers before spawn; SmartSubAgent may call again.
    const existing = this.sessionManager.getSessionById(childId);
    if (!existing) {
      this.sessionManager.createChildSessionRecord(
        childId,
        this.sessionId,
        this.config.provider.activeProvider,
        this.config.provider.activeModel,
        this.scopePath,
        meta,
      );
    }
    this.eventBus.emit({
      type: 'child_session_started',
      childSessionId: childId,
      parentSessionId: this.sessionId,
      label: meta?.label ?? 'Background work',
      kind: meta?.kind ?? 'sub_agent',
    });
  }

  /**
   * Dispose the agent and cleanup all resources.
   * This is the proper shutdown sequence: cancel running tasks → stop sub-agents → 
   * flush operations → mark lifecycle as disposed.
   */
  dispose(): void {
    // Cancel any in-progress processing
    this.cancel();

    this.unregisterPerformanceTune?.();
    this.unregisterPerformanceTune = null;

    // Mark lifecycle as disposed to prevent new operations
    this.lifecycle.forceTransition('disposed');

    // Stop all sub-agents
    this.subAgents.cancelAll();

    // Stop pushing process lifecycle events into a session that's going away.
    // Also kill any non-detached processes this session started — detached processes
    // are intentionally left running (e.g. a user-started dev server they want to
    // keep after the session ends). This prevents orphaned child processes from
    // accumulating when an agent is disposed (design doc Section 4.6 lifecycle cleanup).
    const procRegistry = getAgentProcessRegistry();
    procRegistry.unregisterSessionEventBus(this.sessionId);
    const sessionProcs = procRegistry.getBySession(this.sessionId);
    for (const p of sessionProcs) {
      if (!p.detached) {
        getLogger().info('AGENT', `Disposing: killing PID ${p.pid} (${p.command}) for session ${this.sessionId}`);
        procRegistry.kill(p.pid);
      }
    }

    // Close file watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }
  }
}

export { Agent as AgentFacade };
