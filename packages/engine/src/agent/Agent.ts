import type {
  Message,
  EngineEvent,
  CompletionRequest,
  CompletionMessage,
  CompletionToolCall,
  ProviderId,
  AgentXConfig,
  RemediationAction,
} from '@agentx/shared';
import { generateMessageId, getLogger, resolveSpaceError } from '@agentx/shared';
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
import { SecretSauceManager } from '../secret-sauce/index.js';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
import { ErrorShield } from './ErrorShield.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { createDefaultToolkit } from '../tools/toolkit.js';

export interface AgentOptions {
  config: AgentXConfig;
  sessionId: string;
  systemPrompt?: string;
  toolExecutor?: ToolExecutor;
  toolRegistry?: ToolRegistry;
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
  private subAgents: SubAgentManager;
  private taskManager: TaskManager;
  private scheduler: Scheduler;
  private secretSauce: SecretSauceManager;
  private memoryExtractor: MemoryExtractor | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: ToolExecutor;
  private toolRegistry?: ToolRegistry;
  private permissionResolve: ((choice: 'allow_once' | 'allow_always' | 'deny') => void) | null = null;
  private cachedModels: Map<string, number> = new Map(); // modelId -> contextWindow
  private groundedModels: Set<string> = new Set(); // models that failed trial this session

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
    this.secretSauce = new SecretSauceManager();
    this.errorShield = new ErrorShield();

    // Set up tools - use provided or create defaults
    if (options.toolExecutor && options.toolRegistry) {
      this.toolExecutor = options.toolExecutor;
      this.toolRegistry = options.toolRegistry;
    } else {
      const toolkit = createDefaultToolkit(process.cwd());
      this.toolExecutor = toolkit.executor;
      this.toolRegistry = toolkit.registry;
    }

    // Wire permission requests to event bus
    if (this.toolExecutor) {
      this.toolExecutor.setPermissionRequestHandler(async (toolId, path, riskLevel) => {
        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          this.permissionResolve = resolve;
          this.emit({ type: 'permission_required', tool: toolId, path, riskLevel });
        });
      });
    }

    this.provider = ProviderFactory.create(
      options.config.provider.activeProvider,
      this.getApiKey(),
      this.getBaseUrl(),
    );

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
      `[AUTONOMOUS_EXECUTION]`,
      `You are a fully autonomous agent. Your job is to COMPLETE tasks, not describe them.`,
      ``,
      `Core principles:`,
      `1. INTERPRET INTENT — Understand what the user truly wants from their natural language. "Ping me in telegram" means set a reminder. "Save this" means write to a file. "Check my code" means read + analyze.`,
      `2. ACT IMMEDIATELY — If you can determine what tools to use, use them. Do NOT ask the user which tool to use or how — that's YOUR job.`,
      `3. CHAIN TOOLS — Complex tasks need multiple tools. Plan the sequence, then execute them one by one. Example: "Create a project summary" → code_search → file_read (multiple files) → file_write (summary).`,
      `4. INFER PARAMETERS — Derive tool parameters from context. If the user says "remind me in 5 minutes to stretch", you know: name="stretch", message="Time to stretch!", delay_seconds=300. Never ask for what you can infer.`,
      `5. SELF-CORRECT — If a tool fails, try an alternative approach. If file_read fails, maybe the path is wrong — use folder_list to find it.`,
      `6. MULTI-STEP AUTONOMY — You can call up to 10 tools in a single turn. Use as many as needed to fully complete the task before responding.`,
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
      `[COMMUNICATION_STYLE]`,
      `- KEEP RESPONSES SHORT. 1-3 sentences for conversational replies. No paragraphs, no walls of text.`,
      `- Only elaborate when the user explicitly asks: "explain more", "go deeper", "elaborate", "define", "tell me more".`,
      `- Use simple, everyday language. NO technical jargon unless the user's crew is technical.`,
      `- Never ask for cron expressions, URLs, file paths, commands, or API details — figure it out yourself.`,
      `- If the request is clear enough to act on, ACT. Don't ask unnecessary questions.`,
      `- When you must ask, keep it natural: "What should I remind you about?" not "Provide the instruction payload."`,
      `- After completing a task, briefly confirm what you did. Don't over-explain.`,
      `- For tool outputs, schemas, code, and structured data: no length limit. Be as detailed as needed.`,
      `[/COMMUNICATION_STYLE]`,
      `[/TOOLS]`,
    ].join('\n');

    const systemPrompt = options.systemPrompt
      ? `${sauceContext.full}\n\n${toolAwareness}\n\n${options.systemPrompt}`
      : `${sauceContext.full}\n\n${toolAwareness}`;

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

  /**
   * Cancel an in-progress completion. Aborts the active stream and tool executions.
   */
  cancel(): void {
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

  /**
   * Spawn a sub-agent to handle a delegated task.
   */
  spawnSubAgent(instruction: string, tools: string[], timeout?: number) {
    return this.subAgents.spawn(instruction, tools, timeout);
  }

  async sendMessage(content: string): Promise<Message> {
    if (this.isProcessing) {
      throw new Error('Agent is already processing a message');
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const startTime = Date.now();

    // Add user message
    this.messages.push({ role: 'user', content });

    const userMessage: Message = {
      id: generateMessageId(),
      sessionId: this.sessionId,
      role: 'user',
      content,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };

    this.emit({ type: 'message_sent', message: userMessage });

    try {
      const assistantMessage = await this.runCompletionLoop(startTime);

      // Extract and persist memories (non-blocking)
      this.extractMemories(content, assistantMessage.content);

      return assistantMessage;
    } catch (error) {
      this.emit({ type: 'loading_end' });

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
    }
  }

  /**
   * Runs the model completion loop, handling tool calls iteratively.
   * Max 10 tool-call rounds to prevent infinite loops.
   */
  private async runCompletionLoop(startTime: number): Promise<Message> {
    const MAX_TOOL_ROUNDS = 10;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Build tools schema from registry
      const toolSchemas = this.toolRegistry
        ? this.toolRegistry.toSchemas()
        : undefined;

      const request: CompletionRequest = {
        model: this.config.provider.activeModel,
        messages: this.messages,
        stream: true,
        tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
        signal: this.abortController?.signal,
      };

      this.emit({ type: 'loading_start', stage: round === 0 ? 'thinking' : 'tool_execution' });

      // Stream response
      let fullContent = '';
      const toolCalls: CompletionToolCall[] = [];
      let currentToolCall: Partial<CompletionToolCall> | null = null;
      let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of this.provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          this.emit({
            type: 'stream_chunk',
            content: chunk.content,
            fullContent,
          });
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
      }

      // Push last accumulated tool call
      if (currentToolCall?.id) {
        toolCalls.push(currentToolCall as CompletionToolCall);
      }

      this.emit({ type: 'loading_end' });

      // If there are tool calls, execute them and loop
      if (toolCalls.length > 0) {
        // Add assistant message with tool calls to history
        this.messages.push({
          role: 'assistant',
          content: fullContent || '',
          toolCalls,
        });

        // Execute each tool call
        for (const tc of toolCalls) {
          const toolStartTime = Date.now();
          this.emit({
            type: 'tool_executing',
            tool: tc.function.name,
            description: `Executing ${tc.function.name}`,
            startTime: toolStartTime,
          });

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            // Bad JSON from model
          }

          const result = this.toolExecutor
            ? await this.toolExecutor.execute(tc.function.name, args, this.sessionId)
            : { success: false, output: 'No tool executor configured', error: 'NO_EXECUTOR' };

          this.emit({
            type: 'tool_complete',
            tool: tc.function.name,
            result,
            elapsed: Date.now() - toolStartTime,
          });

          // Add tool result message
          this.messages.push({
            role: 'tool',
            content: result.output,
            toolCallId: tc.id,
          });
        }

        // Track token usage for tool-call rounds too
        if (lastUsage) {
          this.tokenTracker.addUsage(lastUsage.inputTokens + lastUsage.outputTokens);
        }

        // Continue the loop — model will see tool results and generate next response
        continue;
      }

      // No tool calls — this is the final assistant response
      this.messages.push({ role: 'assistant', content: fullContent });

      const tokenCount = lastUsage
        ? lastUsage.inputTokens + lastUsage.outputTokens
        : Math.ceil(fullContent.length / 4);
      this.tokenTracker.addUsage(tokenCount);

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: fullContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount,
      };

      const elapsed = Date.now() - startTime;
      this.emit({
        type: 'message_received',
        message: assistantMessage,
        elapsed,
      });

      return assistantMessage;
    }

    // Exhausted rounds — return what we have
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
      `[COMMUNICATION_STYLE]`,
      `- KEEP RESPONSES SHORT. 1-3 sentences for conversational replies. No paragraphs, no walls of text.`,
      `- Only elaborate when the user explicitly asks: "explain more", "go deeper", "elaborate", "define", "tell me more".`,
      `- Use simple, everyday language. NO technical jargon unless the user's crew is technical.`,
      `- Never ask for cron expressions, URLs, file paths, commands, or API details — figure it out yourself.`,
      `- If the request is clear enough to act on, ACT. Don't ask unnecessary questions.`,
      `- When you must ask, keep it natural: "What should I remind you about?" not "Provide the instruction payload."`,
      `- After completing a task, briefly confirm what you did. Don't over-explain.`,
      `- For tool outputs, schemas, code, and structured data: no length limit. Be as detailed as needed.`,
      `[/COMMUNICATION_STYLE]`,
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

  switchModel(modelId: string): void {
    this.config.provider.activeModel = modelId;
    // Update token tracker with model's context window
    const ctx = this.cachedModels.get(modelId);
    if (ctx) {
      this.tokenTracker.setTotal(ctx);
    }
    this.emit({ type: 'command_action', action: 'model_switched', modelId });
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
}
