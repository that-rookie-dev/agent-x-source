import type { CompletionRequest, CompletionChunk, CompletionToolCall } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';

export interface CollectedCompletion {
  text: string;
  toolCalls: CompletionToolCall[];
  latencyMs: number;
}

export async function collectCompletion(
  provider: ProviderInterface,
  request: CompletionRequest,
): Promise<CollectedCompletion> {
  const start = Date.now();
  let text = '';
  let reasoningText = '';
  const toolCallsByIndex = new Map<number, CompletionToolCall>();

  for await (const chunk of provider.complete({ ...request, stream: true })) {
    applyChunk(
      chunk,
      (t) => { text += t; },
      (t) => { reasoningText += t; },
      toolCallsByIndex,
    );
    if (chunk.type === 'done') break;
  }

  return {
    // Some OpenAI-compatible reasoning models/proxies stream usable output in
    // reasoning deltas but leave content empty. For benchmark scoring, an empty
    // content channel should not look like a model failure if reasoning text is
    // all the provider returned.
    text: (text.trim() || reasoningText.trim()),
    toolCalls: [...toolCallsByIndex.values()],
    latencyMs: Date.now() - start,
  };
}

function applyChunk(
  chunk: CompletionChunk,
  appendText: (s: string) => void,
  appendReasoning: (s: string) => void,
  toolCallsByIndex: Map<number, CompletionToolCall>,
): void {
  if (chunk.type === 'text_delta' && chunk.content) {
    appendText(chunk.content);
    return;
  }
  if (chunk.type === 'reasoning_delta' && chunk.content) {
    appendReasoning(chunk.content);
    return;
  }
  if (chunk.type !== 'tool_call_delta' || !chunk.toolCall) return;

  const idx = (chunk.toolCall as { index?: number }).index ?? toolCallsByIndex.size;
  const existing = toolCallsByIndex.get(idx) ?? {
    id: chunk.toolCall.id ?? `call_${idx}`,
    type: 'function' as const,
    function: { name: '', arguments: '' },
  };

  if (chunk.toolCall.id) existing.id = chunk.toolCall.id;
  if (chunk.toolCall.function?.name) {
    existing.function.name = (existing.function.name + chunk.toolCall.function.name).trim();
  }
  if (chunk.toolCall.function?.arguments) {
    existing.function.arguments += chunk.toolCall.function.arguments;
  }
  toolCallsByIndex.set(idx, existing);
}
