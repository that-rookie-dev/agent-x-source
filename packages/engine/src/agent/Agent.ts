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
import { generateMessageId } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { ProviderFactory } from '../providers/index.js';
import { AgentEventBus } from '../EventBus.js';
import { TokenTracker } from '../session/TokenTracker.js';
import { SubAgentManager } from './SubAgentManager.js';
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
  private subAgents: SubAgentManager;
  private secretSauce: SecretSauceManager;
  private memoryExtractor: MemoryExtractor | null = null;
  private errorShield: ErrorShield;
  private toolExecutor?: ToolExecutor;
  private toolRegistry?: ToolRegistry;
  private permissionResolve: ((choice: 'allow_once' | 'allow_always' | 'deny') => void) | null = null;
  private cachedModels: Map<string, number> = new Map(); // modelId -> contextWindow

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.eventBus = new AgentEventBus();
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
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
    const systemPrompt = options.systemPrompt
      ? `${sauceContext.full}\n\n${options.systemPrompt}`
      : sauceContext.full;

    if (systemPrompt) {
      this.messages.push({
        role: 'system',
        content: systemPrompt,
      });
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

  get agents(): SubAgentManager {
    return this.subAgents;
  }

  get sauce(): SecretSauceManager {
    return this.secretSauce;
  }

  /**
   * Spawn a sub-agent to handle a delegated task.
   */
  spawnSubAgent(instruction: string, tools: string[], timeout?: number) {
    const task = this.subAgents.spawn(instruction, tools, timeout);
    this.subAgents.start(task.id);

    // Execute asynchronously
    this.executeSubAgent(task.id, instruction, tools).catch((err) => {
      this.subAgents.fail(task.id, err instanceof Error ? err.message : 'Unknown error');
    });

    return task;
  }

  private async executeSubAgent(agentId: string, instruction: string, tools: string[]): Promise<void> {
    // Create a lightweight sub-agent with limited tools
    const subAgent = new Agent({
      config: this.config,
      sessionId: `${this.sessionId}:sub:${agentId}`,
      systemPrompt: `You are a sub-agent. Complete this task concisely:\n${instruction}\nAvailable tools: ${tools.join(', ')}`,
      toolExecutor: this.toolExecutor,
      toolRegistry: this.toolRegistry,
    });

    try {
      const result = await subAgent.sendMessage(instruction);
      this.subAgents.complete(agentId, result.content);
    } catch (err) {
      this.subAgents.fail(agentId, err instanceof Error ? err.message : 'Sub-agent failed');
    }
  }

  async sendMessage(content: string): Promise<Message> {
    if (this.isProcessing) {
      throw new Error('Agent is already processing a message');
    }

    this.isProcessing = true;
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
      };

      this.emit({ type: 'loading_start', stage: round === 0 ? 'thinking' : 'tool_execution' });

      // Stream response
      let fullContent = '';
      const toolCalls: CompletionToolCall[] = [];
      let currentToolCall: Partial<CompletionToolCall> | null = null;

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

        // Continue the loop — model will see tool results and generate next response
        continue;
      }

      // No tool calls — this is the final assistant response
      this.messages.push({ role: 'assistant', content: fullContent });

      const estimatedTokens = Math.ceil(fullContent.length / 4);
      this.tokenTracker.addUsage(estimatedTokens);

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: fullContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: estimatedTokens,
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
    // Verify model in background
    this.verifyModel(modelId);
  }

  private async verifyModel(modelId: string): Promise<void> {
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
    } catch {
      this.emit({
        type: 'error',
        code: 'MODEL_UNAVAILABLE',
        message: `Model "${modelId}" is not available. Try a different model.`,
        recoverable: true,
        actions: [
          { type: 'switch_model', label: 'Pick a different model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      });
    }
  }

  async listModels(): Promise<void> {
    const models = await this.provider.listModels();
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
    const msg = error instanceof Error ? error.message : String(error);

    // Network / connectivity
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      return {
        message: 'Unable to reach the AI provider. Check your internet connection.',
        actions: [
          { type: 'retry', label: 'Retry' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Auth issues
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API')) {
      return {
        message: 'Authentication failed. Your API key may be invalid or expired.',
        actions: [
          { type: 'reconfigure_key', label: 'Update API key' },
          { type: 'switch_model', label: 'Switch provider' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Rate limiting
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
      return {
        message: 'Rate limited by the provider. Wait a moment and try again.',
        actions: [
          { type: 'retry', label: 'Retry' },
          { type: 'switch_model', label: 'Switch model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Model not found / deprecated
    if (msg.includes('404') || msg.includes('not found') || msg.includes('no longer available')) {
      return {
        message: `Model "${this.config.provider.activeModel}" is unavailable or deprecated.`,
        actions: [
          { type: 'switch_model', label: 'Pick a different model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Quota / billing
    if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
      return {
        message: 'Provider quota exceeded or billing issue.',
        actions: [
          { type: 'switch_model', label: 'Switch to free model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return {
        message: 'The AI provider is experiencing issues.',
        actions: [
          { type: 'retry', label: 'Retry' },
          { type: 'switch_model', label: 'Switch model' },
          { type: 'dismiss', label: 'Dismiss' },
        ],
      };
    }
    // Generic fallback — never show the raw error
    return {
      message: 'Something went wrong. Please try again.',
      actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'dismiss', label: 'Dismiss' },
      ],
    };
  }
}
