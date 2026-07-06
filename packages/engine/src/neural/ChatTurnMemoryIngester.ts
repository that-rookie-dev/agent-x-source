/**
 * Persists every Agent-X conversation turn into MemoryFabric as vector-indexed
 * nodes (tag: chat_memory). Shared globally (session_id NULL) so memory_fabric_search
 * and GraphRAG can recall past chat across sessions.
 */
import type { EmbeddingProvider } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { MemoryFabric } from './MemoryFabric.js';

export const CHAT_MEMORY_TAG = 'chat_memory';

const MIN_CHARS = 8;
const MAX_USER = 900;
const MAX_ASSISTANT = 1_400;

type TurnJob = {
  userMessage: string;
  assistantResponse: string;
  sourceSessionId: string;
};

function turnContent(userMessage: string, assistantResponse: string): string {
  const user = userMessage.trim().slice(0, MAX_USER);
  const assistant = assistantResponse.trim().slice(0, MAX_ASSISTANT);
  return `User: ${user}\n\nAssistant: ${assistant}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ChatTurnMemoryIngester {
  private pending = 0;
  private readonly maxConcurrent = 2;
  private readonly queue: TurnJob[] = [];
  private draining = false;

  constructor(
    private fabric: MemoryFabric,
    private embedder: EmbeddingProvider,
  ) {}

  /** Queue a turn for durable embedding; never drops on concurrency pressure. */
  ingestTurn(userMessage: string, assistantResponse: string, sourceSessionId: string): Promise<boolean> {
    const user = userMessage.trim();
    const assistant = assistantResponse.trim();
    if (user.length < MIN_CHARS || assistant.length < MIN_CHARS) {
      return Promise.resolve(false);
    }
    this.queue.push({ userMessage: user, assistantResponse: assistant, sourceSessionId });
    void this.drainQueue();
    return Promise.resolve(true);
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        while (this.pending >= this.maxConcurrent) {
          await sleep(40);
        }
        const job = this.queue.shift()!;
        this.pending++;
        void this.embedJob(job).finally(() => {
          this.pending--;
        });
      }
      while (this.pending > 0) {
        await sleep(40);
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drainQueue();
    }
  }

  private async embedJob(job: TurnJob): Promise<boolean> {
    const { userMessage, assistantResponse, sourceSessionId } = job;
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
        sessionId: undefined,
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
