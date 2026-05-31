export { ConfigManager } from './config/index.js';
export * from './tools/platform.js';
export { SessionStore } from './session/SessionStore.js';
export { SessionManager } from './session/SessionManager.js';
export { TokenTracker } from './session/TokenTracker.js';
export { CrashRecovery } from './session/CrashRecovery.js';
export { GitManager } from './session/GitManager.js';
export { FileWatcher } from './session/FileWatcher.js';
export { BackgroundQueue } from './session/BackgroundQueue.js';
export { ModelRouter } from './session/ModelRouter.js';
export { RecipeEngine } from './session/RecipeEngine.js';
export { AgentBus, getAgentBus, setAgentBus } from './agent/AgentBus.js';
export type { AgentMessage, AgentSubscription } from './agent/AgentBus.js';
export { SpecialistRegistry } from './agent/SpecialistRegistry.js';
export type { Specialist, SpecialistType } from './agent/SpecialistRegistry.js';
export { SkillGenerator } from './agent/SkillGenerator.js';
export { BUNDLED_SKILLS, getBundledSkills, findBundledSkill } from './agent/BundledSkills.js';
export type { GeneratedSkill } from './agent/SkillGenerator.js';
export { ReflectionLoop } from './agent/ReflectionLoop.js';
export type { ReflectionResult } from './agent/ReflectionLoop.js';
export { Agent } from './agent/Agent.js';
export type { AgentOptions } from './agent/Agent.js';
export { ResponseFormatter } from './agent/ResponseFormatter.js';
export type { FormattedSegment } from './agent/ResponseFormatter.js';
export { SubAgentManager } from './agent/SubAgentManager.js';
export type { SubAgentTask } from './agent/SubAgentManager.js';
export { SmartSubAgent } from './agent/SmartSubAgent.js';
export type { SmartSubAgentOptions, SmartSubAgentResult } from './agent/SmartSubAgent.js';
export { PromptEngine } from './prompt/PromptEngine.js';
export type { IntentResult, PromptBudget } from './prompt/PromptEngine.js';
export { AgentEventBus } from './EventBus.js';
export { ProviderFactory } from './providers/index.js';
export type { ProviderInterface } from './providers/index.js';
export { OpenAIProvider } from './providers/OpenAIProvider.js';
export { AnthropicProvider } from './providers/AnthropicProvider.js';
export { OllamaProvider } from './providers/OllamaProvider.js';
export { GoogleProvider } from './providers/GoogleProvider.js';
export { LMStudioProvider } from './providers/LMStudioProvider.js';
export { CommandParser, CommandRegistry, createDefaultRegistry } from './commands/index.js';
export type { CommandInterface, CommandContext, CommandResult } from './commands/index.js';
export { ToolRegistry, ToolExecutor, PermissionManager, ScopeGuard } from './tools/index.js';
export { PythonRPCExecutor, getPythonRPC } from './tools/PythonRPCExecutor.js';
export type { PythonTask, PythonResult } from './tools/PythonRPCExecutor.js';
export { createDefaultToolkit } from './tools/index.js';
export type { PermissionRequestHandler } from './tools/index.js';
export { fileRead, fileWrite, fileDelete, folderCreate, folderDelete, folderList, folderMove } from './tools/index.js';
export { shellExec, shellBackground, processKill, processList } from './tools/index.js';
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
export { mcpCall, mcpListTools } from './tools/index.js';
export { reminderSet, reminderList, reminderCancel } from './tools/index.js';
export { agentXConfigSchema } from './config/ConfigSchema.js';
export * from './config/paths.js';
export { SecretSauceManager, CrewManager, SoulManager, MemoryManager, DiaryManager, IdentityManager } from './secret-sauce/index.js';
export { TelegramBridge, TelegramStore } from './telegram/index.js';
export type { TelegramConfig, TelegramBridgeStatus } from './telegram/index.js';
export { DiscordBridge, DiscordStore } from './discord/index.js';
export type { DiscordConfig, DiscordBridgeStatus } from './discord/index.js';
export { SlackBridge, SlackStore } from './slack/index.js';
export type { SlackConfig, SlackBridgeStatus } from './slack/index.js';
export { EmailBridge } from './email/index.js';
export type { EmailBridgeConfig, EmailBridgeStatus } from './email/index.js';
export { Scheduler } from './scheduler/index.js';
export type { ScheduledJob } from './scheduler/index.js';
export { TaskManager } from './agent/TaskManager.js';
export type { TaskContext } from './agent/TaskManager.js';
export { AgentOrchestrator } from './agent/AgentOrchestrator.js';
export type { OrchestrationPlan, OrchestrationStep } from './agent/AgentOrchestrator.js';
export { DefaultTelemetryBus } from './telemetry/index.js';
export type { TelemetryBus, TelemetryEvent, TelemetryConfig } from '@agentx/shared';

// Phase 0: Storage adapter
export { DefaultStorageAdapter, PostgresStorageAdapter } from './storage/index.js';
export type { PostgresConfig } from './storage/PostgresStorageAdapter.js';
export type { StorageAdapter, StorableSession, StorableMessage, StorableTokenLog, StorablePermission } from '@agentx/shared';

// Phase 2: Plugin system
export { DefaultPluginLoader, MCPBridge, ACPBridge, PluginRegistry, getBuiltinCatalog, getBuiltinPlugin, getMarketplaceExtensions, getMarketplaceExtension } from './plugin/index.js';
export { RedisCacheRuntime } from './plugin/runtime/RedisRuntime.js';
export { WebhookNotifierRuntime } from './plugin/runtime/WebhookNotifierRuntime.js';
export { SQLiteBrowserRuntime } from './plugin/runtime/SQLiteBrowserRuntime.js';
export type { RedisCacheConfig } from './plugin/runtime/RedisRuntime.js';
export type { WebhookNotifierConfig } from './plugin/runtime/WebhookNotifierRuntime.js';
export type { SQLiteBrowserConfig } from './plugin/runtime/SQLiteBrowserRuntime.js';
export type { AcpServerConfig } from './plugin/index.js';
export type { PluginManifest, PluginInstance, PluginLoader, MCPBridgeConfig, PluginHubEntry, PluginCategory, InstalledPlugin } from '@agentx/shared';

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
