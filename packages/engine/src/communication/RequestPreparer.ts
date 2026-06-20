import { randomUUID } from 'node:crypto';
import type {
  PromptBundle,
  ProviderPlan,
  ProviderMessage,
  ProviderToolDef,
} from '@agentx/shared';
import type { Session, Message } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';

export interface RequestPreparerConfig {
  provider: ProviderInterface;
  defaultMaxTokens: number;
  defaultTimeoutMs: number;
  maxRetries: number;
}

export class RequestPreparer {
  constructor(private config: RequestPreparerConfig) {}

  prepare(
    bundle: PromptBundle,
    session: Session,
    messages: Message[],
    tools: ProviderToolDef[],
    toolChoice: ProviderPlan['toolChoice'] = 'auto',
  ): ProviderPlan {
    const providerMessages = this.buildMessages(bundle, session, messages);

    return {
      requestId: this.generateId(),
      sessionId: session.id,
      providerId: session.providerId,
      modelId: session.modelId,
      messages: providerMessages,
      tools,
      toolChoice,
      generation: {
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: this.config.defaultMaxTokens,
      },
      http: {
        timeoutMs: this.config.defaultTimeoutMs,
        maxRetries: this.config.maxRetries,
        headers: {},
      },
      route: `${session.providerId}-chat`,
    };
  }

  private buildMessages(
    bundle: PromptBundle,
    _session: Session,
    messages: Message[],
  ): ProviderMessage[] {
    const result: ProviderMessage[] = [];

    result.push({
      role: 'system',
      content: bundle.fullSystemPrompt,
    });

    for (const msg of messages) {
      const providerMsg = this.convertMessage(msg);

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        providerMsg.toolCalls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      result.push(providerMsg);
    }

    return result;
  }

  private convertMessage(msg: Message): ProviderMessage {
    return {
      role: this.mapRole(msg.role),
      content: msg.content,
      toolCallId:
        msg.role === 'tool' && msg.toolCalls?.[0]
          ? msg.toolCalls[0].id
          : undefined,
    };
  }

  private mapRole(role: Message['role']): ProviderMessage['role'] {
    switch (role) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      case 'tool':
        return 'tool';
    }
  }

  private generateId(): string {
    return randomUUID();
  }
}
