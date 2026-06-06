import type { CompletionMessage } from '@agentx/shared';

export interface SanitizedMessage {
  messages: CompletionMessage[];
  toolHints?: string[];
  intent: MessageIntent;
}

export type MessageIntent = 'query' | 'task' | 'steer' | 'clarification' | 'meta';

export class MessageSanitizer {
  sanitize(
    userMessage: string,
    context: CompletionMessage[],
  ): SanitizedMessage {
    const intent = this.detectIntent(userMessage);
    const messages = [...context];

    // Add the user message
    messages.push({ role: 'user', content: userMessage });

    return {
      messages,
      intent,
    };
  }

  private detectIntent(message: string): MessageIntent {
    const lower = message.toLowerCase();

    // Meta questions about the agent itself
    if (lower.includes('what can you do') || lower.includes('who are you')) {
      return 'meta';
    }

    // Task indicators
    if (lower.includes('create') || lower.includes('build') || lower.includes('implement') ||
        lower.includes('fix') || lower.includes('update') || lower.includes('delete') ||
        lower.includes('write') || lower.includes('make')) {
      return 'task';
    }

    // Clarification
    if (lower.includes('what do you mean') || lower.includes('can you explain') ||
        lower.includes('i meant')) {
      return 'clarification';
    }

    return 'query';
  }
}
