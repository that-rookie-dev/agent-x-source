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

export interface AgentOptions {
  config: AgentXConfig;
  sessionId: string;
  systemPrompt?: string;
}

export class Agent {
  private provider: ProviderInterface;
  private eventBus: AgentEventBus;
  private tokenTracker: TokenTracker;
  private messages: CompletionMessage[] = [];
  private config: AgentXConfig;
  private sessionId: string;
  private isProcessing = false;

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.eventBus = new AgentEventBus();
    this.tokenTracker = new TokenTracker(this.getContextWindow());

    this.provider = ProviderFactory.create(
      options.config.provider.activeProvider,
      this.getApiKey(),
      this.getBaseUrl(),
    );

    // Initialize system prompt
    if (options.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: options.systemPrompt,
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
      this.emit({
        type: 'error',
        code: 'AGENT_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
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
}
