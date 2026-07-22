export { AgentLifecycle } from './agent/AgentLifecycle.js';
export type { AgentState, LifecycleListener } from './agent/AgentLifecycle.js';
export { ConfigManager } from './config/index.js';
export * from './tools/platform.js';
export { SessionManager } from './session/SessionManager.js';
export { hostCrewSnapshotPatch, hostCrewSnapshotFromInput } from './session/session-field-utils.js';
export type { SessionListKpis } from './session/session-field-utils.js';
export { TokenTracker } from './session/TokenTracker.js';

export { GitManager } from './session/GitManager.js';
export { FileWatcher } from './session/FileWatcher.js';
export { BackgroundQueue } from './session/BackgroundQueue.js';
export { InMemoryQueue } from './queue/InMemoryQueue.js';
export { PgBossQueue } from './queue/PgBossQueue.js';
export { JOB_NAMES } from './queue/job-names.js';
export { registerNoOpJobWorkers } from './queue/workers/index.js';
export { registerToolWorkers, createToolWorker } from './queue/workers/index.js';
export { registerMemoryWorkers, createMemoryWorker } from './queue/workers/index.js';
export { ModelRouter } from './session/ModelRouter.js';
export { RecipeEngine } from './session/RecipeEngine.js';
export { SessionLogger } from './session/SessionLogger.js';
export { LogCollector, getLogCollector, initLogCollector } from './logging/LogCollector.js';
export type { LogCollectorEvent } from './logging/LogCollector.js';
export { AgentBus, getAgentBus, setAgentBus } from './agent/AgentBus.js';
export type { AgentMessage, AgentSubscription } from './agent/AgentBus.js';
export { SpecialistRegistry } from './agent/SpecialistRegistry.js';
export type { Specialist, SpecialistType } from './agent/SpecialistRegistry.js';
export { SkillGenerator } from './agent/SkillGenerator.js';
export { BUNDLED_SKILLS, getBundledSkills, findBundledSkill } from './agent/BundledSkills.js';
export type { GeneratedSkill } from './agent/SkillGenerator.js';
export { ReflectionLoop } from './agent/ReflectionLoop.js';
export type { ReflectionResult } from './agent/ReflectionLoop.js';
export { Agent, AgentFacade } from './agent/Agent.js';
export type { AgentOptions } from './agent/Agent.js';
export type { CheckpointAction, FailureRecord, TaskExecutorResult, TaskPlan, TaskStep } from './agent/TaskExecutor.js';
export type { PartPersistFn } from './agent/AiSdkStreamHandler.js';
export { createAiSdkModel } from './agent/AiSdkBridge.js';
export {
  shouldForceNamedToolChoice,
  isUnsupportedToolChoiceError,
  toolChoiceModelKey,
} from './providers/tool-choice-policy.js';
export { summarizePermissionArgs } from './agent/agent-helpers.js';
export { ResponseFormatter } from './agent/ResponseFormatter.js';
export type { FormattedSegment } from './agent/ResponseFormatter.js';
export { SubAgentManager } from './agent/SubAgentManager.js';
export type { SubAgentTask } from './agent/SubAgentManager.js';
export { SubAgentService, getSubAgentServiceInstance, setSubAgentServiceInstance } from './agent/SubAgentService.js';
export type { SubAgentRecord } from './agent/SubAgentService.js';
export { SubAgentCache } from './agent/SubAgentCache.js';
export { SmartSubAgent } from './agent/SmartSubAgent.js';
export type { SmartSubAgentOptions, SmartSubAgentResult } from './agent/SmartSubAgent.js';
export { DecisionEngine } from './agent/DecisionEngine.js';
export type { MessageClass, ExecutionPath, DecisionResult } from './agent/DecisionEngine.js';
export { PromptEngine } from './prompt/PromptEngine.js';
export type { IntentResult, PromptBudget } from './prompt/PromptEngine.js';
export { AgentEventBus } from './EventBus.js';
export type { EventBus, EngineEvent, EventHandler, SessionEvent } from './events/EventBus.js';
export type { AgentEvent } from './events/AgentEvent.js';

export type { ServiceContext } from './services/ServiceContext.js';
export { createServiceContext, getChannelServiceInstance, setChannelServiceInstance } from './services/ServiceContext.js';

export { ToolService } from './services/tool/ToolService.js';
export { ToolCacheService } from './services/tool/ToolCacheService.js';
export { ToolPermissionService } from './services/tool/ToolPermissionService.js';
export type { IToolService, ToolCall } from './services/tool/IToolService.js';
export type { PermissionResult, ToolPermissionHost } from './services/tool/ToolPermissionService.js';
export type { IJobQueue, IJob, JobEnqueueOptions, JobContext, JobHandler } from './queue/IJobQueue.js';
export type { JobWorker } from './queue/workers/index.js';
export type { ICache } from './cache/ICache.js';
export { LocalCache } from './cache/LocalCache.js';
export { RedisCache } from './cache/RedisCache.js';
export type { RedisCacheOptions } from './cache/RedisCache.js';
export { configureHttpKeepAlive, getHttpAgent, getHttpsAgent } from './utils/http-agents.js';
export {
  MarkdownDocumentStore,
  setMarkdownDocumentStoreInstance,
  getMarkdownDocumentStoreInstance,
} from './markdown/MarkdownDocumentStore.js';
// Attachments
export { AttachmentService, getAttachmentService } from './attachments/index.js';

export { ProviderFactory } from './providers/index.js';
export type { ProviderInterface } from './providers/index.js';
export { OpenAIProvider } from './providers/OpenAIProvider.js';
export { AnthropicProvider } from './providers/AnthropicProvider.js';
export { OllamaProvider } from './providers/OllamaProvider.js';
export { GoogleProvider } from './providers/GoogleProvider.js';
export { LMStudioProvider } from './providers/LMStudioProvider.js';
export { CommandParser, CommandRegistry, createDefaultRegistry } from './commands/index.js';
export type { CommandInterface, CommandContext, CommandResult } from './commands/index.js';
export { ToolRegistry, ToolExecutor, EnhancedToolExecutor, PermissionManager, ScopeGuard } from './tools/index.js';
export { PythonRPCExecutor, getPythonRPC } from './tools/PythonRPCExecutor.js';
export type { PythonTask, PythonResult } from './tools/PythonRPCExecutor.js';
export { ScriptRPCExecutor, getScriptRPC, detectProjectStack } from './tools/ScriptRPCExecutor.js';
export type { ScriptLanguage, ScriptResult } from './tools/ScriptRPCExecutor.js';
export { createDefaultToolkit } from './tools/index.js';
export type { PermissionRequestHandler } from './tools/index.js';
export { IntegrationHub, createCustomProvider, importMcpConfig, parseMcpImportConfig, buildIntegrationActionPreview, ensureLoginShellPath } from './integrations/index.js';
export type { McpSession } from './integrations/index.js';
export { fileRead, fileWrite, fileDelete, folderCreate, folderDelete, folderList, folderMove } from './tools/index.js';
export { shellExec, shellBackground, processKill, processList, setShellSandbox } from './tools/index.js';
export { gitStatus, gitDiff, gitLog, gitCommit, gitAdd, gitBranch, gitCheckout, gitStash, gitBlame, gitShow } from './tools/index.js';
export { codeSearch, codeDefinitions, codeReplace, codeInsert, codeSymbols } from './tools/index.js';
export { packageInstall, packageRemove, packageList, packageOutdated, packageRun } from './tools/index.js';
export { testRun, testWatch, testCoverage, testCreate } from './tools/index.js';
export { jsonParse, jsonQuery, jsonSet, csvParse, textTransform } from './tools/index.js';
export { httpGet, httpPost, httpRequest, webScrape, webSearch } from './tools/index.js';
export { containerList, containerLogs, containerStart, containerStop, containerExec, containerRun, containerCompose, containerImages } from './tools/index.js';
export { dbQuery, dbSchema, dbExport, envRead } from './tools/index.js';
export { ghIssueList, ghIssueCreate, ghPrList, ghPrCreate, ghPrView, ghRepoView, ghWorkflowList, ghRelease } from './tools/index.js';
export { systemInfo, systemDiskSpace, systemEnv, systemWhich, systemPorts, systemTreeSize, securityAudit, securitySecrets, fileChecksum } from './tools/index.js';
export { browserOpen, browserScreenshot, browserClick, browserEval } from './tools/index.js';
export { agentXConfigSchema } from './config/ConfigSchema.js';
export * from './config/paths.js';
export { CrewManager } from './crew/CrewManager.js';
export type { CrewHostSnapshot } from './crew/CrewManager.js';
export { PersonaStore, getPersonaStore, setPersonaStore, DEFAULT_PERSONA } from './persona/PersonaStore.js';
export { TurnFeedbackService } from './feedback/index.js';
export type { TurnFeedbackStore } from './feedback/index.js';
export { MemoryFabric, DEFAULT_EMBEDDING_DIMENSION, setMemoryFabricInstance, getMemoryFabricInstance } from './neural/MemoryFabric.js';
export type { MemoryNode, MemoryEdge, MemoryNodeInput, MemoryEdgeInput, MemorySource, ContextAssemblyResult, MemoryNodeCategory, MemoryEdgeType, GraphWalkResult } from './neural/MemoryFabric.js';
export { MemoryExtractor, createLocalLLMExtractor } from './neural/MemoryExtractor.js';
export type { ExtractedMemory, ExtractionOptions, GenerateFn, ExtractProgressEvent, ExtractProgressFn } from './neural/MemoryExtractor.js';
export { isValidMemoryNode, validateAndFilter, shannonEntropy } from './neural/NodeValidator.js';
export type { ValidatableNode, ValidatableCategory, ExtractedCategory, ScaffoldCategory } from './neural/NodeValidator.js';
export { makeTextUnit, approxTokenCount, textUnitId } from './neural/TextUnit.js';
export type { TextUnit, TextUnitType, TextUnitSource } from './neural/TextUnit.js';
export { segmentText } from './neural/SemanticSegmenter.js';
export type { ContentType, SegmentOptions } from './neural/SemanticSegmenter.js';
export { assembleGraph } from './neural/GraphAssembler.js';
export type { TopologyMetrics, AssembleOptions, AssembledGraph } from './neural/GraphAssembler.js';
export { deterministicNodeId, normalizeForHash } from './neural/DeterministicId.js';
export { MemoryService as MemoryIngestionService } from './neural/MemoryService.js';
export type { IngestInput, IngestResult } from './neural/MemoryService.js';
export { MemoryService } from './services/memory/MemoryService.js';
export type { MemoryServiceOptions } from './services/memory/MemoryService.js';
export { MemoryCacheService } from './services/memory/MemoryCacheService.js';
export type { MemoryCacheServiceOptions } from './services/memory/MemoryCacheService.js';
export type { IMemoryService, MemoryContextState, AssembleContextOptions, ChatTurnIngestOptions, SearchOptions } from './services/memory/IMemoryService.js';
export { RagDocument } from './neural/RagDocument.js';
export type { Chunk, RagDocumentMetadata, RagDocumentOptions } from './neural/RagDocument.js';
export { parsePdf } from './neural/PdfParser.js';
export type { PdfParseResult } from './neural/PdfParser.js';
export { MemoryConsolidator } from './neural/MemoryConsolidator.js';
export type { ConsolidationOptions, ConsolidationResult } from './neural/MemoryConsolidator.js';
export { SynapticPlasticity } from './neural/SynapticPlasticity.js';
export { SystemCapabilityDetector } from './neural/SystemCapabilityDetector.js';
export type { SystemCapabilities } from './neural/SystemCapabilityDetector.js';
export { MODEL_CATALOG, getModelById, getModelsByTier, getCompatibleModels, getRecommendedModel } from './neural/ModelCatalog.js';
export type { ModelOption, ModelCapability } from './neural/ModelCatalog.js';
export { UnifiedLocalModelProvider, createUnifiedModelProvider } from './neural/UnifiedLocalModelProvider.js';
export type { UnifiedModelConfig } from './neural/UnifiedLocalModelProvider.js';
export { extractArticle } from './neural/ReadabilityExtractor.js';
export type { ExtractedArticle } from './neural/ReadabilityExtractor.js';
export { MemoryMigrationRunner } from './neural/MemoryMigrationRunner.js';
export type { Migration } from './neural/MemoryMigrationRunner.js';
export { setDeepSearchStageResult } from './search/pipeline.js';
export { LocalEmbeddingProvider } from './neural/LocalEmbeddingProvider.js';
export { OnnxEmbeddingProvider, setDefaultEmbeddingCacheDir, EMBEDDING_DIMENSION, setEmbedderInstance, getEmbedderInstance } from './neural/OnnxEmbeddingProvider.js';
export { vectorMemoryPrefetch } from './neural/VectorMemoryPrefetch.js';
export type { VectorMemoryPrefetchOptions, VectorMemoryPrefetchResult } from './neural/VectorMemoryPrefetch.js';
export {
  RETRIEVAL_DEFAULTS,
  getRetrievalSettings,
  setRetrievalOverrides,
  resetRetrievalOverrides,
  buildEmbedText,
  resolveEmbedTextForNode,
  applyScoreGate,
  heuristicRerank,
  mergeRrf,
  expandEvidenceNeighborhood,
  linkSimilarChunks,
  packEvidenceBlocks,
  formatEvidenceCitation,
  EMPTY_EVIDENCE_MARKER,
  runRetrievalEval,
  assertBaselineGate,
  loadFrozenBaseline,
} from './neural/retrieval/index.js';


export { UserChatMemoryIngester, USER_PROFILE_TAG, shouldExtractUserChatMemory } from './neural/UserChatMemoryIngester.js';
export type { UserChatMemoryFact } from './neural/UserChatMemoryIngester.js';
export { ChatTurnMemoryIngester, CHAT_MEMORY_TAG } from './neural/ChatTurnMemoryIngester.js';
export { backfillChatMemoryFromSessions } from './neural/ChatHistoryMemoryBackfill.js';
export { setLocalModelConfig } from './neural/LocalModelConfig.js';
export { LocalLLMJudge } from './neural/LocalLLMJudge.js';
export type { NodeCreatedEvent, SynapseConnectedEvent, NeuronActivatedEvent, BrainEvent, BrainEventListener } from './neural/BrainEventStreamer.js';
export { BrainEventStreamer, getGlobalBrainEventStreamer, setGlobalBrainEventStreamer } from './neural/BrainEventStreamer.js';
export type { BridgeGenerationOptions, BridgeResult } from './neural/CrossClusterBridgeGenerator.js';
export { CrossClusterBridgeGenerator } from './neural/CrossClusterBridgeGenerator.js';
export type { CleanupOptions, CleanupResult } from './neural/TestDataCleaner.js';
export { TestDataCleaner } from './neural/TestDataCleaner.js';
export type { DividerCleanupOptions, DividerCleanupResult } from './neural/DividerNodeCleaner.js';
export { DividerNodeCleaner } from './neural/DividerNodeCleaner.js';
export { sanitizeIngestText, isDividerOnlyNode, filterDividerNodes } from './neural/sanitizeIngestText.js';
export type { RagTriadScores, LocalLLMJudgeOptions } from './neural/LocalLLMJudge.js';
export { SkillTransfer } from './neural/SkillTransfer.js';
export type { SkillTransferOptions, SkillTransferResult } from './neural/SkillTransfer.js';
export { CognitiveBenchmark } from './neural/CognitiveBenchmark.js';
export type { BenchmarkRunOptions, BenchmarkRunResult as NeuralBenchmarkRunResult, BenchmarkEvent, BenchmarkProgress } from './neural/CognitiveBenchmark.js';
export * from './benchmark/index.js';
export { verifyOfflineMode } from './neural/OfflineModeVerifier.js';
export type { OfflineVerificationResult } from './neural/OfflineModeVerifier.js';
export { PiiRedactor } from './neural/PiiRedactor.js';
export type { PiiRedactionResult, PiiRedactorOptions } from './neural/PiiRedactor.js';
export { SecureVault } from './neural/SecureVault.js';
export type { VaultEntry, KeyProvider } from './neural/SecureVault.js';
export { BrainBackup } from './neural/BrainBackup.js';
export type { BrainBackupResult, BrainRestoreResult, BrainBackupOptions, BrainRestoreOptions } from './neural/BrainBackup.js';
export { locatePostgresBinaries } from './neural/PostgresBinaryLocator.js';
export { CrewOrchestrator, buildCrewPrivateIdentityPrompt, buildCrewPrivateFastReplyPrompt } from './agent/CrewOrchestrator.js';
export { CrewSuggestionService } from './crew/CrewSuggestionService.js';
export type { CrewCatalogStore } from './crew/CrewSuggestionService.js';
export { createCrewKeywordExpander, isExpertiseOpinionQuery, parseExpandedKeywords } from './crew/crew-keyword-expander.js';
export type { CrewKeywordExpandFn } from './crew/crew-keyword-expander.js';
export { filterSubstantiveMatches, hasSubstantiveKeywordMatch } from './crew/crew-match-quality.js';
export { catalogEntryToSummary } from './crew/catalog-summary.js';
export { getCrewSuggestionService, getCrewCatalogStoreFromEngine } from './crew/get-crew-store.js';
export { startBackgroundCatalogSeed, getCatalogSeedStatus } from './crew/catalog-seed-runner.js';
export { resetCatalogSeedInflight } from './crew/catalog-seed-state.js';
export type { CatalogSeedSnapshot, CatalogSeedStatus } from './crew/catalog-seed-state.js';
export {
  healDatabaseStore,
  startPeriodicDatabaseHeal,
  stopPeriodicDatabaseHeal,
  isMissingTableError,
  auditCriticalTables,
  CRITICAL_DB_TABLES,
} from './db/database-healer.js';
export type { DatabaseHealResult, CriticalTablesAudit } from './db/database-healer.js';
export { runMigrations } from './db/MigrationRunner.js';
export type { MigrationResult, AppliedMigration } from './db/MigrationRunner.js';
export { MIGRATION_FILES } from './db/migration-registry.js';
export {
  recruitCandidatesForMission,
  ensureHubCrewOnRoster,
  ensureCrewMembersOnRoster,
  type CrewCatalogRecruitStore,
} from './crew/crew-mission-deploy.js';
export { CrewMissionOrchestrator } from './agent/CrewMissionOrchestrator.js';
export { CrewWorker } from './agent/CrewWorker.js';
export type { CrewWorkerResult } from './agent/CrewWorker.js';
export { CrewMissionContext } from './agent/CrewMissionContext.js';
export type { CrewMember, CrewMessage, OrchestratorEvent } from './agent/CrewOrchestrator.js';
export { ContextTracker } from './agent/ContextTracker.js';
export type { ContextEntry } from './agent/ContextTracker.js';
export {
  SessionContextHandler,
  createSessionContextHandler,
  createCrewPrivateContextHandler,
  SessionNarrativeStore,
  globalNarrativeStore,
} from './context/index.js';
export type { SessionContextHandlerConfig, TurnInjectionResult } from './context/index.js';
export { OrchestrationPlanner } from './agent/OrchestrationPlanner.js';
export type { PlannedTask, ExecutionPhase, ExecutionPlan } from './agent/OrchestrationPlanner.js';
export { TelegramBridge, TelegramStore, getActiveTelegramBridge } from './telegram/index.js';
export type { TelegramConfig, TelegramBridgeStatus } from './telegram/index.js';
export { DiscordBridge, DiscordStore } from './discord/index.js';
export type { DiscordConfig, DiscordBridgeStatus } from './discord/index.js';
export { SlackBridge, SlackStore } from './slack/index.js';
export type { SlackConfig, SlackBridgeStatus } from './slack/index.js';
export { EmailBridge } from './email/index.js';
export type { EmailBridgeConfig, EmailBridgeStatus } from './email/index.js';
export { Scheduler } from './scheduler/index.js';
export { setAutomationBridge, getAutomationBridge } from './automation/automation-bridge.js';
export type { AutomationBridge } from './automation/automation-bridge.js';
export { setAgentXOverviewBridge, getAgentXOverviewBridge } from './agent/agent-x-overview-bridge.js';
export type { AgentXOverviewBridge, AgentXOverviewView } from './agent/agent-x-overview-bridge.js';
export { setChannelSuperSessionSync, syncChannelSuperSessionContext } from './channels/channel-super-session-sync.js';
export { setChannelInboundAgentResolver, resolveChannelInboundAgent } from './channels/channel-inbound-router.js';
export {
  buildAutomationNotifyQuestionnaire,
  getNotificationChannelStatus,
  resolveTelegramOutboundChatId,
  notifyToolsForChannels,
  parseAutomationNotifyAnswer,
  resolveAutomationNotifyChannels,
  effectiveAutomationNotifyChannels,
  inferAutomationSourceChannel,
  mandatoryAutomationNotifyChannels,
  normalizeAutomationTaskOrigin,
  sourceChannelToNotifyChannel,
  AUTOMATION_NOTIFY_NONE,
} from './automation/automation-notify.js';
export type { NotificationChannelRuntimeHints } from './automation/automation-notify.js';
export { NOTIFY_TOOL_IDS } from './automation/infer-automation-tools.js';
export type { ScheduledJob } from './scheduler/index.js';
export { TaskManager } from './agent/TaskManager.js';
export type { TaskContext } from './agent/TaskManager.js';
export { TodoManager } from './agent/TodoManager.js';
export {
  MAX_COMPLETION_CONTINUATIONS,
  evaluateTurnCompletionGate,
  estimateEnumeratedTaskCount,
  getIncompleteTodos,
  isChecklistFullyComplete,
  buildCompletionContinuationPrompt,
} from './agent/TurnCompletionGate.js';
export type { TurnCompletionBlockReason, TurnCompletionGateResult, IncompleteTodo } from './agent/TurnCompletionGate.js';
export type { TodoStatus } from './agent/TodoManager.js';
export {
  getSessionTodoManager,
  registerSessionTodoManager,
  unregisterSessionTodoManager,
} from './tools/TodoAccess.js';
export { AgentOrchestrator } from './agent/AgentOrchestrator.js';
export type { OrchestrationPlan, OrchestrationStep } from './agent/AgentOrchestrator.js';
export { DefaultTelemetryBus } from './telemetry/index.js';
export type { TelemetryBus, TelemetryEvent, TelemetryConfig } from '@agentx/shared';

// Phase 0: Storage adapter
export { PostgresStorageAdapter, SessionPermissionStore, ensureDestinationSchema, transferPostgresStorage } from './storage/index.js';
export type { PostgresConfig } from './storage/PostgresStorageAdapter.js';
export type { StorageTransferResult } from './storage/pg-storage-transfer.js';
export type { StorageAdapter, StorableSession, StorableMessage, StorableTokenLog, StorablePermission } from '@agentx/shared';

// Phase 2: Plugin system
export { DefaultPluginLoader, ACPBridge, PluginRegistry, getBuiltinCatalog, getBuiltinPlugin, getMarketplaceExtensions, getMarketplaceExtension } from './plugin/index.js';
export { PluginSystem } from './plugin/PluginSystem.js';
export type { PluginLifecycle, PluginHooks, PluginHealth, PluginSystemConfig } from './plugin/PluginSystem.js';
export type { MarketplaceExtension } from './plugin/index.js';
export { executePluginInSandbox, validatePluginSource } from './plugin/PluginSandbox.js';
export type { PluginSandboxResult } from './plugin/PluginSandbox.js';
export { RedisCacheRuntime } from './plugin/runtime/RedisRuntime.js';
export { WebhookNotifierRuntime } from './plugin/runtime/WebhookNotifierRuntime.js';
export type { RedisCacheConfig } from './plugin/runtime/RedisRuntime.js';
export type { WebhookNotifierConfig } from './plugin/runtime/WebhookNotifierRuntime.js';
export type { AcpServerConfig } from './plugin/index.js';
export type { PluginManifest, PluginInstance, PluginLoader, PluginHubEntry, PluginCategory, InstalledPlugin } from '@agentx/shared';

// Phase 3: RAG / Vector search
export { MemoryVectorStore, LLMEmbeddingProvider, RAGEngine } from './rag/index.js';
export type { IndexDocumentInput } from './rag/index.js';
export type { VectorStore, EmbeddingProvider, Document, RAGConfig } from '@agentx/shared';

// Phase 7: ACP protocol
export { ACPServer, ACPClient } from './acp/index.js';
export type { ACPHandlers, ACPToolDefinition } from './acp/index.js';

// Phase 2: Sandboxed execution
export { DockerSandbox, NamespaceSandbox } from './sandbox/index.js';
export type { Sandbox, SandboxResult, SandboxOptions } from '@agentx/shared';

// Phase 8: Safety auditor
export { SafetyAuditor } from './safety/index.js';
export type { SafetyAlert, SafetyCheck, SafetyReport, SafetyAuditorConfig } from './safety/index.js';

// Phase 8: Enterprise
export { PolicyEngine, GoogleSSOProvider, GitHubSSOProvider } from './enterprise/index.js';
export type {
  PolicyRule,
  PolicyDocument,
  PolicyEffect,
  AuditEntry,
  ManagedSettings,
  SSOConfig,
  SSOUser,
  SSOProvider,
} from './enterprise/index.js';

// Phase 8: Cloud handoff
export { CloudHandoff, CloudAuth, runCloudWorker } from './cloud/index.js';
export type { CloudSession, CloudWorkerConfig, CloudAuthToken } from './cloud/index.js';

// Phase 8: Remote tunneling
export { TunnelServer, TunnelClient } from './tunnel/index.js';
export type { TunnelConfig, TunnelSession } from './tunnel/index.js';

// Reasoning modules
export { TreeOfThoughts } from './reasoning/TreeOfThoughts.js';
export type { ThoughtNode, TreeOfThoughtsOptions } from './reasoning/TreeOfThoughts.js';
export { ResearchEngine } from './reasoning/ResearchEngine.js';
export type { ResearchQuery, ResearchResult, ResearchEngineOptions } from './reasoning/ResearchEngine.js';
export {
  applyWebSearchConfigFromAgentConfig,
  getWebSearchRuntime,
  listActiveWebSearchProviders,
  defaultWebSearchToolsConfig,
  resolveWebSearchRuntime,
  hasActiveWebSearchProviders,
  webSearchProvidersUnavailableMessage,
  mergeWebSearchToolsConfig,
} from './search/search-config.js';
export type { ResolvedWebSearchProvider, ResolvedWebSearchRuntime } from './search/search-config.js';
export { validateWebSearchProvider } from './search/validate-provider.js';
export type { WebSearchProviderValidation } from './search/validate-provider.js';
export {
  detectExplicitWebSearchRequest,
  resolveWebSearchTurnPolicy,
  resolveWebSearchTurnPolicyAsync,
  createWebSearchIntentClassifier,
  analyzeWebSearchIntent,
  analyzeWebSearchIntentHeuristic,
  pickForcedWebSearchTool,
  isWebSearchAvailableForChat,
  buildWebSearchTurnInstruction,
} from './search/web-search-policy.js';
export type { WebSearchTurnPolicy } from './search/web-search-policy.js';

// === UNIFIED IMPLEMENTATION: Communication Layer ===

// Input Normalization
export { InputNormalizer } from './communication/InputNormalizer.js';
export { ToolArgsRepairer } from './communication/ToolArgsRepairer.js';
export type { RepairRecord, RepairResult } from './communication/ToolArgsRepairer.js';
export { AttachmentResolver } from './communication/AttachmentResolver.js';

// Prompt System
export { PromptComposer, CACHE_BOUNDARY_MARKER } from './communication/prompt/PromptComposer.js';
export { PROVIDER_OVERLAYS, DEFAULT_PROVIDER_OVERLAY } from './communication/prompt/ProviderOverlays.js';
export { PromptCache } from './communication/prompt/PromptCache.js';
export type { CacheEntry } from './communication/prompt/PromptCache.js';

// Provider Abstraction
export { ProviderRouter } from './providers/ProviderRouter.js';
export { makeRoute, openAIProtocol, anthropicProtocol } from './providers/routes/Route.js';
export type { MakeRouteInput } from './providers/routes/Route.js';
export { BaseTransport } from './providers/transports/BaseTransport.js';
export { OpenAITransport } from './providers/transports/OpenAITransport.js';
export { AnthropicTransport } from './providers/transports/AnthropicTransport.js';
export { GenericTransport } from './providers/transports/GenericTransport.js';
export { AuthProfileManager } from './providers/AuthProfileManager.js';

// Request Preparation
export { RequestPreparer } from './communication/RequestPreparer.js';
export type { RequestPreparerConfig } from './communication/RequestPreparer.js';

// Unified Streaming
export type { ClassifiedTool, ParallelClassification } from './tools/ParallelClassifier.js';
export type { RepairResult as ToolCallRepairResult } from './tools/ToolCallRepairer.js';
export type { SessionProcessorContext } from './agent/SessionProcessor.js';
export { ToolResultReinjector } from './communication/ToolResultReinjector.js';

// Observability
export { TelemetryEmitter } from './communication/telemetry/TelemetryEmitter.js';
export type { TurnMetrics, TelemetryEmitterConfig } from './communication/telemetry/TelemetryEmitter.js';

// === GATEWAY & CHANNEL PLUGINS ===
export { Gateway, ChannelRegistry as GatewayChannelRegistry, FocusManager } from './gateway/index.js';
export { TelegramChannelPlugin, WebSocketChannelPlugin } from './gateway/index.js';
export type { ChannelPlugin, ChannelRegistryEntry, GatewayConfig, FocusState, FocusChangeEvent, FocusListener, ChannelMessage, ChannelAttachment, GatewayResponse } from './gateway/index.js';

// === VISUALIZATION & ANIMATION ===
export { StreamingMarkdownRenderer } from './communication/visuals/StreamingMarkdownRenderer.js';
export { VisualEventBridge } from './communication/visuals/VisualEventBridge.js';
export { VisualStateManager } from './communication/visuals/VisualStateManager.js';
export type { VisualState, StreamingTextState, ToolCardMap } from './communication/visuals/VisualStateManager.js';
export { ThemeEngine } from './communication/visuals/ThemeEngine.js';
export { createChannelAdapter } from './communication/visuals/ChannelAdapter.js';
export type { ChannelAdapter, ChannelRenderContext } from './communication/visuals/ChannelAdapter.js';
export { configureBackgroundTaskPool, getBackgroundTaskPool } from './runtime/BackgroundTaskPool.js';
export {
  applyPerformanceGovernor,
  getPerformanceLanes,
  getLlmConcurrencyLimits,
  getAttachmentWorkerLimit,
  registerPerformanceTuneTarget,
} from './performance/PerformanceGovernor.js';
export type { PerformanceTuneTarget, PerformanceLanesPatch } from './performance/PerformanceGovernor.js';
export { Semaphore } from './concurrency/Semaphore.js';
export { Mutex } from './concurrency/Mutex.js';
export { Fiber } from './concurrency/Fiber.js';
export { FiberSet } from './concurrency/FiberSet.js';
export { ConcurrencyLimiter } from './concurrency/ConcurrencyLimiter.js';
export { WorkerPool, setupWorkerListener } from './workers/WorkerPool.js';
export type { WorkerTask, WorkerPoolOptions, WorkerHandle } from './workers/WorkerPool.js';

export { setOnnxThreadConfig, getOnnxThreadConfig } from './runtime/onnx-thread-config.js';
export { assertSafeFetchUrl, isUrlSafeForFetch } from './search/url-utils.js';
export { TtlCache } from './storage/cache/TtlCache.js';
export * from './voice/index.js';

// Phase 8: Channel service

export { ChannelService } from './services/channel/ChannelService.js';
export { ChannelRegistry } from './services/channel/ChannelRegistry.js';
export { ChannelRegistry as ChannelBridgeRegistry } from './services/channel/ChannelRegistry.js';
export { InboundQueue } from './services/channel/InboundQueue.js';
export { ChannelWorker } from './services/channel/ChannelWorker.js';
export type { ChannelServiceConfig } from './services/channel/ChannelService.js';
export type { ChannelId, OutboundMessage, InboundPayload, ChannelStatus, IChannelService } from './services/channel/IChannelService.js';
export type { IChannelBridge, OnInboundCallback } from './services/channel/IChannelBridge.js';
export { DiscordBridgeAdapter } from './services/channel/adapters/DiscordBridgeAdapter.js';
export { SlackBridgeAdapter } from './services/channel/adapters/SlackBridgeAdapter.js';
export { EmailBridgeAdapter } from './services/channel/adapters/EmailBridgeAdapter.js';
export { TelegramBridgeAdapter } from './services/channel/adapters/TelegramBridgeAdapter.js';
export { getPerfTracker } from './benchmark/index.js';

// System metrics, location, and weather
export { SystemMetricsService, getSystemMetricsService, resetSystemMetricsService } from './system/SystemMetricsService.js';
export type { SystemMetricsSnapshot } from './system/SystemMetricsService.js';
export { WeatherService, getWeatherService, resetWeatherService } from './system/WeatherService.js';
export type { WeatherResponse, WeatherConditions } from './system/WeatherService.js';
export {
  KnowledgeBaseService,
  KnowledgeBaseSourceStore,
  DocumentIngestPipeline,
  searchKnowledgeBaseDocuments,
  getKnowledgeBaseService,
  setKnowledgeBaseService,
} from './knowledge-base/index.js';
export type {
  KnowledgeBaseServiceOptions,
  KnowledgeBaseStatusListener,
  DocumentIngestPipelineOptions,
} from './knowledge-base/index.js';
export {
  TemplateService,
  TemplateStore,
  getTemplateService,
  setTemplateService,
  detectTemplateFormat,
  isFillableFormat,
  scanTemplatePlaceholders,
  fillTemplateBuffer,
} from './templates/index.js';
export type { TemplateServiceOptions } from './templates/TemplateService.js';
