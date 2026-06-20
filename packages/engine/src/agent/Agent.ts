import type {
  Message,
  EngineEvent,
  SessionEvent,
  CompletionRequest,
  CompletionMessage,
  CompletionChunk,
  ProviderId,
  AgentXConfig,
  AgentPersonaConfig,
  RemediationAction,
  Plan,
  PlanStep,
  PermissionRule,
} from '@agentx/shared';
import { FailoverReason, generateMessageId, getLogger, resolveSpaceError, type ChannelKind, getConfigDir } from '@agentx/shared';
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
import { countInputTokens, estimateOutputTokens } from '../session/tokenCount.js';
import { SubAgentManager } from './SubAgentManager.js';
import { TaskManager } from './TaskManager.js';
import { Scheduler } from '../scheduler/Scheduler.js';
import { setSchedulerInstance } from '../commands/builtin/schedule.js';
import { setTaskManagerInstance } from '../commands/builtin/tasks.js';
import { setSubAgentManagerInstance } from '../tools/builtin/subagent.js';
import { setCrewDelegator } from '../tools/builtin/delegate-to-crew.js';
import { setToolRegistryInstance } from '../commands/builtin/tools.js';
import { SecretSauceManager } from '../secret-sauce/index.js';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
import { PromptAssembly, type SourceSnapshot, createProviderPromptSection, createIdentitySection, createWorkingDirectorySection, createRulesSection, createCurrentTimeSection, createSchedulingSection, createLearningsSection, createSkillsSection, createFormalSkillsSection, createHyperdriveSection, createChannelFocusSection, createMultiCrewSection, createUserSection, createTaskPanelSection, createSoulSection, createInstructionsSection, createSystemOverrideSection, type SectionContext } from '../secret-sauce/prompt-assembly/index.js';
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
import { CrewOrchestrator, type CrewMember } from './CrewOrchestrator.js';
import { ContextTracker } from './ContextTracker.js';


import { TodoManager } from './TodoManager.js';
import type { SessionLogger } from '../session/SessionLogger.js';
import { COMPACTION_PROMPT } from './compaction-prompt.js';

// ─── UNIFIED PIPELINE IMPORTS (Phase 1-11 integration) ───
import { InputNormalizer } from '../communication/InputNormalizer.js';
import { ErrorClassifier } from '../communication/ErrorClassifier.js';
import { TelemetryEmitter } from '../communication/telemetry/TelemetryEmitter.js';
import { AuthProfileManager } from '../providers/AuthProfileManager.js';
import { VisualEventBridge } from '../communication/visuals/VisualEventBridge.js';
import { CommandQueue } from '../communication/CommandQueue.js';
import { RunStateManager } from '../agent/RunStateManager.js';
import { IdleTimeoutBreaker } from '../communication/IdleTimeoutBreaker.js';
import { createAiSdkModel, createAiSdkTools, aiSdkStream } from './AiSdkBridge.js';
import { createAiSdkStreamHandler } from './AiSdkStreamHandler.js';
import type { PartPersistFn } from './AiSdkStreamHandler.js';
import { streamText, stepCountIs, type ToolSet } from 'ai';
import { SessionRunner } from '../session/SessionRunner.js';
import type { AgentInfo } from './AgentInfo.js';
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
  private isProcessing = false;
  readonly lifecycle = new AgentLifecycle();
  private scope: Scope | null = null;
  private _abortSignalController: AbortController | null = null;
  private pendingInstruction: string | null = null;
  private _turnStartTokens = 0;
  private _turnStartCost = 0;
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  private todoManager: TodoManager;
  private scheduler: Scheduler;
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
  private currentAgent: AgentInfo;
  private specialistRegistry: SpecialistRegistry;

  // ─── Session & Infrastructure
  private sessionRunner: SessionRunner;
  private gitManager: GitManager | null = null;
  private gitAutoCommit: boolean = false;

  // ─── File Watcher (lazy-init)
  private _fileWatcher: FileWatcher | null = null;
  private _modelRouter: ModelRouter | null = null;

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
  private pendingPlanApproval: ((approved: boolean) => void) | null = null;
  private pendingStepApproval: ((stepId: string, approved: boolean, description?: string) => void) | null = null;

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
    this._hyperdriveMode = !this._hyperdriveMode;
    this.autoApproveTools = this._hyperdriveMode;
    if (this._hyperdriveMode) {
      this._preHyperdrivePlanMode = this.planMode;
      if (this.planMode) {
        this.switchAgent('build');
      }
    } else {
      if (this._preHyperdrivePlanMode) {
        if (!this.planMode) {
          this.switchAgent('plan');
        }
      }
    }
    this.rebuildSystemPrompt();
    return this._hyperdriveMode;
  }

  // Anti-duplicate: prevents double message_received within a single turn
  private _turnMessageEmitted = false;
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
  private _idleBreaker: IdleTimeoutBreaker | null = null;
  private get idleBreaker(): IdleTimeoutBreaker { if (!this._idleBreaker) this._idleBreaker = new IdleTimeoutBreaker(); return this._idleBreaker; }
  private _telegramConnected = false;
  private _telegramChatId: number | null = null;
  private _crewOrchestrator: CrewOrchestrator | null = null;
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

  setContextPersistDir(_dir: string, scopePath?: string): void {
    if (scopePath) this.contextTracker.setScopePath(scopePath);
  }
  private maxSubAgents = 5;
  readonly serialLock: Mutex = new Mutex();
  private sessionManager: { createSession: (providerId: string, modelId: string, scopePath?: string, id?: string, parentId?: string) => { id: string } } | null = null;
  private enabledCrewSessionIds: Set<string> = new Set();

  setTelegramConnected(connected: boolean, chatId?: number | null): void {
    this._telegramConnected = connected;
    this._telegramChatId = chatId ?? this._telegramChatId;
    this.rebuildSystemPrompt();
  }

  /**
   * Respond to a pending clarification request.
   */
  respondToClarification(response: string): void {
    if (this.clarificationResolve) {
      this.clarificationResolve(response);
    }
  }

  constructor(options: AgentOptions) {
    this.options = options;
    this.config = options.config;
    this.persona = options.persona ?? null;
    if (this.persona) {
      this.secretSauce.identity.seedFromPersona(this.persona);
    }
    this.sessionId = options.sessionId;
    this.scopePath = normalize(resolve(options.scopePath!));
    this.contextTracker = new ContextTracker(null as any, this.sessionId);
    this.eventBus = options.eventBus ?? new AgentEventBus();
    this._onPart = options.onPart;
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
    this.subAgents.setParentAgent(this);
    setSubAgentManagerInstance(this.subAgents);

    // Crew delegation: allow Agent-X to delegate sub-tasks to crew members via tool calls
    setCrewDelegator(async (crewName: string, taskDescription: string) => {
      if (!this.crewOrchestrator) return 'No crews available.';
      const members = this.crewOrchestrator.getMembers();
      const member = members.find((m) =>
        m.crew.name.toLowerCase() === crewName.toLowerCase() ||
        m.crew.callsign.toLowerCase() === crewName.toLowerCase()
      );
      if (!member) return `Crew "${crewName}" not found. Available: ${members.map(m => `${m.crew.name} (@${m.crew.callsign})`).join(', ')}`;
      const crewPrompt = this.secretSauce.crew.getMultiCrewSystemPrompt() || 'Available crew members: none configured.';
      const result = await this.crewOrchestrator!.processMessage(taskDescription, crewPrompt, [member]);
      return result.responses[0]?.content ?? `${member.crew.name} completed the task.`;
    });
    this.taskManager = new TaskManager(this.eventBus);
    setTaskManagerInstance(this.taskManager);
    this.todoManager = new TodoManager(this.eventBus);
    this.scheduler = new Scheduler(this.eventBus, this.sessionId);
    setSchedulerInstance(this.sessionId, this.scheduler);
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
        // Copy permission handler
        const permHandler = (options.toolExecutor as unknown as Record<string, unknown>)['permissionRequestHandler'];
        if (typeof permHandler === 'function') {
          this.toolExecutor.setPermissionRequestHandler(permHandler as (toolId: string, path: string, riskLevel: string) => Promise<'allow_once' | 'allow_always' | 'deny'>);
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
      waitForClarification: async (question, options, allowFreeform) => {
        this.emit({ type: 'clarification_required', question, options, allowFreeform });
        const response = await new Promise<string>((resolve) => { this.clarificationResolve = resolve; });
        this.clarificationResolve = null;
        return response;
      },
      runSubAgent: async (instruction, toolsList, timeout, background) => {
        const task = this.subAgents.spawn(instruction, toolsList ?? [], timeout, this.maxSubAgents);
        if (!task) {
          return { success: false, output: 'Sub-agent limit reached. Wait for existing sub-agents to complete.', elapsed: 0 };
        }
        if (background) {
          this.emit({ type: 'task_backgrounded', taskId: task.id } as EngineEvent);
          return { success: true, output: `[Sub-agent started in background — task ${task.id}]`, elapsed: 0 };
        }
        const completed = await this.subAgents.waitFor(task.id);
        return {
          success: completed?.status === 'completed',
          output: completed?.result ?? '',
          elapsed: (completed?.endTime ?? Date.now()) - (completed?.startTime ?? Date.now()),
        };
      },
      onTokenUsage: (input, output) => {
        this.tokenTracker.addTokenUsage(input, output);
        this.onTokenLog?.({ inputTokens: input, outputTokens: output, costUsd: 0 });
      },
      gitManager: this.gitManager ?? undefined,
      onSessionEvent: this.onSessionEvent ?? undefined,
      modelName: this.config.provider.activeModel,
    });

    // Reset permissions for each new session — no persistent deny across sessions
    if (this.toolExecutor) {
      this.toolExecutor.getPermissionManager().resetForNewSession(this.sessionId);
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

    // Wire permission requests to event bus
    if (this.toolExecutor) {
      this.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel) => {
        if (this.autoApproveTools || this.turnApprovedAll) return 'allow_once';
        const requestId = randomUUID();
        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          this.pendingPermissions.set(requestId, { resolve, toolName: toolId, path, riskLevel });
          this.emit({ type: 'permission_required', requestId, tool: toolId, path, riskLevel });
        });
      });

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

    // Initialize current agent from built-in build agent
    this.currentAgent = BUILTIN_AGENTS.find(a => a.id === 'build')!;

    // Register this agent on the bus with persona identity
    const identity = this.persona?.name || 'Agent-X';
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

    // When a scheduled job fires, emit it as a notification message (non-blocking).
    // Simple reminders don't need an LLM round-trip — just display the message.
    this.scheduler.setTriggerHandler((job) => {
      const reminderMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: `⏰ **Reminder**: ${job.instruction}`,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: 0,
      };
      this.emit({ type: 'reminder_fired', taskId: job.id, name: job.name, message: job.instruction });
      this.emit({ type: 'message_received', message: reminderMessage, elapsed: 0 });
    });
    this.scheduler.start();

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

  get schedulerCount(): number {
    return this.scheduler?.taskCount ?? 0;
  }

  get toolCount(): number {
    return this.toolRegistry?.list().length ?? 165;
  }

  getToolExecutor(): ToolExecutor | undefined {
    return this.toolExecutor;
  }

  setScopePath(path: string): void {
    this.scopePath = normalize(resolve(path));
    this.toolExecutor?.setScopePath(this.scopePath);
  }

  /**
   * Cancel an in-progress completion. Aborts the active stream and tool executions.
   */
  cancel(): void {
    this.runStateMgr.cancel(this.sessionId);
    this.commandQueue.cancelSession(this.sessionId);
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

  get cron(): Scheduler {
    return this.scheduler;
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

  get ragIndexStats(): { indexedCount: number; indexedAt: number | null } {
    const engine = getRAGEngineInstance();
    if (!engine) return { indexedCount: 0, indexedAt: null };
    return { indexedCount: engine.indexedCount, indexedAt: engine.indexedAt };
  }

  setPlanMode(enabled: boolean): void {
    if (enabled === this.planMode) return;
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
    this.currentAgent = agent;
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

  private maxRetries = 3;

  setMaxRetries(n: number): void {
    this.maxRetries = n;
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
    // ─── UNIFIED: Idle timeout breaker check ───
    if (this.idleBreaker && this.idleBreaker.shouldBreak()) {
      throw new Error(`Idle timeout breaker tripped after ${this.idleBreaker.getCount()} consecutive timeouts`);
    }
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If the operation was aborted, rethrow immediately — no retries.
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }

        // Treat certain client/auth errors as non-retryable (tests depend on immediate failure
        // for things like 401 Unauthorized). If we detect these, rethrow immediately.
        const msg = error instanceof Error ? error.message : String(error);
        if (/401|Unauthorized|403|Forbidden|404|not found|402|429|quota|billing|Invalid API|suspended|thought_signature|function.?call/i.test(msg)) {
          // Log model-specific issues so the user knows to switch models
          if (/thought_signature|function.?call/i.test(msg)) {
            getLogger().error('MODEL_INCOMPAT', 'Model does not support function calling — switch to a capable model (e.g. gemini-2.0-flash, claude-3-haiku)');
          }
          this.sessionLogger?.logErrorAPI(this.config.provider.activeProvider, label, 0, msg);
          throw lastError;
        }

        // ─── UNIFIED: Step idle breaker on timeouts ───
        if (/timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(msg)) {
          this.idleBreaker.step();
        }

        // Otherwise, retry with exponential backoff (unless we've exhausted attempts).
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          getLogger().warn('RETRY', `${label} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError ?? new Error(`${label} failed after retries`);
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  respondToPlan(approved: boolean): void {
    if (this.pendingPlanApproval) {
      this.pendingPlanApproval(approved);
      this.pendingPlanApproval = null;
    }
  }

  respondToStep(stepId: string, approved: boolean, description?: string): void {
    if (this.pendingStepApproval) {
      this.pendingStepApproval(stepId, approved, description);
    }
  }

  private connectivityChecked = false;

  private async checkConnectivity(baseUrl?: string): Promise<boolean> {
    if (this.connectivityChecked) return true;
    const url = baseUrl ?? this.getBaseUrl();
    if (!url) return true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url.replace('/v1', '').replace(/\/+$/, '') + '/models', {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.connectivityChecked = true;
      return res.ok || res.status < 500;
    } catch {
      this.emit({
        type: 'error',
        code: 'NETWORK_ERROR',
        message: `Cannot reach provider at ${url}. Check your internet connection and provider URL.`,
        recoverable: true,
        actions: [
          { type: 'dismiss', label: 'Dismiss' },
          { type: 'switch_model', label: 'Switch Provider' },
        ],
      });
      return false;
    }
  }

  private async generatePlan(userRequest: string): Promise<Plan> {
    const planPrompt = `You are a planning assistant. Given the user's request, create a step-by-step plan.
Each step should be a clear, actionable description of what needs to be done.

User request: "${userRequest}"

Return a JSON array of plan steps, each with a "description" field.
Example: [{"description": "Step 1 description"}, {"description": "Step 2 description"}]
Return ONLY valid JSON, no other text.`;

    try {
      let text = '';
      const stream = this.provider.complete({
        messages: [{ role: 'user', content: planPrompt }],
        model: this.config.provider.activeModel,
        maxTokens: 2000,
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.content) {
          text += chunk.content;
        }
      }

      text = text.trim();
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON array found in plan response');

      const steps: Array<{ description: string }> = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const planSteps: PlanStep[] = steps.map((s, i) => ({
        id: `step-${i + 1}`,
        description: s.description,
        status: 'pending' as const,
      }));

      const plan: Plan = {
        id: `plan-${Date.now()}`,
        title: userRequest.slice(0, 80),
        steps: planSteps,
        createdAt: new Date().toISOString(),
      };

      this.currentPlan = plan;
      return plan;
    } catch (error) {
      getLogger().error('PLAN_GEN', error);
      const fallbackPlan: Plan = {
        id: `plan-${Date.now()}`,
        title: userRequest.slice(0, 80),
        steps: [{ id: 'step-1', description: `Execute: ${userRequest}`, status: 'pending' }],
        createdAt: new Date().toISOString(),
      };
      this.currentPlan = fallbackPlan;
      return fallbackPlan;
    }
  }

  async sendMessage(content: string, options?: { instruction?: string; userId?: string; channelId?: string; sourceChannel?: string; retry?: boolean }): Promise<Message> {
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
    // Per-turn token snapshot for delta + cost emissions
    const turnStartTokens = this.tokenTracker.tokensUsed;
    const turnStartCost = this.tokenTracker.totalCost;
    this._turnStartTokens = turnStartTokens;
    this._turnStartCost = turnStartCost;

    // ─── UNIFIED: Start telemetry for this turn ───
    this.telemetry.startTurn(`turn-${startTime}`, this.sessionId, this.config.provider.activeProvider, this.config.provider.activeModel);

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

    // Add user message (clean, without instruction)
    if (!options?.retry) {
      this.messages.push({ role: 'user', content: cleanContent });
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
    }

    // Reset turn-level permission auto-approve from any prior batch approval
    this.turnApprovedAll = false;

    // ─── DECISION ENGINE (heuristic — zero LLM calls) ───
    const conversationLen = this.messages.filter(m => m.role === 'user').length;
    const decision = this.decisionEngine.classify(cleanContent, conversationLen);
    const isSocial = decision.executionPath === 'fast_reply';

    // ─── MODEL CAPABILITY CHECK: warn if model lacks function calling for task intents ───
    const isTaskIntent = decision.messageClass === 'simple_task' || decision.messageClass === 'complex_task';
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

    getLogger().info('CLASSIFY', `class=${decision.messageClass} conf=${decision.confidence} msg="${cleanContent.slice(0, 60)}"`);

    // Emit as the general decision event for UI consumption
    this.emit({
      type: 'decision_made',
      messageClass: decision.messageClass,
      executionPath: decision.executionPath,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
    } as unknown as EngineEvent);

    // ─── @MENTION ROUTING — supports multiple crews ───
    const mentionedCrewIds = this.detectAtMentions(cleanContent);
    if (mentionedCrewIds.length > 0 && this.crewOrchestrator) {
      const members = this.crewOrchestrator.getMembers();
      const mentionedMembers = members.filter((m) => mentionedCrewIds.includes(m.crew.id));
      if (mentionedMembers.length > 0) {
        return await this.routeToCrews(mentionedMembers, cleanContent, startTime, classificationContext);
      }
    }

    // ─── AUTO-CREW COMPOSITION (complex tasks → compose crew proactively) ───
    if (decision?.messageClass === 'complex_task' && this.crewOrchestrator) {
      const members = this.crewOrchestrator.getMembers();
      const composed = this.crewOrchestrator.autoCompose(cleanContent, members);
      if (composed.length > 0 && composed[0]) {
        return await this.routeToCrews(composed, cleanContent, startTime, classificationContext);
      }
    }

    // ─── FAST REPLY PATH (social messages) ───
    if (isSocial) {
      const steps = getLoadingSteps(decision.messageClass);
      this.emit({
        type: 'loading_start',
        stage: decision.messageClass,
        steps: steps.map(s => ({ ...s, status: 'pending' as const })),
      });
      // Advance through loading steps as visual feedback
      steps.forEach((step, idx) => {
        this.emit({
          type: 'loading_step_update',
          stepId: step.id,
          label: step.label,
          status: idx === steps.length - 1 ? 'completed' : 'active',
        });
      });

      try {
        const fastMessage = await this.runFastReply(content, startTime);
        this.lifecycle.forceTransition('idle');
        this.scope = null;
        this.runStateMgr.release(this.sessionId);
        this.commandQueue.release(this.sessionId);
        return fastMessage;
      } catch (e) {
        if ((e instanceof Error && e.name === 'AbortError') || !this.scope) {
          this.emit({ type: 'loading_end' });
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
          this.lifecycle.forceTransition('idle');
          this.scope = null;
          this.runStateMgr.release(this.sessionId);
          this.commandQueue.release(this.sessionId);
          return cancelledMessage;
        }
        getLogger().warn('FAST_REPLY', 'Fast reply failed, falling through to standard path');
        this.emit({ type: 'loading_end' });
      }
    }

    // ─── STANDARD LLM PATH: Agent-X handles ALL task messages directly ───
    // Crews are NOT the default handler — they are optional sub-agents for specific
    // parallel sub-tasks. Agent-X is the boss with full capabilities: research,
    // planning, tool execution, project creation, everything. Crews are ONLY invoked
    // via explicit @mention or when Agent-X decides to delegate a sub-task during execution.
    // ─── EMIT LOADING STEPS (standard / non-social path) ───
    const loadSteps = getLoadingSteps(decision.messageClass);
    this.emit({
      type: 'loading_start',
      stage: decision.messageClass,
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
    if (!this.currentDecision.skipRag) {
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

      // ─── UNIFIED: Complexity-based Tree of Thoughts trigger ───
      const wordCount = content.split(/\s+/).length;
      const hasListItems = (content.match(/\d+\.\s/g)?.length ?? 0) >= 2;
      const hasMultipleConstraints = (content.match(/, and\b|; and\b/g)?.length ?? 0) >= 1;
      const isComplex = wordCount > 200 || hasListItems || hasMultipleConstraints;
      const shouldUseToT = this.currentIntent?.reasoningMode === 'tree' ||
        (isComplex && (this.currentDecision?.executionPath === 'research' || this.currentDecision?.executionPath === 'multi_agent'));

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

      // Plan mode: first understand the user through conversation, then conditionally plan
      if (this.planMode) {
        const requiresPlan = decision.messageClass === 'complex_task' ||
          /\b(plan|create a plan|make a plan|outline|roadmap|strategy|steps|milestone|break.*down|🎯\s*GOAL)\b/i.test(content);

        if (requiresPlan) {
          this.emit({ type: 'loading_start', stage: 'planning' });
          const plan = await this.generatePlan(content);
          this.emit({ type: 'plan_generated', plan, userRequest: content });

          // Wait for user to approve/reject the plan
          const approved = await new Promise<boolean>((resolve) => {
            this.pendingPlanApproval = resolve;
          });

          if (!approved) {
            this.emit({ type: 'plan_rejected', planId: plan.id });
            const rejectedMessage: Message = {
              id: generateMessageId(),
              sessionId: this.sessionId,
              role: 'assistant',
              content: '⏹ Plan rejected. No actions taken.',
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            };
            this.emit({ type: 'message_received', message: rejectedMessage, elapsed: Date.now() - startTime });
            return rejectedMessage;
          }

          this.emit({ type: 'plan_approved', planId: plan.id });

          // Plan mode: return the plan without executing. User must switch to agent mode to execute.
          const planMessage: Message = {
            id: generateMessageId(),
            sessionId: this.sessionId,
            role: 'assistant',
            content: `✓ Plan approved. Switch to **Agent mode** to execute this plan.\n\n**Plan:** ${plan.title}\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}`,
            toolCalls: null,
            createdAt: new Date().toISOString(),
            tokenCount: 0,
          };
          this.emit({ type: 'message_received', message: planMessage, elapsed: Date.now() - startTime });
          return planMessage;
        }

        // Idea sharing, questions, and simple tasks — clear the force-plan instruction
        // and fall through to the normal conversational completion loop
        this.pendingInstruction = null;
      }

      // Normal mode: run completion loop directly
      if (!(await this.checkConnectivity())) {
        throw new Error('Cannot reach LLM provider. Check your internet connection.');
      }
      const assistantMessage = await this.runCompletionLoop(startTime);

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
      this.contextTracker.record('assistant', assistantMessage.content);

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
      this.emit({ type: 'loading_end' });
      return assistantMessage;
    } catch (error) {
      this.emit({ type: 'loading_end' });

      // ─── UNIFIED: Classify error via ErrorClassifier ───
      const classified = this.errorClassifier.classify(error);
      this.telemetry.markError(`turn-${startTime}`, classified.reason, classified.providerMessage ?? '');
      this.telemetry.endTurn(`turn-${startTime}`, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, this.sessionId, this.config.provider.activeProvider);

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
      this.lifecycle.forceTransition('idle');
      this.scope = null;
      this.runStateMgr.release(this.sessionId);
      this.commandQueue.release(this.sessionId);
    }
  }

  /**
   * Fast reply path for simple messages (greetings, farewells, conversational).
   * Uses minimal system prompt, no tools, no RAG — saves significant tokens.
   */
  private async runFastReply(content: string, startTime: number): Promise<Message> {
    const fastPrompt = this.decisionEngine.buildFastReplyPrompt(
      this.buildIdentityBlock(),
    );

    const callsign = this.config.user?.callsign;
    const userNote = callsign ? `\nThe user's name is "${callsign}".` : '';

    const fastMessages: CompletionMessage[] = [
      { role: 'system', content: fastPrompt + userNote },
      // Include last 2 messages for context (if any)
      ...this.messages.slice(-3).filter(m => m.role !== 'system'),
      { role: 'user', content },
    ];

    const request: CompletionRequest = {
      model: this.config.provider.activeModel,
      messages: fastMessages,
      stream: true,
      // No tools for fast reply
      signal: this.abortSignal,
    };

    let fullContent = '';
    const streamHandle = await this.retryWithBackoff(async () => {
      const iter = this._unifiedStream(request);
    this.lifecycle.transition('processing');
      const it = iter[Symbol.asyncIterator]();
      const first = await it.next();
      return { it, first };
    }, 'fast_reply');

    if (!streamHandle.first.done && streamHandle.first.value) {
      const chunk = streamHandle.first.value;
      if (chunk.type === 'text_delta' && chunk.content) {
        fullContent += chunk.content;
        this.emit({ type: 'stream_chunk', content: chunk.content, fullContent });
      } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
        this.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
      }
    }

    let next = await streamHandle.it.next();
    while (!next.done) {
      const chunk = next.value;
      if (chunk.type === 'text_delta' && chunk.content) {
        fullContent += chunk.content;
        this.emit({ type: 'stream_chunk', content: chunk.content, fullContent });
      } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
        this.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
      }
      next = await streamHandle.it.next();
    }

    // Add to conversation history
    this.messages.push({ role: 'assistant', content: fullContent });
    await this.compactContext();

    const assistantMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'assistant',
      content: fullContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: estimateOutputTokens(fullContent),
    };

    this.emit({ type: 'loading_end' });
    this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });

    // Update token tracker
    const inputTokens = countInputTokens(fastPrompt + content, this.config.provider.activeModel);
    const outputTokens = estimateOutputTokens(fullContent);
    this.tokenTracker.addTokenUsage(inputTokens, outputTokens);
    const turnTokens = this.tokenTracker.tokensUsed - (this._turnStartTokens ?? 0);
    const costUsd = this.tokenTracker.totalCost - (this._turnStartCost ?? 0);
    this.emit({ type: 'token_usage', totalTokens: this.tokenTracker.tokensUsed, contextWindow: this.getContextWindow(), turnTokens, costUsd, inputTokens: this.tokenTracker.inputTokenCount, outputTokens: this.tokenTracker.outputTokenCount, inputPrice: this.tokenTracker.inputPrice, outputPrice: this.tokenTracker.outputPrice } as unknown as EngineEvent);
    this.onTokenLog?.({ inputTokens: this.tokenTracker.inputTokenCount, outputTokens: this.tokenTracker.outputTokenCount, costUsd });
    this.contextTracker.record('assistant', fullContent);

    // Note: isProcessing and scope are cleaned up by sendMessage's finally block
    return assistantMessage;
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
    const emit = (e: EngineEvent) => this.emit(e);
    const registry = this.toolRegistry;
    const executor = this.toolExecutor;
    if (!registry) throw new Error('Tool registry not initialized');
    if (!executor) throw new Error('Tool executor not initialized');

    const tools = createAiSdkTools(
      registry,
      executor,
      this.sessionId,
      emit,
      async (question, options, allowFreeform) => {
        this.emit({ type: 'clarification_required', question, options, allowFreeform });
        const response = await new Promise<string>((resolve) => { this.clarificationResolve = resolve; });
        this.clarificationResolve = null;
        return response;
      },
      async (instruction, toolsList, timeout) => {
        const subAgent = new SmartSubAgent({ parentAgent: this, instruction, tools: toolsList, timeout });
        return subAgent.execute();
      },
    );

    const model = createAiSdkModel(this.config, this.getApiKey());

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
    );

    const aiMessages = this.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) || '',
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

    // Prepend RAG context to last user message
    if (this.lastRagResults.length > 0) {
      const ragCtx = this.promptEngine.buildRagContext(this.lastRagResults);
      const userIdx = aiMessages.findLastIndex(m => m.role === 'user');
      const userMsg = userIdx >= 0 ? aiMessages[userIdx] : null;
      if (userMsg) {
        aiMessages[userIdx] = { role: 'user', content: `${ragCtx}\n\n${userMsg.content}` };
      }
    }

    try {
      this.emit({ type: 'loading_start', stage: 'thinking' });

      const result = streamText({
        model,
        messages: aiMessages,
        tools,
        temperature: 0,
        stopWhen: stepCountIs(this.currentAgent.steps ?? 5),
        abortSignal: this.abortSignal,
        maxRetries: 0,
      });

      for await (const chunk of result.fullStream) {
        streamHandler.handleEvent(chunk);
      }

      const text = streamHandler.getState().accumulatedContent || '';
      const usage = await result.usage;
      const content = text || 'I apologize, I was unable to generate a response.';
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
      this.messages.push({ role: 'assistant', content });
      await this.compactContext();

      return { id: generateMessageId(), sessionId: this.sessionId, role: 'assistant' as const, content, toolCalls: null, createdAt: new Date().toISOString(), tokenCount };
    } catch (error) {
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

      const errorMsg = error instanceof Error ? error.message : String(error);
      getLogger().error('COMPLETION', `AI SDK streamText failed: ${errorMsg}`);
      this.emit({ type: 'error', code: 'AI_SDK_ERROR', message: errorMsg, recoverable: false });
      throw error;
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
    };
  }

  private registerPromptSections(systemOverride?: string): void {
    const ctx = this.createSectionContext();
    this.promptAssembly
      .register(createProviderPromptSection(ctx))
      .register(createIdentitySection(ctx))
      .register(createWorkingDirectorySection(ctx))
      .register(createRulesSection())
      .register(createCurrentTimeSection(ctx))
      .register(createSchedulingSection())
      .register(createLearningsSection(ctx))
      .register(createSkillsSection(ctx))
      .register(createFormalSkillsSection(ctx))
      .register(createHyperdriveSection(ctx))
      .register(createChannelFocusSection(ctx))
      .register(createMultiCrewSection(ctx))
      .register(createUserSection(ctx))
      .register(createTaskPanelSection())
      .register(createSoulSection(ctx))
      .register(createInstructionsSection(ctx.scopePath));

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
    this.provider = ProviderFactory.create(providerId, apiKey, baseUrl);
    this.config.provider.activeProvider = providerId;
  }

  switchModel(modelId: string, contextWindow?: number): void {
    this.config.provider.activeModel = modelId;
    this._capabilityWarningEmitted = false;

    const ctx = contextWindow ?? this.cachedModels.get(modelId);
    if (ctx) {
      this.tokenTracker.setTotal(ctx);
      this.cachedModels.set(modelId, ctx);
    }

    // Set pricing for cost tracking
    const pricing = getModelPricing(modelId);
    this.tokenTracker.setPricing(pricing.inputPerMillion, pricing.outputPerMillion);

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
        temperature: 0,
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

  /**
   * Respond to a pending permission request from the tool executor.
   */
  respondToPermission(requestId: string, choice: 'allow_once' | 'allow_always' | 'deny'): void {
    const entry = this.pendingPermissions.get(requestId);
    if (entry) {
      entry.resolve(choice);
      this.pendingPermissions.delete(requestId);
    }
  }

  /**
   * Approve or deny all pending permission requests at once.
   */
  respondToPermissionBatch(choice: 'allow_once' | 'allow_always' | 'deny'): void {
    if (choice !== 'deny') {
      this.turnApprovedAll = true;
    }
    for (const [id, entry] of this.pendingPermissions) {
      entry.resolve(choice);
      this.pendingPermissions.delete(id);
    }
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
  addToHistory(msg: { role: 'user' | 'assistant'; content: string }): void {
    this.messages.push({ role: msg.role, content: msg.content });
    this.contextTracker.record(msg.role, msg.content);
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

  private async compactContext(): Promise<void> {
    const maxTokens = this.getContextWindow();
    const usedTokens = this.tokenTracker.tokensUsed;
    const percentage = (usedTokens / maxTokens) * 100;
    if (percentage < 85) return;

    const lastMarkerIdx: number = this.compactionMarkerIndices.length > 0
      ? this.compactionMarkerIndices[this.compactionMarkerIndices.length - 1]!
      : -1;
    const recentMessages = this.messages.slice(lastMarkerIdx + 1)
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');
    if (!recentMessages.trim()) return;

    this.emit({ type: 'compaction_start', currentTokens: usedTokens, threshold: 85 } as EngineEvent);

    let summary = '';
    try {
      summary = await this.simpleComplete(COMPACTION_PROMPT + '\n\n' + recentMessages);
    } catch {
      return;
    }
    if (!summary.trim()) return;

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
    this.emit({ type: 'compaction_complete', saved } as EngineEvent);
  }

  private emit(event: EngineEvent, isUpdate?: boolean): void {
    // Guard against duplicate message_received — only first one wins per turn
    // Pass isUpdate=true to allow re-emitting an updated message (e.g. crew delegation)
    if (event.type === 'message_received' && !isUpdate) {
      if (this._turnMessageEmitted) return;
      this._turnMessageEmitted = true;
    }
    this.eventBus.emit(event);
  }

  private getApiKey(): string | undefined {
    const providerSettings = this.config.provider.providers?.[this.config.provider.activeProvider];
    return providerSettings?.apiKey;
  }

  private getBaseUrl(): string | undefined {
    const providerSettings = this.config.provider.providers?.[this.config.provider.activeProvider];
    return providerSettings?.baseUrl;
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
    // Default context windows by provider
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

  private async *_unifiedStream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const messages = request.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const signal = request.signal || this.abortSignal;

    // Create tools if the request includes tool schemas
    let tools: ToolSet | undefined;
    if (request.tools && request.tools.length > 0 && this.toolRegistry && this.toolExecutor) {
      const toolsAbortController = new AbortController();
      this.scope?.onDispose(() => toolsAbortController.abort());
      tools = createAiSdkTools(
        this.toolRegistry,
        this.toolExecutor,
        this.sessionId,
        (e) => this.emit(e),
        async (question, options, allowFreeform) => {
          this.emit({ type: 'clarification_required', question, options, allowFreeform });
          const response = await new Promise<string>((resolve) => { this.clarificationResolve = resolve; });
          this.clarificationResolve = null;
          return response;
        },
        async (instruction, toolsList, timeout) => {
          const subAgent = new SmartSubAgent({ parentAgent: this, instruction, tools: toolsList, timeout });
          return subAgent.execute();
        },
      );
    }

    yield* aiSdkStream(this.config, messages, tools, signal, this.getApiKey());
  }

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
    } else {
      this.enabledCrewSessionIds.delete(crewId);
      this.crewOrchestrator?.removeMember(crewId);
    }
    this.rebuildSystemPrompt();
  }

  /**
   * Build a concise session context summary for agentic delegation.
   * Used when routing to crew members, sub-agents, or research queries —
   * gives them just enough context to understand the session without
   * overwhelming them with full history.
   */
  buildAgenticContext(): string {
    const recent = this.messages.slice(-12);
    if (recent.length <= 1) return '';

    const parts: string[] = [];

    // Workspace path so delegated agents can explore from the right directory
    if (this.scopePath) {
      parts.push(`Working directory: ${this.scopePath}`);
    }
    const userMsgs = recent.filter(m => m.role === 'user');
    const assistantMsgs = recent.filter(m => m.role === 'assistant');
    const toolMsgs = recent.filter(m => m.role === 'tool');
    const systemMsgs = recent.filter(m => m.role === 'system' && typeof m.content === 'string' && !(m.content as string).startsWith('[tool]') && (m.content as string).length > 20);

    // What the user has been asking
    const lastUser = userMsgs[userMsgs.length - 1];
    if (lastUser && typeof lastUser.content === 'string') {
      const stripped = lastUser.content.replace(/@\w+/g, '').trim();
      if (stripped) parts.push(`User is working on: "${stripped.slice(0, 200)}"`);
    }

    // What's been done so far
    if (toolMsgs.length > 0) {
      const toolsUsed = [...new Set(toolMsgs.map(m => {
        const c = typeof m.content === 'string' ? m.content : '';
        const m2 = c.match(/\[tool\]\s*(\w+)/);
        return m2 ? m2[1] : '';
      }).filter(Boolean))];
      if (toolsUsed.length > 0) {
        parts.push(`Tools used: ${toolsUsed.join(', ')}`);
      }
    }

    // Key assistant responses
    const keyResponses = assistantMsgs
      .filter(m => typeof m.content === 'string' && (m.content as string).length > 10 && (m.content as string).length < 300)
      .slice(-2);
    for (const r of keyResponses) {
      const text = (typeof r.content === 'string' ? r.content : '').replace(/\n/g, ' ').slice(0, 200);
      if (text) parts.push(`Progress: ${text}`);
    }

    // Relevant system context (directory creation, project init, etc.)
    for (const s of systemMsgs.slice(-3)) {
      const text = (typeof s.content === 'string' ? s.content : '').slice(0, 200);
      if (text) parts.push(`Context: ${text}`);
    }

    if (parts.length === 0) return '';
    return `[SESSION CONTEXT]\n${parts.join('\n')}\n[/SESSION CONTEXT]`;
  }

  /**
   * Route a message to specific crew members and return their response(s).
   * Used for explicit @mentions (one or more crews) and auto-delegation.
   */
  private async routeToCrews(members: CrewMember[], cleanContent: string, startTime: number, _classificationContext?: string): Promise<Message> {
    this.emit({ type: 'loading_start', stage: 'crew_routing' });
    const crewPrompt = this.secretSauce.crew.getMultiCrewSystemPrompt() || 'Available crew members: none configured.';

    // Build concise session context so the crew knows what's happening
    const sessionContext = this.buildAgenticContext();
    const result = await this.crewOrchestrator!.processMessage(cleanContent, crewPrompt, members, sessionContext || undefined);

    for (const m of members) {
      this.emit({
        type: 'intent_detected',
        intent: `crew:${m.crew.callsign}`,
        confidence: 1,
        reasons: [`Explicitly mentioned @${m.crew.callsign}`],
      });
    }

    // Emit each crew response as a separate message bubble (natural, no popups)
    let lastMessage: Message | null = null;
    for (const r of result.responses) {
      const responder = this.crewOrchestrator!.getMembers().find(
        (m) => m.crew.name === r.member,
      );
      const crewMember = responder ?? members[0]!;
      if (!crewMember) continue;
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
          callsign: crewMember.crew.callsign,
          color: crewMember.crew.color,
          icon: crewMember.crew.icon,
          confidence: 'high',
          reasons: [`Explicitly mentioned @${crewMember.crew.callsign}`],
        },
      };
      this.messages.push({ role: 'assistant', content: `[Response from ${crewMember.crew.name} (@${crewMember.crew.callsign})]:\n${r.content}` });
      this.contextTracker.record('crew', r.content, r.member);
      this.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
      lastMessage = msg;
    }

    this.emit({ type: 'loading_end' });
    this.lifecycle.forceTransition('idle');
    this.scope = null;
    this.runStateMgr.release(this.sessionId);
    this.commandQueue.release(this.sessionId);
    return lastMessage ?? {
      id: generateMessageId(), sessionId: this.sessionId, role: 'assistant',
      content: '', toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
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
  }

  createChildSession(childId: string): void {
    if (!this.sessionManager) return;
    this.sessionManager.createSession(
      this.config.provider.activeProvider,
      this.config.provider.activeModel,
      this.scopePath,
      childId,
      this.sessionId,
    );
  }

  private detectAtMentions(content: string): string[] {
    const matches = content.matchAll(/@(\w+)/g);
    const mentioned: string[] = [];
    const members = this.getCrewMembers();
    for (const match of matches) {
      const name = match[1]!.toLowerCase();
      const found = members.find(
        (m) => m.crew.callsign.toLowerCase() === name || m.crew.name.toLowerCase() === name || m.crew.id.toLowerCase() === name
      );
      if (found && !mentioned.includes(found.crew.id)) {
        mentioned.push(found.crew.id);
      }
    }
    return mentioned;
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
