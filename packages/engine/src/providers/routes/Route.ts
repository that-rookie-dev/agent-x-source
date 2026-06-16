import type {
  ProviderRoute,
  ProviderRouteId,
  ProviderProtocol,
  ProviderEndpoint,
  ProviderAuth,
  ProviderFraming,
  AgentXStreamEvent,
  ProviderMessage,
  ProviderToolDef,
} from '@agentx/shared';

export interface MakeRouteInput {
  id: ProviderRouteId;
  provider: string;
  protocol: ProviderProtocol;
  endpoint: ProviderEndpoint;
  auth: ProviderAuth;
  framing: ProviderFraming;
}

export function makeRoute(input: MakeRouteInput): ProviderRoute {
  return {
    id: input.id,
    provider: input.provider,
    protocol: input.protocol,
    endpoint: input.endpoint,
    auth: input.auth,
    framing: input.framing,
  };
}

export function openAIProtocol(): ProviderProtocol {
  return {
    convertMessages(messages: ProviderMessage[]): unknown {
      return messages.map((msg) => {
        const converted: Record<string, unknown> = {
          role: msg.role,
        };

        if (typeof msg.content === 'string') {
          converted.content = msg.content;
        } else {
          converted.content = msg.content.map((part) => {
            if (part.type === 'text') return { type: 'text', text: part.text ?? '' };
            if (part.type === 'image_url')
              return { type: 'image_url', image_url: part.image_url ?? { url: '' } };
            return part;
          });
        }

        if (msg.toolCallId) converted.tool_call_id = msg.toolCallId;
        if (msg.toolCalls) converted.tool_calls = msg.toolCalls;
        if (msg.name) converted.name = msg.name;
        if (msg.reasoning) converted.reasoning_content = msg.reasoning;

        return converted;
      });
    },

    convertTools(tools: ProviderToolDef[]): unknown {
      return tools.map((t) => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    },

    normalizeEvent(rawChunk: unknown, state: unknown): AgentXStreamEvent | null {
      const chunk = rawChunk as Record<string, unknown> | undefined;
      if (!chunk) return null;

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) return null;

      const choice = choices[0]!;
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        if (typeof delta.content === 'string') {
          return {
            type: 'text.delta',
            messageId: (chunk.id as string) ?? 'unknown',
            delta: delta.content,
            ts: Date.now(),
          };
        }

        if (typeof delta.reasoning_content === 'string') {
          return {
            type: 'reasoning.delta',
            reasoningId: (chunk.id as string) ?? 'unknown',
            delta: delta.reasoning_content as string,
            ts: Date.now(),
          };
        }

        const toolCalls = delta.tool_calls as
          | Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>
          | undefined;

        if (toolCalls && toolCalls.length > 0) {
          const tc = toolCalls[0]!;
          const s = (state as Record<string, unknown>) ?? {};
          if (tc.function?.name) {
            const toolCallId = tc.id ?? `gen-${tc.index ?? 0}-${Date.now()}`;
            if (tc.index !== undefined) s[`tool-idx-${tc.index}`] = toolCallId;
            return {
              type: 'tool.input.start',
              toolCallId,
              toolName: tc.function.name,
              ts: Date.now(),
            };
          }
          if (tc.function?.arguments) {
            const toolCallId = tc.id
              ?? (tc.index !== undefined ? s[`tool-idx-${tc.index}`] as string : undefined)
              ?? `gen-${tc.index ?? 0}-${Date.now()}`;
            return {
              type: 'tool.input.delta',
              toolCallId,
              delta: tc.function.arguments,
              ts: Date.now(),
            };
          }
        }
      }

      if (choice.finish_reason) {
        const usage = chunk.usage as
          | {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            }
          | undefined;

        return {
          type: 'turn.end',
          turnId: (chunk.id as string) ?? 'unknown',
          stopReason: choice.finish_reason as string,
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
          },
          ts: Date.now(),
        };
      }

      return null;
    },

    validateResponse(response: unknown): void {
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid OpenAI response: not an object');
      }
    },
  };
}

export function anthropicProtocol(): ProviderProtocol {
  return {
    convertMessages(messages: ProviderMessage[]): unknown {
      const systemMessages = messages.filter((m) => m.role === 'system');
      const nonSystemMessages = messages.filter((m) => m.role !== 'system');

      const converted = nonSystemMessages.map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((p) => {
                if (p.type === 'text') return { type: 'text', text: p.text ?? '' };
                if (p.type === 'image_url')
                  return {
                    type: 'image',
                    source: {
                      type: 'url',
                      url: p.image_url?.url ?? '',
                      media_type: 'image/jpeg',
                    },
                  };
                if (p.type === 'tool_use')
                  return { type: 'tool_use', id: p.id, name: p.name, input: p.input ?? {} };
                if (p.type === 'tool_result')
                  return {
                    type: 'tool_result',
                    tool_use_id: p.tool_use_id,
                    content: p.content,
                    is_error: p.is_error,
                  };
                return p;
              }),
      }));

      return {
        system: systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(
          '\n',
        ),
        messages: converted,
      };
    },

    convertTools(tools: ProviderToolDef[]): unknown {
      return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    },

    normalizeEvent(rawChunk: unknown, _state: unknown): AgentXStreamEvent | null {
      const event = rawChunk as
        | { type: string; index?: number; delta?: Record<string, unknown> }
        | undefined;
      if (!event) return null;

      const ts = Date.now();

      switch (event.type) {
        case 'content_block_start': {
          const block = (event as Record<string, unknown>).content_block as
            | { type: string; id: string; name: string }
            | undefined;
          if (block?.type === 'tool_use') {
            return {
              type: 'tool.input.start',
              toolCallId: block.id,
              toolName: block.name,
              ts,
            };
          }
          if (block?.type === 'text' && event.index !== undefined) {
            return {
              type: 'text.start',
              messageId: `msg-${event.index}`,
              ts,
            };
          }
          return null;
        }

        case 'content_block_delta': {
          const delta = event.delta as
            | { type: string; text?: string; partial_json?: string }
            | undefined;
          if (delta?.type === 'text_delta') {
            return {
              type: 'text.delta',
              messageId: `msg-${event.index ?? 0}`,
              delta: delta.text ?? '',
              ts,
            };
          }
          if (delta?.type === 'input_json_delta') {
            return {
              type: 'tool.input.delta',
              toolCallId: `tc-${event.index ?? 0}`,
              delta: delta.partial_json ?? '',
              ts,
            };
          }
          return null;
        }

        case 'message_delta': {
          const d = event.delta as { stop_reason?: string } | undefined;
          const u = (event as Record<string, unknown>).usage;
          const usage = u as
            | { input_tokens?: number; output_tokens?: number }
            | undefined;

          return {
            type: 'turn.end',
            turnId: 'turn',
            stopReason: d?.stop_reason ?? 'end_turn',
            usage: {
              promptTokens: usage?.input_tokens ?? 0,
              completionTokens: usage?.output_tokens ?? 0,
              totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
            },
            ts,
          };
        }

        default:
          return null;
      }
    },

    validateResponse(response: unknown): void {
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid Anthropic response: not an object');
      }
    },
  };
}
