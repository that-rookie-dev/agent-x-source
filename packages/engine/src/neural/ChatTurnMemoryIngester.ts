/**
 * Persists conversation turns into MemoryFabric as vector-indexed nodes (tag: chat_memory).
 * Super sessions write to the global bucket (session_id NULL); all other sessions write
 * under their own session_id so reads never bleed across sessions.
 *
 * Parallelism is owned by the Performance background pool — jobs always queue, never drop.
 */
import type { EmbeddingProvider } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { MemoryFabric } from './MemoryFabric.js';
import { getBackgroundTaskPool } from '../runtime/BackgroundTaskPool.js';

export const CHAT_MEMORY_TAG = 'chat_memory';

const MIN_CHARS = 8;
const MAX_USER = 900;
const MAX_ASSISTANT = 1_400;

function turnContent(userMessage: string, assistantResponse: string): string {
  const user = userMessage.trim().slice(0, MAX_USER);
  const assistant = assistantResponse.trim().slice(0, MAX_ASSISTANT);
  return `User: ${user}\n\nAssistant: ${assistant}`;
}

export class ChatTurnMemoryIngester {
  constructor(
    private fabric: MemoryFabric,
    private embedder: EmbeddingProvider,
  ) {}

  /**
   * Embed a turn into chat_memory.
   * Resolves when the job finishes (or is skipped). Under pressure the background
   * pool queues — it never drops.
   */
  async ingestTurn(
    userMessage: string,
    assistantResponse: string,
    sourceSessionId: string,
    storageSessionId?: string,
  ): Promise<boolean> {
    const user = userMessage.trim();
    const assistant = assistantResponse.trim();
    if (user.length < MIN_CHARS || assistant.length < MIN_CHARS) {
      return false;
    }
    return getBackgroundTaskPool().run(() =>
      this.embedJob(user, assistant, sourceSessionId, storageSessionId),
    );
  }

  private async embedJob(
    userMessage: string,
    assistantResponse: string,
    sourceSessionId: string,
    storageSessionId?: string,
  ): Promise<boolean> {
    try {
      const label = userMessage.slice(0, 80);
      if (await this.fabric.hasChatMemoryTurn(sourceSessionId, label)) {
        return false;
      }
      const content = turnContent(userMessage, assistantResponse);
      const embedding = await this.embedder.embed(content);
      await this.fabric.createNode({
        label,
        category: 'semantic',
        content,
        embedding,
        tag: CHAT_MEMORY_TAG,
        sessionId: storageSessionId,
        confidence: 0.88,
        provenance: {
          type: 'chat_turn',
          sourceSessionId,
          ingestedAt: new Date().toISOString(),
        },
      });
      getLogger().info('CHAT_MEMORY', `Embedded chat turn from session ${sourceSessionId.slice(0, 8)}`);
      return true;
    } catch (e) {
      getLogger().warn('CHAT_MEMORY', `Failed to embed chat turn: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}
