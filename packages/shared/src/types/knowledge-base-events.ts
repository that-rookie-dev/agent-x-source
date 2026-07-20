import type { KnowledgeSourceStatus } from './knowledge.js';

/** WebSocket: Knowledge Base document ingest lifecycle. */
export type KnowledgeBaseSourceWsEvent =
  | {
      type: 'knowledge_base_source_status';
      sourceId: string;
      status: KnowledgeSourceStatus;
      progress: number;
      detail?: string;
      error?: string;
    }
  | { type: 'knowledge_base_source_ready'; sourceId: string }
  | { type: 'knowledge_base_source_failed'; sourceId: string; error: string };
