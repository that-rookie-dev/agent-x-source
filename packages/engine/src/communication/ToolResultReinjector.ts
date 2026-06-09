import type {
  NormalizedToolCall,
  ProviderMessage,
  ProviderContentPart,
} from '@agentx/shared';

export class ToolResultReinjector {
  static reinject(toolResults: NormalizedToolCall[]): ProviderMessage[] {
    return toolResults.map((tc) => {
      const resultContent = tc.result ?? tc.error ?? '';

      const content: ProviderContentPart[] = [
        {
          type: 'tool_result',
          tool_use_id: tc.id,
          content: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent),
          is_error: tc.status === 'error',
        },
      ];

      return {
        role: 'tool',
        content,
        toolCallId: tc.id,
        name: tc.name,
      };
    });
  }

  static buildToolResultMessage(
    toolResult: NormalizedToolCall,
  ): ProviderMessage {
    return {
      role: 'tool',
      content: typeof toolResult.result === 'string' ? toolResult.result : (toolResult.result != null ? JSON.stringify(toolResult.result) : ''),
      toolCallId: toolResult.id,
      name: toolResult.name,
    };
  }

  static buildTruncatedToolResult(
    toolResult: NormalizedToolCall,
    maxChars: number = 10000,
  ): ProviderMessage {
    const raw = typeof toolResult.result === 'string' ? toolResult.result : (toolResult.result != null ? JSON.stringify(toolResult.result) : '');
    const truncated =
      raw.length > maxChars
        ? raw.slice(0, maxChars) +
          `\n\n[Result truncated — ${raw.length - maxChars} chars omitted]`
        : raw;

    return {
      role: 'tool',
      content: truncated,
      toolCallId: toolResult.id,
      name: toolResult.name,
    };
  }
}
