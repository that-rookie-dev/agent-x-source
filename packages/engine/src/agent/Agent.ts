import type {
  Message,
  EngineEvent,
  CompletionRequest,
  CompletionMessage,
  ProviderId,
  AgentXConfig,
} from '@agentx/shared';
import { generateMessageId } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { ProviderFactory } from '../providers/index.js';
import { AgentEventBus } from '../EventBus.js';
import { TokenTracker } from '../session/TokenTracker.js';
import { SubAgentManager } from './SubAgentManager.js';
import { SecretSauceManager } from '../secret-sauce/index.js';
import { ErrorShield } from './ErrorShield.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';

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
  private errorShield: ErrorShield;
  private toolExecutor?: ToolExecutor;
  private toolRegistry?: ToolRegistry;

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.eventBus = new AgentEventBus();
    this.tokenTracker = new TokenTracker(this.getContextWindow());
    this.subAgents = new SubAgentManager(this.eventBus);
    this.secretSauce = new SecretSauceManager();
    this.errorShield = new ErrorShield();
    this.toolExecutor = options.toolExecutor;
    this.toolRegistry = options.toolRegistry;

    this.provider = ProviderFactory.create(
      options.config.provider.activeProvider,
      this.getApiKey(),
      this.getBaseUrl(),
    );

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
      // Build completion request
      const request: CompletionRequest = {
        model: this.config.provider.activeModel,
        messages: this.messages,
        stream: true,
      };

      this.emit({ type: 'loading_start', stage: 'thinking' });

      // Stream response
      let fullContent = '';

      for await (const chunk of this.provider.complete(request)) {
        if (chunk.content) {
          fullContent += chunk.content;
          this.emit({
            type: 'stream_chunk',
            content: chunk.content,
            fullContent,
          });
        }
      }

      this.emit({ type: 'loading_end' });

      // Add assistant message
      this.messages.push({ role: 'assistant', content: fullContent });

      // Estimate tokens (rough: ~4 chars per token)
      const estimatedTokens = Math.ceil(fullContent.length / 4);

      const assistantMessage: Message = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        role: 'assistant',
        content: fullContent,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: estimatedTokens,
      };

      // Update token tracker
      this.tokenTracker.addUsage(estimatedTokens);

      const elapsed = Date.now() - startTime;
      this.emit({
        type: 'message_received',
        message: assistantMessage,
        elapsed,
      });

      return assistantMessage;
    } catch (error) {
      this.emit({ type: 'loading_end' });
      // Log the full error for debugging
      this.errorShield.logError(error);
      // Show a user-friendly message (never expose raw backend errors)
      const friendlyMessage = this.toFriendlyError(error);
      this.emit({
        type: 'error',
        code: 'AGENT_ERROR',
        message: friendlyMessage,
        recoverable: true,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
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
    this.emit({ type: 'command_action', action: 'model_switched', modelId });
  }

  async listModels(): Promise<void> {
    const models = await this.provider.listModels();
    this.emit({
      type: 'command_action',
      action: 'list_models',
      models,
      currentModel: this.config.provider.activeModel,
    });
  }

  getMessageHistory(): CompletionMessage[] {
    return [...this.messages];
  }

  clearHistory(): void {
    const system = this.messages.find((m) => m.role === 'system');
    this.messages = system ? [system] : [];
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

  private toFriendlyError(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);

    // Network / connectivity
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      return 'Unable to reach the AI provider. Check your internet connection.';
    }
    // Auth issues
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API')) {
      return 'Authentication failed. Run /model to reconfigure or check your API key.';
    }
    // Rate limiting
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests')) {
      return 'Rate limited by the provider. Wait a moment and try again.';
    }
    // Model not found / deprecated
    if (msg.includes('404') || msg.includes('not found') || msg.includes('no longer available')) {
      return `Model "${this.config.provider.activeModel}" is unavailable. Use /model to switch.`;
    }
    // Quota / billing
    if (msg.includes('402') || msg.includes('quota') || msg.includes('billing')) {
      return 'Provider quota exceeded or billing issue. Check your account.';
    }
    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return 'The AI provider is experiencing issues. Try again shortly.';
    }
    // Generic fallback — never show the raw error
    return 'Something went wrong. Check logs with: cat ~/.local/share/agentx/logs/errors.jsonl';
  }
}
