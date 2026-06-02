import type {
  Message,
  EngineEvent,
  CompletionRequest,
  CompletionMessage,
  CompletionToolCall,
  CompletionChunk,
  ProviderId,
  AgentXConfig,
  RemediationAction,
  Plan,
  PlanStep,
  ToolResult,
} from '@agentx/shared';
import { generateMessageId, getLogger, resolveSpaceError } from '@agentx/shared';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { ProviderFactory } from '../providers/index.js';
import { AgentEventBus } from '../EventBus.js';
import { TokenTracker } from '../session/TokenTracker.js';
import { SubAgentManager } from './SubAgentManager.js';
import { TaskManager } from './TaskManager.js';
import { Scheduler } from '../scheduler/Scheduler.js';
import { setSchedulerInstance } from '../commands/builtin/schedule.js';
import { setTaskManagerInstance } from '../commands/builtin/tasks.js';
import { setSubAgentManagerInstance } from '../tools/builtin/subagent.js';
import { setToolRegistryInstance } from '../commands/builtin/tools.js';
import { SecretSauceManager } from '../secret-sauce/index.js';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
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
import { setFileWatcherInstance } from '../commands/builtin/watch.js';
import { setBackgroundQueueInstance } from '../commands/builtin/tasks.js';
import { setModelRouterInstance } from '../commands/builtin/route.js';
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
import { TreeOfThoughts } from '../reasoning/TreeOfThoughts.js';
import { ResearchEngine } from '../reasoning/ResearchEngine.js';

// ─── UNIFIED PIPELINE IMPORTS (Phase 1-11 integration) ───
import { InputNormalizer } from '../communication/InputNormalizer.js';
import { PromptComposer } from '../communication/prompt/PromptComposer.js';
import { PromptCache } from '../communication/prompt/PromptCache.js';
import { ErrorClassifier } from '../communication/ErrorClassifier.js';
import { FailoverPolicy } from '../communication/FailoverPolicy.js';
import { StaleWatchdog } from '../communication/StaleWatchdog.js';
import { RetryEngine } from '../communication/RetryEngine.js';
import { SessionProcessor } from '../agent/SessionProcessor.js';
import { EventBroadcaster } from '../communication/EventBroadcaster.js';
import { CompactionManager } from '../communication/CompactionManager.js';
import { TelemetryEmitter } from '../communication/telemetry/TelemetryEmitter.js';
import { LiveProjector } from '../communication/LiveProjector.js';
import { DoomLoopDetector } from '../tools/DoomLoopDetector.js';
import { ParallelClassifier } from '../tools/ParallelClassifier.js';
import { ToolCallRepairer } from '../tools/ToolCallRepairer.js';
import { AuthProfileManager } from '../providers/AuthProfileManager.js';
import { ProviderRouter } from '../providers/ProviderRouter.js';
import { makeRoute, openAIProtocol } from '../providers/routes/Route.js';
import { GenericTransport } from '../providers/transports/GenericTransport.js';
import { VisualEventBridge } from '../communication/visuals/VisualEventBridge.js';
import { CommandQueue } from '../communication/CommandQueue.js';
import { RunStateManager } from '../agent/RunStateManager.js';
import { StreamNormalizer } from '../communication/StreamNormalizer.js';
import { ResponseAssembler } from '../communication/ResponseAssembler.js';
import { IdleTimeoutBreaker } from '../communication/IdleTimeoutBreaker.js';
import { Gateway } from '../gateway/Gateway.js';
import { PluginSystem } from '../plugin/PluginSystem.js';

export interface AgentOptions {
  config: AgentXConfig;
  sessionId: string;
  systemPrompt?: string;
  toolExecutor?: ToolExecutor | EnhancedToolExecutor;
  toolRegistry?: ToolRegistry;
  gitAutoCommit?: boolean;
  gitAware?: boolean;
}

export class Agent {
  private provider: ProviderInterface;
  private eventBus: AgentEventBus;
  private tokenTracker: TokenTracker;
  private messages: CompletionMessage[] = [];
  private config: AgentXConfig;
  private sessionId: string;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private pendingInstruction: string | null = null;
  private _turnStartTokens = 0;
  private _turnStartCost = 0;
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  private scheduler: Scheduler;
  private secretSauce: SecretSauceManager;
  private memoryExtractor: MemoryExtractor | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: EnhancedToolExecutor;
  private toolRegistry?: ToolRegistry;
  private permissionResolve: ((choice: 'allow_once' | 'allow_always' | 'deny') => void) | null = null;
  private cachedModels: Map<string, number> = new Map(); // modelId -> contextWindow
  private groundedModels: Set<string> = new Set(); // models that failed trial this session
  private planMode = false;
  private currentPlan: Plan | null = null;
  private pendingPlanApproval: ((approved: boolean) => void) | null = null;
  private pendingStepApproval: ((stepId: string, approved: boolean, description?: string) => void) | null = null;
  private fallbackModel: string | null = null;
  private gitAutoCommit = false;
  private gitManager: GitManager | null = null;
  private fileWatcher: FileWatcher | null = null;
  private backgroundQueue: BackgroundQueue | null = null;
  private modelRouter: ModelRouter | null = null;
  private userCommandRegistry: UserCommandRegistry | null = null;
  private recipeEngine: RecipeEngine | null = null;
  private promptEngine: PromptEngine;
  private decisionEngine: DecisionEngine;
  private currentIntent: IntentResult | null = null;
  private currentDecision: DecisionResult | null = null;
  private treeOfThoughts: TreeOfThoughts | null = null;
  private researchEngine: ResearchEngine | null = null;
  private lastRagResults: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }> = [];
  private clarificationResolve: ((response: string) => void) | null = null;
  private agentBus: AgentBus;
  private specialistRegistry: SpecialistRegistry;
  private skillGenerator: SkillGenerator;
  private reflectionLoop: ReflectionLoop;
  private toolCallLogForReflection: Array<{ name: string; success: boolean; output: string; elapsed: number }> = [];

  // ─── UNIFIED PIPELINE MODULES ───
  private inputNormalizer: InputNormalizer = null!;
  private promptComposer: PromptComposer = null!;
  private promptCache: PromptCache = null!;
  private errorClassifier: ErrorClassifier = null!;
  private failoverPolicy: FailoverPolicy = null!;
  private compactionManager: CompactionManager = null!;
  private telemetry: TelemetryEmitter = null!;
  private doomLoopDetector: DoomLoopDetector = null!;
  private authProfileManager: AuthProfileManager = null!;
  private providerRouter: ProviderRouter = null!;
  private projector: LiveProjector = null!;
  private parallelClassifier: ParallelClassifier = null!;
  private sessionProcessor: SessionProcessor = null!;
  private retryEngine: RetryEngine = null!;
  private broadcaster: EventBroadcaster = null!;
  private toolCallRepairer: ToolCallRepairer = null!;
  private visualBridge: VisualEventBridge = null!;
  private commandQueue: CommandQueue = null!;
  private runStateMgr: RunStateManager = null!;
  private streamNormalizer: StreamNormalizer = null!;
  private responseAssembler: ResponseAssembler = null!;
  private idleBreaker: IdleTimeoutBreaker = null!;
  private gateway: Gateway = null!;
  private pluginSystem: PluginSystem = null!;

  /**
   * Respond to a pending clarification request.
   */
  respondToClarification(response: string): void {
    if (this.clarificationResolve) {
      this.clarificationResolve(response);
    }
  }

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.eventBus = new AgentEventBus();
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
    setSubAgentManagerInstance(this.subAgents);
    this.taskManager = new TaskManager(this.eventBus);
    setTaskManagerInstance(this.taskManager);
    this.scheduler = new Scheduler(this.eventBus);
    setSchedulerInstance(this.scheduler);
    setIndexerEventBus(this.eventBus);
    this.secretSauce = new SecretSauceManager();
    this.errorShield = new ErrorShield();

    // Set up tools - use provided or create defaults
    if (options.toolExecutor && options.toolRegistry) {
      // Accept both ToolExecutor and EnhancedToolExecutor from options
      if (options.toolExecutor instanceof EnhancedToolExecutor) {
        this.toolExecutor = options.toolExecutor;
      } else if (options.toolExecutor instanceof ToolExecutor && !(options.toolExecutor instanceof EnhancedToolExecutor)) {
        // Wrap plain ToolExecutor in Enhanced for parallel/doom-loop/repair capabilities
        this.toolExecutor = new EnhancedToolExecutor(options.toolRegistry, process.cwd());
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
        this.toolExecutor = new EnhancedToolExecutor(options.toolRegistry, process.cwd());
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
      const toolkit = createDefaultToolkit(process.cwd());
      this.toolRegistry = toolkit.registry;
      // Use EnhancedToolExecutor for parallel/doom-loop/repair capabilities
      this.toolExecutor = new EnhancedToolExecutor(toolkit.registry, process.cwd());
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

    // Wire permission requests to event bus
    if (this.toolExecutor) {
      this.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel) => {
        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          this.permissionResolve = resolve;
          this.emit({ type: 'permission_required', tool: toolId, path, riskLevel });
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
    if (options.gitAware || options.gitAutoCommit) {
      this.gitManager = new GitManager({ scopePath: process.cwd() });
    }

    // Apply git-aware scope if requested
    if (options.gitAware && this.gitManager?.isInsideRepo()) {
      const scopePath = this.gitManager.getRepoRoot();
      if (scopePath && this.toolExecutor) {
        this.toolExecutor.setScopePath(scopePath);
      }
    }

    // Initialize background queue
    this.backgroundQueue = new BackgroundQueue();
    this.backgroundQueue.onComplete((task) => {
      this.eventBus.emit({
        type: 'background_task_complete',
        taskId: task.id,
        summary: `[${task.status}] ${task.command}`.slice(0, 120),
      });
    });
    setBackgroundQueueInstance(this.backgroundQueue);

    // Initialize model router
    this.modelRouter = new ModelRouter();
    setModelRouterInstance(this.modelRouter);

    // Initialize user command registry (loads from config.commands if available)
    {
      const cmdRegistry = new CommandRegistry();
      this.userCommandRegistry = new UserCommandRegistry(cmdRegistry);
      setUserCommandRegistryInstance(this.userCommandRegistry);
      const userCmds = (options.config as unknown as Record<string, unknown>)['commands'] as UserCommandConfig[] | undefined;
      if (userCmds) {
        this.userCommandRegistry.loadFromConfig(userCmds);
      }
    }

    // Initialize recipe engine
    this.recipeEngine = new RecipeEngine();
    setRecipeEngineInstance(this.recipeEngine);
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (homeDir) {
      const recipeDir = join(homeDir, '.config', 'agentx', 'recipes');
      this.recipeEngine.addDirectory(recipeDir);
    }

    // Initialize file watcher for watch mode
    this.fileWatcher = new FileWatcher();
    setFileWatcherInstance(this.fileWatcher);
    this.fileWatcher.on('file_changed', (event, filePath, command) => {
      this.emit({
        type: 'watch_event',
        event,
        filePath,
        command,
        timestamp: Date.now(),
      });
    });

    this.provider = ProviderFactory.create(
      options.config.provider.activeProvider,
      this.getApiKey(),
      this.getBaseUrl(),
    );

    // Initialize prompt engine for token-efficient prompting
    this.promptEngine = new PromptEngine(this.getContextWindow());

    // Initialize decision engine for message classification and routing
    this.decisionEngine = new DecisionEngine();

    // Initialize agent mesh components
    this.agentBus = getAgentBus();
    this.agentBus.attachEventBus(this.eventBus);
    this.specialistRegistry = new SpecialistRegistry(this.agentBus);
    this.specialistRegistry.registerDefaults();
    this.skillGenerator = new SkillGenerator();
    this.reflectionLoop = new ReflectionLoop();

    // Register this agent on the bus
    this.agentBus.registerAgent(this.sessionId, ['main', 'orchestrator']);

    // ─── UNIFIED PIPELINE INITIALIZATION ───
    this.inputNormalizer = new InputNormalizer();
    this.promptCache = new PromptCache();
    this.promptComposer = new PromptComposer();
    this.promptComposer.setCache(this.promptCache);

    const apiKey = this.getApiKey() ?? '';
    this.authProfileManager = new AuthProfileManager();
    if (apiKey) {
      this.authProfileManager.addCredential(options.config.provider.activeProvider, apiKey);
    }
    this.errorClassifier = new ErrorClassifier();
    this.failoverPolicy = new FailoverPolicy(this.authProfileManager);
    this.providerRouter = new ProviderRouter(this.authProfileManager);
    this._registerProviderRoutes(apiKey);

    this.projector = new LiveProjector();
    this.compactionManager = new CompactionManager({ contextLimit: this.getContextWindow() });
    this.parallelClassifier = new ParallelClassifier();
    this.doomLoopDetector = new DoomLoopDetector();
    this.toolCallRepairer = new ToolCallRepairer();
    this.telemetry = new TelemetryEmitter();
    this.visualBridge = new VisualEventBridge();

    // ─── UNIFIED: Remaining modules ───
    this.commandQueue = new CommandQueue();
    this.runStateMgr = new RunStateManager();
    this.streamNormalizer = new StreamNormalizer();
    this.responseAssembler = new ResponseAssembler();
    this.idleBreaker = new IdleTimeoutBreaker();
    this.gateway = new Gateway();
    this.gateway.attachAgent(this as unknown as Agent);
    this.pluginSystem = new PluginSystem({ autoEnable: true });
    this.pluginSystem.startHealthChecks();

    // Unified streaming + retry infrastructure
    this.broadcaster = new EventBroadcaster();
    this.sessionProcessor = new SessionProcessor({
      sessionId: this.sessionId,
      eventBus: this.eventBus,
      broadcaster: this.broadcaster,
      projector: this.projector,
    });
    this.retryEngine = new RetryEngine(this.authProfileManager, {
      providerId: options.config.provider.activeProvider,
      maxRetries: 3,
    });

    // Auto health check on startup (non-blocking)
    // Skip automatic model trial when running under test to avoid
    // consuming mocked provider responses during unit tests.
    if (process.env['NODE_ENV'] !== 'test') {
      this.trialModel(options.config.provider.activeModel).catch(() => { /* silent — will be caught at first actual use */ });
    }

    // Initialize memory extractor for cross-session knowledge
    this.memoryExtractor = new MemoryExtractor(this.provider, this.config.provider.activeModel);

    // Build system prompt from Secret Sauce + user override
    const sauceContext = this.secretSauce.buildSystemContext();

    // Build tool awareness section so the model knows its capabilities
    const toolLines = this.toolRegistry.list().map((t) => `- ${t.id} (${t.name}): ${t.modelDescription}`);
    const toolAwareness = [
      `[TOOLS]`,
      `You have the following tools available:`,
      toolLines.join('\n'),
      ``,
      `[MASTER_CONTROLLER]`,
      `You are a MASTER agent controlling a fleet of sub-agents and tools. Your job: achieve the goal with MINIMUM tokens and MAXIMUM efficiency.`,
      ``,
      `Core Moto: Maximum output with minimum communication. Reach the goal faster. Be precise.`,
      ``,
      `AUTONOMOUS DECISIONS (decide yourself — NEVER ask permission):`,
      `1. SPAWN SUB-AGENTS: When a task is complex or parallelizable, spawn specialists via delegate_to_subagent. Each sub-agent works independently on its piece. The master merges results.`,
      `2. BUILD TODO LISTS: After receiving a multi-step task, auto-create a TODO list with clear items. Mark items in-progress/completed. Update as you work. Use the TODO tracking internally.`,
      `3. INTERNET SEARCH: When you need current information, use web_search/web_scrape without asking.`,
      `4. INTER-AGENT COMMUNICATION: When multiple sub-agents can share findings, use the agent bus to coordinate. Avoid redundant work.`,
      `5. TOOL SELECTION: Pick the right tool for the job. Chain tools efficiently. Minimize tool calls — each call costs time.`,
      `6. FILE OPERATIONS: Read files to understand before modifying. Use code_replace for targeted edits (cheaper than file_write of entire file).`,
      ``,
      `DELEGATION STRATEGY:`,
      `- Simple task (1-3 steps) → do it yourself. Be quick.`,
      `- Medium task (4-8 steps, multiple files) → spawn 2-3 specialists in parallel.`,
      `- Complex task (8+ steps, multi-domain) → decompose into subtasks, spawn specialists, merge results with synthesis.`,
      `- Research task → use web_search + web_scrape. For deep research, spawn researcher sub-agents.`,
      `- Code task → coder + tester + reviewer in parallel for quality.`,
      ``,
      `OUTPUT RULES (CRITICAL — SAVE TOKENS):`,
      `1. PRECISE RESPONSES: Respond with 1-3 sentences for most tasks. Never write paragraphs unless asked.`,
      `2. CONFIRMATION FORMAT: Use "Done: [what you did]" NOT "I have successfully completed the task of..."`,
      `3. ONLY ELABORATE when user explicitly says "explain more", "go deeper", "elaborate".`,
      `4. CODE/TECHNICAL OUTPUT: Be as detailed as necessary. No length limit on code, configs, or structured data.`,
      `5. NEVER REPEAT: Don't restate what the user said. Don't summarize your process. Just deliver the result.`,
      `6. BULLET POINTS > PARAGRAPHS: When listing things, use bullets. Faster to read.`,
      ``,
      `EXECUTION PATTERNS:`,
      `- New project → shell_exec (init) → file_write (configs, source) → shell_exec (install, build, test)`,
      `- Bug fix → code_search → file_read → code_replace → test_run`,
      `- Refactor → file_read → plan → code_replace/file_write → shell_exec (verify)`,
      `- Research → web_search → web_scrape → synthesize → respond concisely`,
      `[/MASTER_CONTROLLER]`,
      ``,
      `[DEVELOPER_EXECUTION]`,
      `You are an expert-level software engineer. When the user asks you to build, create, or fix software:`,
      ``,
      `Architecture approach:`,
      `1. PLAN FIRST — For multi-file tasks, mentally design the structure before writing. Know what files go where and why.`,
      `2. SCAFFOLD → IMPLEMENT → VERIFY — Create directory structure, write files in dependency order (configs first, shared types, then implementation), then run builds/tests to verify.`,
      `3. WRITE COMPLETE FILES — Never write partial code or placeholders like "// TODO: implement". Write full, production-ready implementations. If a function needs 200 lines, write all 200 lines.`,
      `4. ITERATE ON ERRORS — After running builds/tests, if there are errors, read the output, fix the issues, and re-run. Repeat until clean.`,
      `5. FULL-STACK AWARENESS — You can set up entire projects: package.json, tsconfig, Dockerfile, docker-compose, CI/CD configs, cloud infrastructure, databases, APIs, frontends — anything that can be expressed in files + commands.`,
      ``,
      `Execution patterns:`,
      `- New project → shell_exec (mkdir, init commands) → file_write (configs, source files) → shell_exec (install deps, build, test)`,
      `- Bug fix → code_search (find relevant code) → file_read (understand context) → code_replace or file_write (apply fix) → shell_exec (test)`,
      `- Refactor → file_read (understand current state) → plan changes → code_replace/file_write (apply) → shell_exec (ensure builds pass)`,
      `- Infrastructure → file_write (terraform/CDK/compose files) → shell_exec (cloud CLI commands: aws, gcloud, az, kubectl, docker)`,
      `- Microservices → create each service directory, write all source files, shared configs, inter-service communication setup, then build and verify each service`,
      ``,
      `Critical rules:`,
      `- NEVER say "you need to run X" — YOU run it with shell_exec.`,
      `- NEVER say "create a file called X with this content" — YOU write it with file_write.`,
      `- NEVER stop halfway. If you started setting up a project, finish it completely with all files, dependencies installed, and a successful build.`,
      `- If a task is too large for one turn (10 tool calls), complete as much as possible, then continue in the next turn seamlessly.`,
      `- Use shell_exec for: package managers (npm, pnpm, pip, cargo), build tools, test runners, linters, cloud CLIs, docker, git, and any other command-line tool.`,
      `- Read existing code before modifying it — understand the patterns in use.`,
      `- When creating projects, always include: dependency management, build config, and a working entry point at minimum.`,
      `[/DEVELOPER_EXECUTION]`,
      ``,
      `[CURRENT_TIME]`,
      `Now: ${new Date().toISOString()}`,
      `User timezone: ${this.getUserTimezone()}`,
      `Local time (user): ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: this.getUserTimezone() })}`,
      `UTC offset: ${this.getUtcOffset()}`,
      `[/CURRENT_TIME]`,
      ``,
      `[SCHEDULING]`,
      `For reminders and recurring tasks, use the reminder_set tool:`,
      `- "remind me in X" / "ping me in X" / "alert me after X" → one-time (delay_seconds)`,
      `- "remind me at <time>" / "at 5pm" / "at 3:30 PM" → one-time (at_time in ISO 8601, e.g. "2026-05-25T17:04:00+05:30")`,
      `- "remind me every X" / "check every X" / "repeat every X" → recurring (interval_minutes)`,
      `- For absolute times: use [CURRENT_TIME] above to compute the ISO 8601 target. Include timezone offset.`,
      `- Convert relative: "half an hour" = 1800s, "2 hours" = 7200s, "every day" = 1440 min`,
      `- IMPORTANT: If user says a specific clock time, ALWAYS use at_time (not delay_seconds). This avoids calculation errors.`,
      `- Confirm in plain language after setting: "Done! I'll ping you at 5:04 PM."`,
      `[/SCHEDULING]`,
      ``,
      `[/SCHEDULING]`,
      ``,
      `[OUTPUT_FORMAT]`,
      `ALWAYS respond in minimal, precise form. No fluff. Just the result.`,
      `- Replies: 1-3 sentences max. Bullet points preferred over paragraphs.`,
      `- Confirmations: "Done: [what]". Errors: "Failed: [why] — [fix]".`,
      `- Technical output, code, configs: unlimited length. Be thorough.`,
      `[/TOOLS]`,
    ].join('\n');

    // ─── UNIFIED: Inject ReflectionLoop learnings + SkillGenerator skills ───
    const reflectionLearnings = this.reflectionLoop.getCumulativeLearnings();
    const generatedSkills = this.skillGenerator.getAll();
    let augmentedPrompt = toolAwareness;

    if (reflectionLearnings) {
      augmentedPrompt += '\n\n[LEARNINGS]\n' + reflectionLearnings + '\n[/LEARNINGS]';
    }
    if (generatedSkills && generatedSkills.length > 0) {
      augmentedPrompt += '\n\n[SKILLS]\n';
      for (const skill of generatedSkills) {
        augmentedPrompt += `- ${skill.name}: ${skill.description}\n`;
      }
      augmentedPrompt += '[/SKILLS]';
    }

    const systemPrompt = options.systemPrompt
      ? `${sauceContext.full}\n\n${augmentedPrompt}\n\n${options.systemPrompt}`
      : `${sauceContext.full}\n\n${augmentedPrompt}`;

    // Inject user callsign so the agent knows who it's talking to
    const callsign = this.config.user?.callsign;
    const userSection = callsign
      ? `\n\n[USER]\nThe user's name/callsign is "${callsign}". Address them by this name when appropriate.\n[/USER]`
      : '';

    const finalSystemPrompt = systemPrompt + userSection;

    if (finalSystemPrompt) {
      this.messages.push({
        role: 'system',
        content: finalSystemPrompt,
      });
    }

    // Configure sub-agents with provider so they can make real LLM calls
    this.subAgents.configure(this.provider, this.config, finalSystemPrompt ?? '');

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
    return this.isProcessing;
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

  /**
   * Cancel an in-progress completion. Aborts the active stream and tool executions.
   */
  cancel(): void {
    this.runStateMgr.cancel(this.sessionId);
    this.commandQueue.cancelSession(this.sessionId);
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.subAgents.cancelAll();
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
    return this.secretSauce;
  }

  get treeOfThoughtsCapability(): TreeOfThoughts {
    if (!this.treeOfThoughts) {
      this.treeOfThoughts = new TreeOfThoughts({
        provider: this.provider,
        model: this.config.provider.activeModel,
        emit: (event) => this.emit(event),
      });
    }
    return this.treeOfThoughts;
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
    return this.subAgents.spawn(instruction, tools, timeout);
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
    this.planMode = enabled;
    if (enabled) {
      this.emit({ type: 'plan_mode_entered' });
    } else {
      this.currentPlan = null;
      this.emit({ type: 'plan_mode_exited' });
    }
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
        if (/401|Unauthorized|403|Forbidden|404|not found|402|429|quota|billing|Invalid API|suspended/i.test(msg)) {
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

  async sendMessage(content: string, options?: { instruction?: string }): Promise<Message> {
    if (this.isProcessing) {
      throw new Error('Agent is already processing a message');
    }

    this.isProcessing = true;
    this.abortController = new AbortController();

    // ─── UNIFIED: Ensure single session run + enqueue for concurrency ───
    this.runStateMgr.ensureRunning(this.sessionId);
    void this.commandQueue.enqueue(this.sessionId, {
      turnId: `turn-${Date.now()}`,
      sessionId: this.sessionId,
      channel: 'api',
      userId: 'user',
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
    this.messages.push({ role: 'user', content: cleanContent });

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content: cleanContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };

    this.emit({ type: 'message_sent', message: userMessage });

    // ─── DECISION ENGINE: Classify message & determine execution path ───
    const conversationLen = this.messages.filter(m => m.role === 'user').length;
    this.currentDecision = this.decisionEngine.classify(content, conversationLen);
    this.emit({
      type: 'decision_made',
      messageClass: this.currentDecision.messageClass,
      executionPath: this.currentDecision.executionPath,
      confidence: this.currentDecision.confidence,
      reasoning: this.currentDecision.reasoning,
    } as unknown as EngineEvent);

    // ─── FAST REPLY PATH: Greetings, farewells, conversational ───
    if (this.currentDecision.executionPath === 'fast_reply' && this.currentDecision.confidence >= 0.85) {
      this.emit({ type: 'loading_start', stage: 'fast_reply' });
      try {
        const fastMessage = await this.runFastReply(content, startTime);
        return fastMessage;
      } catch (e) {
        // If cancelled/aborted, return cancelled message directly
        if ((e instanceof Error && e.name === 'AbortError') || !this.abortController) {
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
          this.isProcessing = false;
          this.abortController = null;
          return cancelledMessage;
        }
        // Fall through to normal path if fast reply fails for other reasons
        getLogger().warn('FAST_REPLY', 'Fast reply failed, falling through to standard path');
        // ─── Cleanup: close the fast-reply streaming state so the UI
        //     doesn't show duplicate responses when the standard path runs ───
        this.emit({ type: 'loading_end' });
      }
    }

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

    try {
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
          tokenCount: Math.ceil(treeContent.length / 4),
        };

        this.emit({ type: 'loading_end' });
        this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });
        return assistantMessage;
      }

      // Plan mode: generate plan and wait for approval
      if (this.planMode) {
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

        // Execute each approved step sequentially with per-step approval
        const pendingSteps = plan.steps.filter((s) => s.status === 'approved' || s.status === 'pending');
        for (const step of pendingSteps) {
          if (this.abortController?.signal.aborted) break;
          step.status = 'awaiting_approval';
          this.emit({ type: 'plan_step_pending', stepId: step.id, planId: plan.id, description: step.description });

          // Wait for user to approve/skip/modify this step
          const stepAction = await new Promise<{ action: 'approve' | 'skip' | 'modify'; description?: string }>((resolve) => {
            this.pendingStepApproval = (_stepId: string, approved: boolean, description?: string) => {
              if (!approved) {
                resolve({ action: 'skip' });
              } else if (description) {
                resolve({ action: 'modify', description });
              } else {
                resolve({ action: 'approve' });
              }
            };
          });

          if (stepAction.action === 'skip') {
            step.status = 'skipped';
            this.emit({ type: 'plan_step_skipped', stepId: step.id, planId: plan.id });
            continue;
          }

          const stepDescription = stepAction.action === 'modify' && stepAction.description ? stepAction.description : step.description;
          step.status = 'executing';
          this.emit({ type: 'plan_step_executing', stepId: step.id, planId: plan.id, description: stepDescription });

          try {
            const stepResult = await this.runSingleStep(stepDescription);
            step.status = 'done';
            this.emit({ type: 'plan_step_complete', stepId: step.id, planId: plan.id, result: stepResult });
          } catch (stepError) {
            step.status = 'failed';
            this.emit({ type: 'plan_step_failed', stepId: step.id, planId: plan.id, error: (stepError as Error).message });
          }
        }

        this.emit({ type: 'loading_end' });
        const summaryMessage: Message = {
          id: generateMessageId(),
          sessionId: this.sessionId,
          role: 'assistant',
          content: '✓ Plan execution complete.',
          toolCalls: null,
          createdAt: new Date().toISOString(),
          tokenCount: 0,
        };
        this.emit({ type: 'message_received', message: summaryMessage, elapsed: Date.now() - startTime });
        return summaryMessage;
      }

      // Normal mode: run completion loop directly
      if (!(await this.checkConnectivity())) {
        throw new Error('Cannot reach LLM provider. Check your internet connection.');
      }
      const assistantMessage = await this.runCompletionLoop(startTime);

      // Extract and persist memories (non-blocking)
      this.extractMemories(content, assistantMessage.content);

      // Auto-generate skill if task was novel
      if (this.skillGenerator.shouldGenerateSkill(content, this.toolCallLogForReflection)) {
        const toolsForSkill = this.toolCallLogForReflection.map((t) => ({ name: t.name, args: {} as Record<string, unknown> }));
        void this.skillGenerator.generateSkill(this, content, toolsForSkill, assistantMessage.content);
      }

      // Run reflection loop for continuous improvement
      if (this.toolCallLogForReflection.length >= 2) {
        void this.reflectionLoop.reflect(this, content, this.toolCallLogForReflection, assistantMessage.content);
      }

      this.toolCallLogForReflection = [];
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
      const { message: friendlyMessage, actions } = this.toFriendlyError(error);
      this.emit({
        type: 'error',
        code: 'AGENT_ERROR',
        message: friendlyMessage,
        recoverable: true,
        actions,
      });
      throw error;
    } finally {
      this.isProcessing = false;
      this.abortController = null;
      this.runStateMgr.release(this.sessionId);
      this.commandQueue.release(this.sessionId);
    }
  }

  /**
   * Fast reply path for simple messages (greetings, farewells, conversational).
   * Uses minimal system prompt, no tools, no RAG — saves significant tokens.
   */
  private async runFastReply(content: string, startTime: number): Promise<Message> {
    // Build minimal prompt — just identity + user message
    const sauceCtx = this.secretSauce.buildSystemContext(1000);
    const identity = sauceCtx.soul || sauceCtx.crew || '';
    const fastPrompt = this.decisionEngine.buildFastReplyPrompt(identity);

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
      signal: this.abortController?.signal,
    };

    let fullContent = '';
    const streamHandle = await this.retryWithBackoff(async () => {
      const iter = this._unifiedStream(request);
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

    const assistantMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'assistant',
      content: fullContent,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: Math.ceil(fullContent.length / 4),
    };

    this.emit({ type: 'loading_end' });
    this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });

    // Update token tracker
    const tokensUsed = Math.ceil((fastPrompt.length + content.length + fullContent.length) / 4);
    this.tokenTracker.addUsage(tokensUsed);
    const turnTokens = this.tokenTracker.tokensUsed - (this._turnStartTokens ?? 0);
    const costUsd = this.tokenTracker.totalCost - (this._turnStartCost ?? 0);
    this.emit({ type: 'token_usage', totalTokens: this.tokenTracker.tokensUsed, contextWindow: this.getContextWindow(), turnTokens, costUsd } as unknown as EngineEvent);

    // Note: isProcessing and abortController are cleaned up by sendMessage's finally block
    return assistantMessage;
  }

  /**
   * Runs the model completion loop, handling tool calls iteratively.
   * Max 10 tool-call rounds to prevent infinite loops.
   */
  private async runCompletionLoop(startTime: number): Promise<Message> {
    const MAX_TOOL_ROUNDS = 10;
    // Track accumulated content across ALL rounds for proper streaming to UI
    let accumulatedContent = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // ─── SMART TOOL SELECTION ───
      // Filter tools based on detected intent to reduce token usage
      let filteredTools: Array<{ id: string; name: string; modelDescription: string; schema: unknown; category: string; riskLevel: string }> = this.toolRegistry?.list() ?? [];
      if (this.currentIntent && this.toolRegistry) {
        const categoryMap = new Map<string, string>();
        for (const t of this.toolRegistry.list()) {
          categoryMap.set(t.id, t.category ?? 'General');
        }
        const selectedSchemas = this.promptEngine.selectTools(
          this.toolRegistry.toSchemas(),
          this.currentIntent,
          categoryMap,
        );
        filteredTools = selectedSchemas.map((s) => ({
          id: s.function.name,
          name: s.function.name,
          modelDescription: s.function.description,
          schema: s.function.parameters,
          category: categoryMap.get(s.function.name) ?? 'General',
          riskLevel: 'low' as const,
        }));
      }
      const toolSchemas = filteredTools.length > 0
        ? filteredTools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.id,
              description: t.modelDescription,
              parameters: t.schema as unknown as Record<string, unknown>,
            },
          }))
        : undefined;

      // ─── BUILD MESSAGES WITH RAG + COMPACTION ───
      let requestMessages = [...this.messages];

      // Inject per-message instruction as a system directive (not stored in history)
      if (this.pendingInstruction) {
        const userIdx = requestMessages.findLastIndex((m) => m.role === 'user');
        if (userIdx >= 0) {
          requestMessages.splice(userIdx, 0, { role: 'system', content: this.pendingInstruction });
        }
        this.pendingInstruction = null; // Clear after injection
      }

      // Inject RAG results as temporary context
      if (this.lastRagResults.length > 0) {
        const ragCtx = this.promptEngine.buildRagContext(this.lastRagResults);
        // Insert before the last user message
        const userIdx = requestMessages.findLastIndex((m) => m.role === 'user');
        if (userIdx >= 0) {
          requestMessages.splice(userIdx, 0, { role: 'system', content: ragCtx });
        }
      }

      // Inject reasoning directive
      if (this.currentIntent) {
        const reasoningDirective = this.promptEngine.buildReasoningDirective(this.currentIntent.reasoningMode);
        requestMessages.splice(1, 0, { role: 'system', content: reasoningDirective });
      }

      // ─── UNIFIED: Compaction via CompactionManager ───
      const currentTokens = this.tokenTracker.tokensUsed;
      if (this.compactionManager.needsCompaction(currentTokens)) {
        this.emit({ type: 'compaction_start', currentTokens, threshold: Math.floor(this.getContextWindow() * 0.85) });
        try {
          const compactResult = await this.compactionManager.compact(
            this.messages.map((m, i) => ({
              id: `cm-${i}`,
              sessionId: this.sessionId,
              role: m.role as Message['role'],
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              toolCalls: (m.toolCalls ?? []).map((tc) => ({
                id: tc.id, name: tc.function.name, arguments: tc.function.arguments, result: '',
              })),
              tokenCount: Math.ceil((typeof m.content === 'string' ? m.content.length : 0) / 4),
              createdAt: new Date().toISOString(),
            })),
            this.sessionId,
          );
          this.emit({ type: 'compaction_complete', saved: compactResult.tokensSaved });
          this.compactionManager.getGuard().recordCompaction(this.sessionId);
        } catch (e) {
          getLogger().warn('COMPACTION', String(e));
        }
      }
      // Also run the classic PromptEngine compaction as fallback
      const budget = this.promptEngine.calculateBudget(this.messages.length, this.lastRagResults.length > 0);
      const compacted = this.promptEngine.compactConversation(requestMessages, budget.conversation);
      if (compacted.summary) {
        requestMessages = compacted.messages;
      }

      const request: CompletionRequest = {
        model: this.config.provider.activeModel,
        messages: requestMessages,
        stream: true,
        tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
        signal: this.abortController?.signal,
      };

      this.emit({ type: 'loading_start', stage: round === 0 ? 'thinking' : 'tool_execution' });

      // Stream response with retry support
      let fullContent = '';  // Content for THIS round only
      const toolCalls: CompletionToolCall[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let currentToolCall: any = null;
      let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

      const stream = await this.retryWithBackoff(async () => {
        // Force the provider to start streaming — catches network/auth errors early
        const iter = this._unifiedStream(request);
        const it = iter[Symbol.asyncIterator]();
        const first = await it.next();
        return { it, first } as { it: AsyncIterator<CompletionChunk>; first: IteratorResult<CompletionChunk> };
      }, `LLM completion (round ${round})`);

      // Process first chunk
      if (!stream.first.done && stream.first.value) {
        const chunk: CompletionChunk = stream.first.value;
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          accumulatedContent += chunk.content;
          this.emit({ type: 'stream_chunk', content: chunk.content, fullContent: accumulatedContent });
        } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
          this.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
        } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          const tc = chunk.toolCall;
          if (tc.id) {
            // Push previous tool call if exists
            const prev = currentToolCall;
            if (prev && prev.id) {
              toolCalls.push(prev as CompletionToolCall);
            }
            currentToolCall = {
              id: tc.id,
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
              thought_signature: (tc as Record<string, unknown>)['thought_signature'] as string | undefined,
            };
          } else {
            const cur = currentToolCall;
            if (cur && cur.function) {
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
            }
          }
        } else if (chunk.type === 'done' && chunk.usage) {
          lastUsage = chunk.usage;
        }
      }

      // Process remaining chunks
      let next = await stream.it.next();
      while (!next.done) {
        const chunk = next.value;
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          accumulatedContent += chunk.content;
          this.emit({
            type: 'stream_chunk',
            content: chunk.content,
            fullContent: accumulatedContent,
          });
        } else if ((chunk as { type?: string }).type === 'reasoning_delta' && (chunk as { content?: string }).content) {
          this.emit({ type: 'reasoning_delta', content: (chunk as { content: string }).content } as unknown as EngineEvent);
        } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          // Accumulate tool call
          if (chunk.toolCall.id) {
            // New tool call starting
            if (currentToolCall?.id) {
              toolCalls.push(currentToolCall as CompletionToolCall);
            }
            currentToolCall = {
              id: chunk.toolCall.id,
              type: 'function',
              function: {
                name: chunk.toolCall.function?.name ?? '',
                arguments: chunk.toolCall.function?.arguments ?? '',
              },
            };
          } else if (currentToolCall) {
            // Continuation of existing tool call
            if (chunk.toolCall.function?.name) {
              currentToolCall.function = {
                name: (currentToolCall.function?.name ?? '') + chunk.toolCall.function.name,
                arguments: currentToolCall.function?.arguments ?? '',
              };
            }
            if (chunk.toolCall.function?.arguments) {
              currentToolCall.function = {
                name: currentToolCall.function?.name ?? '',
                arguments: (currentToolCall.function?.arguments ?? '') + chunk.toolCall.function.arguments,
              };
            }
          }
        } else if (chunk.type === 'done' && chunk.usage) {
          lastUsage = chunk.usage;
        }
        next = await stream.it.next();
      }

      // Push last accumulated tool call
      if (currentToolCall?.id) {
        toolCalls.push(currentToolCall as CompletionToolCall);
      }

      // If there are tool calls, execute them and loop (do NOT emit loading_end yet)
      if (toolCalls.length > 0) {
        // Add assistant message with tool calls to history
        this.messages.push({
          role: 'assistant',
          content: fullContent || '',
          toolCalls,
        });

        // Execute each tool call
        const specialTools = ['ask_clarification', 'delegate_to_subagent'];
        const regularToolCalls = toolCalls.filter((tc) => !specialTools.includes(tc.function.name));
        const specialToolCallList = toolCalls.filter((tc) => specialTools.includes(tc.function.name));

        // Handle special tools individually first
        for (const tc of specialToolCallList) {
          // ─── CLARIFICATION TOOL ───
          if (tc.function.name === 'ask_clarification') {
            let sargs: Record<string, unknown> = {};
            try { sargs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            this.emit({ type: 'clarification_required', question: String(sargs['question'] ?? 'I need more information to proceed.'), options: Array.isArray(sargs['options']) ? sargs['options'] : [], allowFreeform: Boolean(sargs['allowFreeform'] ?? true) });
            const userResponse = await new Promise<string>((resolve) => { this.clarificationResolve = resolve; });
            this.clarificationResolve = null;
            this.messages.push({ role: 'tool', content: userResponse, toolCallId: tc.id });
            continue;
          }

          // ─── SMART SUBAGENT DELEGATION ───
          if (tc.function.name === 'delegate_to_subagent') {
            let dargs: Record<string, unknown> = {};
            try { dargs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            const subStart = Date.now();
            this.emit({ type: 'tool_executing', tool: 'delegate_to_subagent', description: `Spawning sub-agent: ${dargs['mission']}`, startTime: subStart });
            const subAgent = new SmartSubAgent({ parentAgent: this, instruction: String(dargs['mission'] ?? ''), tools: Array.isArray(dargs['tools']) ? dargs['tools'].map(String) : undefined, timeout: typeof dargs['timeout'] === 'number' ? dargs['timeout'] : 120_000 });
            const subResult = await subAgent.execute();
            const subOutput = subResult.success ? `[Sub-agent completed in ${subResult.elapsed}ms]\n${subResult.output}` : `[Sub-agent failed: ${subResult.output}]`;
            this.emit({ type: 'tool_complete', tool: 'delegate_to_subagent', result: { success: subResult.success, output: subOutput }, elapsed: Date.now() - subStart });
            this.messages.push({ role: 'tool', content: subOutput, toolCallId: tc.id });
            continue;
          }
        }

        // ─── UNIFIED: Batch execute regular tools with parallel classifier ───
        if (regularToolCalls.length > 0) {
          const parsedCalls = regularToolCalls.map((tc) => {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments); } catch { /* bad JSON */ }
            // Doom-loop check per tool
            const doomResult = this.doomLoopDetector.check(this.sessionId, tc.function.name, args);
            if (doomResult.shouldBreak) {
              return { tc, args, skip: true, doomCount: doomResult.consecutiveCount };
            }
            return { tc, args, skip: false, doomCount: 0 };
          });

          const batchCalls = parsedCalls
            .filter((p) => !p.skip)
            .map((p) => ({ id: p.tc.id, name: p.tc.function.name, arguments: p.args }));

          // Execute doom-looped tools — push error messages
          for (const p of parsedCalls) {
            if (p.skip) {
              this.emit({ type: 'error', code: 'DOOM_LOOP', message: `${p.tc.function.name} called ${p.doomCount}x consecutively — breaking loop.`, recoverable: true } as unknown as EngineEvent);
              this.messages.push({ role: 'tool', content: `[DOOM LOOP DETECTED] ${p.tc.function.name} repeated ${p.doomCount} times`, toolCallId: p.tc.id });
            }
          }

          if (batchCalls.length > 0) {
            // Emit tool_executing events
            for (const bc of batchCalls) {
              this.emit({ type: 'tool_executing', tool: bc.name, description: `Executing ${bc.name}`, startTime: Date.now() });
            }

            const batchResults = await this._executeToolBatch(batchCalls, this.sessionId);

            for (const r of batchResults) {
              this.emit({ type: 'tool_complete', tool: r.id, result: { success: r.success, output: r.output }, elapsed: r.elapsed });
              this.telemetry.recordToolCall(`turn-${this._turnStartTokens}`, r.success);
              this.toolCallLogForReflection.push({ name: r.id, success: r.success, output: r.output, elapsed: r.elapsed });

              // Auto-commit after file edit operations
              if (this.gitAutoCommit && this.gitManager && this.isEditTool(r.id) && r.success) {
                const tc = regularToolCalls.find((t) => t.id === r.id);
                if (tc) {
                  try {
                    const a = JSON.parse(tc.function.arguments);
                    const fp = (a['path'] ?? a['file']) as string;
                    if (fp) this.gitManager.commitAfterEdit(fp, this.sessionId);
                  } catch { /* ignore */ }
                }
              }

              this.messages.push({ role: 'tool', content: r.output, toolCallId: r.id });
            }
          }
        }

        // Track token usage for tool-call rounds too
        if (lastUsage) {
          this.tokenTracker.addTokenUsage(lastUsage.inputTokens, lastUsage.outputTokens);
        }

        // Continue the loop — model will see tool results and generate next response
        continue;
      }

      // No tool calls — this is the final assistant response
      // ─── UNIFIED: Record telemetry on final response ───
      this.telemetry.endTurn(`turn-${startTime}`, lastUsage ? { promptTokens: lastUsage.inputTokens, completionTokens: lastUsage.outputTokens, totalTokens: lastUsage.inputTokens + lastUsage.outputTokens } : { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, this.sessionId, this.config.provider.activeProvider);

      // Guard against empty response from model — retry once or return error
      if (!fullContent.trim() && round < MAX_TOOL_ROUNDS - 1) {
        getLogger().warn('COMPLETION', `Empty response from model on round ${round}, retrying...`);
        continue;
      }
      if (!fullContent.trim()) {
        fullContent = 'I apologize, I was unable to generate a response. Please try rephrasing your question.';
        accumulatedContent += fullContent;
        this.emit({ type: 'stream_chunk', content: fullContent, fullContent: accumulatedContent });
      }

      // Emit loading_end now that we have the final response
      this.emit({ type: 'loading_end' });

      this.messages.push({ role: 'assistant', content: accumulatedContent });

      const tokenCount = lastUsage
        ? lastUsage.inputTokens + lastUsage.outputTokens
        : Math.ceil(accumulatedContent.length / 4);
      if (lastUsage) {
        this.tokenTracker.addTokenUsage(lastUsage.inputTokens, lastUsage.outputTokens);
      } else {
        this.tokenTracker.addTokenUsage(Math.ceil(tokenCount * 0.5), Math.ceil(tokenCount * 0.5));
      }

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: accumulatedContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      };

      const elapsed = Date.now() - startTime;
      const turnTokens = this.tokenTracker.tokensUsed - (this._turnStartTokens ?? 0);
      const costUsd = this.tokenTracker.totalCost - (this._turnStartCost ?? 0);
      this.emit({ type: 'token_usage', totalTokens: this.tokenTracker.tokensUsed, contextWindow: this.getContextWindow(), turnTokens, costUsd } as unknown as EngineEvent);
      this.emit({
        type: 'message_received',
        message: assistantMessage,
        elapsed,
      });

      return assistantMessage;
    }

    // ─── UNIFIED: Grace Call (budget-exhausted recovery) ───
    // One extra API call to let the model finish its thought without tool access.
    // Prevents mid-sentence truncation when budget is exhausted.
    if (accumulatedContent.length > 0) {
      const graceInstruction =
        '\n[SYSTEM] You have exhausted your tool budget. Do NOT make any more tool calls. ' +
        'If you were in the middle of a response, please finish your thought concisely. ' +
        'If you were about to start a new tool chain, summarize what remains to be done.';
      this.messages.push({ role: 'user', content: graceInstruction });

      try {
        const graceStream = this._unifiedStream({
          model: this.config.provider.activeModel,
          messages: [...this.messages],
          stream: true,
          tools: [],
          signal: this.abortController?.signal,
        });

        let graceText = '';
        for await (const chunk of graceStream) {
          if (chunk.type === 'text_delta' && chunk.content) {
            graceText += chunk.content;
            accumulatedContent += chunk.content;
            this.emit({ type: 'stream_chunk', content: chunk.content, fullContent: accumulatedContent });
          }
        }

        if (graceText.trim()) {
          this.emit({ type: 'loading_end' });
          this.messages.push({ role: 'assistant', content: accumulatedContent });

          const graceMessage: Message = {
            id: generateMessageId(),
            sessionId: this.sessionId,
            role: 'assistant',
            content: accumulatedContent,
            toolCalls: null,
            createdAt: new Date().toISOString(),
            tokenCount: Math.ceil(accumulatedContent.length / 4),
          };

          this.emit({ type: 'message_received', message: graceMessage, elapsed: Date.now() - startTime });
          return graceMessage;
        }
      } catch {
        // Grace call failed — fall through to fallback
      }
    }

    // Exhausted rounds — return what we have
    this.emit({ type: 'loading_end' });
    const fallback: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'assistant',
      content: 'I apologize, I ran into a processing limit. Please try a simpler request.',
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };
    this.emit({ type: 'message_received', message: fallback, elapsed: Date.now() - startTime });
    return fallback;
  }

  /**
   * Execute a single plan step as a self-contained completion.
   */
  private async runSingleStep(stepDescription: string): Promise<ToolResult> {
    const toolSchemas = this.toolRegistry ? this.toolRegistry.toSchemas() : undefined;

    const request: CompletionRequest = {
      messages: [
        ...this.messages.slice(-10),
        { role: 'user', content: `Execute this step: ${stepDescription}\nUse the available tools as needed. Return a summary when done.` },
      ],
      model: this.config.provider.activeModel,
      maxTokens: 4000,
      stream: true,
      tools: toolSchemas,
    };

    const stream = this._unifiedStream(request);
    let fullContent = '';
    const toolCalls: CompletionToolCall[] = [];
    let currentToolCall: Partial<CompletionToolCall> | null = null;

    for await (const chunk of stream) {
      if (chunk.type === 'text_delta' && chunk.content) {
        fullContent += chunk.content;
      } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
        if (chunk.toolCall.id) {
          if (currentToolCall?.id) toolCalls.push(currentToolCall as CompletionToolCall);
          currentToolCall = {
            id: chunk.toolCall.id,
            type: 'function',
            function: { name: chunk.toolCall.function?.name ?? '', arguments: chunk.toolCall.function?.arguments ?? '' },
          };
        } else if (currentToolCall) {
          if (chunk.toolCall.function?.name) {
            currentToolCall.function = { name: (currentToolCall.function?.name ?? '') + chunk.toolCall.function.name, arguments: currentToolCall.function?.arguments ?? '' };
          }
          if (chunk.toolCall.function?.arguments) {
            currentToolCall.function = { name: currentToolCall.function?.name ?? '', arguments: (currentToolCall.function?.arguments ?? '') + chunk.toolCall.function.arguments };
          }
        }
      }
    }
    if (currentToolCall?.id) toolCalls.push(currentToolCall as CompletionToolCall);

    // Execute accumulated tool calls
    for (const tc of toolCalls) {
      const toolStartTime = Date.now();
      this.emit({ type: 'tool_executing', tool: tc.function.name, description: `Plan step: ${stepDescription}`, startTime: toolStartTime });
      try {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* bad JSON */ }
        const result = await this.toolExecutor?.execute(tc.function.name, args, this.sessionId);
        if (result) {
          if (this.gitAutoCommit && this.gitManager && this.isEditTool(tc.function.name) && result.success) {
            const filePath = (args['path'] ?? args['file'] ?? '') as string;
            if (filePath) this.gitManager.commitAfterEdit(filePath, this.sessionId);
          }
          this.emit({ type: 'tool_complete', tool: tc.function.name, result, elapsed: Date.now() - toolStartTime });
        }
      } catch (err) {
        const errorResult: ToolResult = { success: false, output: (err as Error).message, error: 'STEP_ERROR' };
        this.emit({ type: 'tool_complete', tool: tc.function.name, result: errorResult, elapsed: Date.now() - toolStartTime });
      }
    }

    return { success: true, output: fullContent || `Step completed: ${stepDescription}` };
  }

  /**
   * Extract memorable facts from the exchange and persist them.
   * Runs asynchronously and silently — never blocks the main flow.
   */
  private extractMemories(userMessage: string, assistantResponse: string): void {
    if (!this.memoryExtractor) return;

    void this.memoryExtractor.extract(userMessage, assistantResponse).then((memories) => {
      for (const mem of memories) {
        this.secretSauce.recordMemory(mem.content, mem.category);
        // Update identity name when user gives a name instruction
        if (mem.category === 'identity') {
          const nameMatch = mem.content.match(/(?:called|name is|go by|known as|address(?:ed)? as|be called)\s+["']?(\w+)/i);
          if (nameMatch) {
            this.secretSauce.identity.setName(nameMatch[1]!);
          }
        }
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

  /**
   * Rebuild the full system prompt from current crew, tools, and secret sauce.
   * Call this after crew switch to apply the new persona.
   */
  rebuildSystemPrompt(): void {
    const sauceContext = this.secretSauce.buildSystemContext();
    const toolLines = (this.toolRegistry?.list() ?? []).map((t) => `- ${t.id} (${t.name}): ${t.modelDescription}`);
    const toolAwareness = [
      `[TOOLS]`,
      `You have the following tools available:`,
      toolLines.join('\n'),
      ``,
      `[AUTONOMOUS_EXECUTION]`,
      `You are a fully autonomous agent. Your job is to COMPLETE tasks, not describe them.`,
      ``,
      `Core principles:`,
      `1. INTERPRET INTENT — Understand what the user truly wants from their natural language. "Ping me in telegram" means set a reminder. "Save this" means write to a file. "Check my code" means read + analyze.`,
      `2. ACT IMMEDIATELY — If you can determine what tools to use, use them. Do NOT ask the user which tool to use or how — that's YOUR job.`,
      `3. CHAIN TOOLS — Complex tasks need multiple tools. Plan the sequence, then execute them one by one.`,
      `4. INFER PARAMETERS — Derive tool parameters from context. Never ask for what you can infer.`,
      `5. SELF-CORRECT — If a tool fails, try an alternative approach.`,
      `6. MULTI-STEP AUTONOMY — You can call up to 10 tools in a single turn. Use as many as needed.`,
      ``,
      `Decision framework:`,
      `- User mentions time/reminder/notify/ping → reminder_set`,
      `- User mentions files/code/read/write/create → filesystem or code tools`,
      `- User mentions run/execute/install/build → shell_exec`,
      `- User mentions git/commit/push/branch → git tools`,
      `- User mentions search/find/look for → code_search or folder_list`,
      `- User mentions document/report/pdf/excel → document creation tools`,
      `- Ambiguous request → ask ONE clarifying question, then act`,
      `[/AUTONOMOUS_EXECUTION]`,
      ``,
      `[DEVELOPER_EXECUTION]`,
      `You are an expert-level software engineer. When the user asks you to build, create, or fix software:`,
      ``,
      `Architecture approach:`,
      `1. PLAN FIRST — For multi-file tasks, mentally design the structure before writing.`,
      `2. SCAFFOLD → IMPLEMENT → VERIFY — Create dirs, write files in dependency order, then run builds/tests.`,
      `3. WRITE COMPLETE FILES — Never write partial code or placeholders. Write full, production-ready implementations.`,
      `4. ITERATE ON ERRORS — If builds/tests fail, read output, fix issues, re-run until clean.`,
      `5. FULL-STACK AWARENESS — Set up entire projects: configs, infra, databases, APIs, frontends — anything expressible in files + commands.`,
      ``,
      `Critical rules:`,
      `- NEVER say "you need to run X" — YOU run it with shell_exec.`,
      `- NEVER say "create a file called X" — YOU write it with file_write.`,
      `- NEVER stop halfway. Finish completely with all files, deps installed, and a successful build.`,
      `- If too large for one turn, complete as much as possible, then continue next turn seamlessly.`,
      `- Use shell_exec for: package managers, build tools, test runners, cloud CLIs, docker, git.`,
      `- Read existing code before modifying — understand the patterns in use.`,
      `[/DEVELOPER_EXECUTION]`,
      ``,
      `[CURRENT_TIME]`,
      `Now: ${new Date().toISOString()}`,
      `User timezone: ${this.getUserTimezone()}`,
      `Local time (user): ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: this.getUserTimezone() })}`,
      `UTC offset: ${this.getUtcOffset()}`,
      `[/CURRENT_TIME]`,
      ``,
      `[SCHEDULING]`,
      `For reminders and recurring tasks, use the reminder_set tool:`,
      `- "remind me in X" / "ping me in X" / "alert me after X" → one-time (delay_seconds)`,
      `- "remind me at <time>" / "at 5pm" / "at 3:30 PM" → one-time (at_time in ISO 8601, e.g. "2026-05-25T17:04:00+05:30")`,
      `- "remind me every X" / "check every X" / "repeat every X" → recurring (interval_minutes)`,
      `- For absolute times: use [CURRENT_TIME] above to compute the ISO 8601 target. Include timezone offset.`,
      `- Convert relative: "half an hour" = 1800s, "2 hours" = 7200s, "every day" = 1440 min`,
      `- IMPORTANT: If user says a specific clock time, ALWAYS use at_time (not delay_seconds). This avoids calculation errors.`,
      `- Confirm in plain language after setting: "Done! I'll ping you at 5:04 PM."`,
      `[/SCHEDULING]`,
      ``,
      `[OUTPUT_FORMAT]`,
      `ALWAYS respond in minimal, precise form. No fluff. Just the result.`,
      `- Replies: 1-3 sentences max. Bullet points preferred over paragraphs.`,
      `- Confirmations: "Done: [what]". Errors: "Failed: [why] — [fix]".`,
      `- Technical output, code, configs: unlimited length. Be thorough.`,
      `[/TOOLS]`,
    ].join('\n');

    const prompt = `${sauceContext.full}\n\n${toolAwareness}`;

    // Inject user callsign
    const callsign = this.config.user?.callsign;
    const userSection = callsign
      ? `\n\n[USER]\nThe user's name/callsign is "${callsign}". Address them by this name when appropriate.\n[/USER]`
      : '';

    this.setSystemPrompt(prompt + userSection);
  }

  switchProvider(providerId: ProviderId, apiKey?: string, baseUrl?: string): void {
    this.provider = ProviderFactory.create(providerId, apiKey, baseUrl);
    this.config.provider.activeProvider = providerId;
  }

  switchModel(modelId: string, contextWindow?: number): void {
    this.config.provider.activeModel = modelId;

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
      const spaceErr = resolveSpaceError(err);
      this.emit({
        type: 'error',
        code: 'MODEL_TRIAL_FAILED',
        message: `${spaceErr.icon} ${spaceErr.title} — Model "${modelId}" failed pre-flight check. ${spaceErr.message}`,
        recoverable: true,
        actions: [
          { type: 'switch_model', label: 'Pick a different model' },
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
  respondToPermission(choice: 'allow_once' | 'allow_always' | 'deny'): void {
    if (this.permissionResolve) {
      this.permissionResolve(choice);
      this.permissionResolve = null;
    }
  }

  getMessageHistory(): CompletionMessage[] {
    return [...this.messages];
  }

  /**
   * Add a message to the history (used for restoring sessions).
   */
  addToHistory(msg: { role: 'user' | 'assistant'; content: string }): void {
    this.messages.push({ role: msg.role, content: msg.content });
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
    this.isProcessing = true;
    this.abortController = new AbortController();

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
        tokenCount: Math.ceil(report.length / 4),
      };

      this.emit({ type: 'loading_end' });
      this.emit({ type: 'message_received', message: assistantMessage, elapsed: Date.now() - startTime });
      return assistantMessage;
    } catch (error) {
      this.emit({ type: 'loading_end' });
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  /**
   * End the session — records diary entry and updates identity.
   */
  endSession(): void {
    try {
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
      subtasks.push({ specialist: 'coder' as SpecialistType, instruction: task });
    }

    this.emit({ type: 'decomposition_ready', subtaskCount: subtasks.length });

    // Spawn parallel sub-agents
    const subPromises = subtasks.map(async ({ specialist, instruction }) => {
      const spec = this.specialistRegistry.getByType(specialist)!;
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

    const subResults = await Promise.all(subPromises);

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
  get skillGeneratorInstance(): SkillGenerator { return this.skillGenerator; }
  get reflectionLoopInstance(): ReflectionLoop { return this.reflectionLoop; }

  private emit(event: EngineEvent): void {
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

  private isEditTool(toolId: string): boolean {
    const editTools = new Set([
      'file_write', 'file_delete', 'folder_move', 'file_copy',
      'code_replace', 'code_insert', 'file_patch',
      'folder_create', 'folder_delete',
    ]);
    return editTools.has(toolId);
  }

  // ─── UNIFIED PIPELINE: Provider route registration ───

  private _registerProviderRoutes(apiKey: string): void {
    // In test environments, skip route registration so tests use mocked provider.complete()
    // In production (NODE_ENV not 'test'), register routes to use ProviderRouter + transports
    const isTest = process.env['NODE_ENV'] === 'test';
    if (!apiKey || isTest) return;

    const provider = this.config.provider.activeProvider;
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return;

    const routeId = `${provider}-chat`;
    const route = makeRoute({
      id: routeId,
      provider,
      protocol: openAIProtocol(),
      endpoint: {
        baseUrl: baseUrl || 'https://api.openai.com/v1',
        path: '/chat/completions',
      },
      auth: {
        type: 'api-key',
        getHeaders: async () => ({
          Authorization: `Bearer ${apiKey}`,
        }),
      },
      framing: 'sse',
    });

    this.providerRouter.registerRoute(route, new GenericTransport(route));
  }

  // ─── UNIFIED PIPELINE: Unified streaming with ProviderRouter ───

  private async *_unifiedStream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const plan = this._buildProviderPlan(request);

    let transport;
    try {
      transport = this.providerRouter.route(plan);
    } catch {
      // No registered route — fall back to legacy provider.complete()
      yield* this.provider.complete(request);
      return;
    }

    const abortSignal = request.signal || this.abortController?.signal;
    const watchdog = new StaleWatchdog(90000, 60000);

    try {
      const stream = transport.stream(plan, abortSignal || watchdog.signal);

      for await (const event of stream) {
        watchdog.poke();

        // ─── UNIFIED: Normalize provider events through StreamNormalizer ───
        const normalized = this.streamNormalizer.normalize(event);
        const events = Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];

        for (const ev of events.length > 0 ? events : [event]) {
          // ─── UNIFIED: Feed response assembler + visual bridge ───
          this.responseAssembler.feed(ev);
        const visualUpdate = this.visualBridge.handleEvent(event);
        if (visualUpdate) {
          this.eventBus.emit({
            type: 'agent_message',
            message: visualUpdate as unknown as Record<string, unknown>,
          });
        }

        // ─── UNIFIED: Feed SessionProcessor for structured turn processing ───
        this.sessionProcessor['handleEvent']?.(event);

        switch (event.type) {
          case 'text.delta':
            this.projector.appendDelta(event.delta);
            yield { type: 'text_delta', content: event.delta };
            break;
          case 'tool.input.start':
            yield { type: 'tool_call_delta', toolCall: { id: event.toolCallId, type: 'function', function: { name: event.toolName, arguments: '' } } };
            break;
          case 'tool.input.delta':
            yield { type: 'tool_call_delta', toolCall: { id: event.toolCallId, type: 'function', function: { name: '', arguments: event.delta } } };
            break;
          case 'tool.input.end':
            break;
          case 'turn.end':
            yield { type: 'done', usage: { inputTokens: event.usage.promptTokens, outputTokens: event.usage.completionTokens } };
            return;
          case 'provider.error': {
            const classified = this.errorClassifier.classify(
              new Error(`Provider error: ${event.code} - ${event.message}`),
            );
            const action = this.failoverPolicy.decide(
              classified,
              0,
              this.config.provider.activeProvider,
            );
            throw new Error(
              `${classified.reason}: ${event.message} [action: ${action.type}]`,
            );
          }
          default:
            break;
        }
        } // inner event loop (StreamNormalizer)
      }
    } catch (streamErr) {
      // ─── UNIFIED: Log retry via RetryEngine status buffer ───
      this.retryEngine.getStatusBuffer().add(
        plan.requestId,
        `Stream error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
      );
      throw streamErr;
    } finally {
      watchdog.clear();
    }
  }

  private _buildProviderPlan(request: CompletionRequest): import('@agentx/shared').ProviderPlan {
    const routeId = `${this.config.provider.activeProvider}-chat`;
    return {
      requestId: `req-${Date.now()}`,
      sessionId: this.sessionId,
      providerId: this.config.provider.activeProvider,
      modelId: request.model,
      messages: request.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })),
      tools: (request.tools ?? []).map((t) => ({
        type: 'function' as const,
        function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
      })),
      toolChoice: request.tools && request.tools.length > 0 ? 'auto' : 'none',
      generation: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
      http: {
        timeoutMs: 120000,
        maxRetries: 3,
        headers: {},
      },
      route: routeId,
    };
  }

  // ─── UNIFIED PIPELINE: Retry-wrapped provider call ───

  // _retryableStream kept as available infrastructure for future integration

  // ─── UNIFIED PIPELINE: Batch tool execution with parallel classifier ───

  private async _executeToolBatch(
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
    sessionId: string,
  ): Promise<Array<{ id: string; success: boolean; output: string; error?: string; elapsed: number }>> {
    // Classify for parallel execution
    const classified = this.parallelClassifier.classify(
      toolCalls.map((tc) => ({
        toolCallId: tc.id,
        tool: {
          id: tc.name,
          name: tc.name,
          description: '',
          modelDescription: '',
          category: 'ai_meta' as const,
          riskLevel: 'medium' as const,
          schema: { type: 'object' as const, properties: {} },
          composable: false,
          source: 'builtin' as const,
        },
        args: tc.arguments,
      })),
    );

    const results: Array<{ id: string; success: boolean; output: string; error?: string; elapsed: number }> = [];
    const executed = new Set<string>();

    const execOne = async (tc: typeof toolCalls[number]) => {
      const start = Date.now();
      // ─── UNIFIED: Repair tool name via ToolCallRepairer ───
      const knownNames = this.toolRegistry?.list().map((t) => t.name) ?? [];
      const repairedName = this.toolCallRepairer.repairToolName(tc.name, knownNames);
      const effectiveName = repairedName !== tc.name ? repairedName : tc.name;

      try {
        const result = this.toolExecutor
          ? await this.toolExecutor.execute(effectiveName, tc.arguments, sessionId)
          : { success: false, output: 'No executor', error: 'NO_EXECUTOR' };
        results.push({ id: tc.id, success: result.success, output: result.output, error: result.error, elapsed: Date.now() - start });
      } catch (err) {
        results.push({ id: tc.id, success: false, output: String(err), error: 'EXEC_ERROR', elapsed: Date.now() - start });
      }
    };

    // Execute parallel batch first
    if (classified.parallel.length > 0) {
      const parallelCalls = classified.parallel.map((ct) => toolCalls.find((tc) => tc.id === ct.toolCallId)).filter((tc): tc is typeof toolCalls[number] => !!tc);
      await Promise.all(parallelCalls.map((tc) => { executed.add(tc.id); return execOne(tc); }));
    }

    // Then sequential
    for (const ct of classified.sequential) {
      const tc = toolCalls.find((t) => t.id === ct.toolCallId);
      if (tc && !executed.has(tc.id)) {
        executed.add(tc.id);
        await execOne(tc);
      }
    }

    // Any remaining (shouldn't happen, but safety)
    for (const tc of toolCalls) {
      if (!executed.has(tc.id)) {
        executed.add(tc.id);
        await execOne(tc);
      }
    }

    return results;
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
