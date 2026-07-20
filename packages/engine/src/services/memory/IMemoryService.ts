import type { MemoryNode, MemoryNodeCategory, MemoryFabric } from '../../neural/MemoryFabric.js';
import type { IngestInput, IngestResult } from '../../neural/MemoryService.js';

export interface MemoryContextState {
  episodic: string;
  semantic: string;
  graph: string;
  /** GraphRAG community summaries (global pass). */
  community?: string;
}

export interface AssembleContextOptions {
  /** Last handful of messages; used to reformulate the query. */
  messages?: import('@agentx/shared').CompletionMessage[];
  /** Agent callsign filter. */
  agentId?: string;
  /** Session context kind; used to determine super-session/global retrieval. */
  contextKind?: import('@agentx/shared').SessionContextKind;
  /** When true, avoid an extra LLM call for query reformulation. */
  compact?: boolean;
  /** Max community summaries for super sessions. */
  globalLimit?: number;
  /** Max local community members. */
  localLimit?: number;
  /** Max direct vector matches. */
  vectorLimit?: number;
  /** Graph walk depth from community members. */
  graphDepth?: number;
  /** Minimum cosine similarity for vector matches. */
  minRelevance?: number;
}

export interface ChatTurnIngestOptions {
  /** Session that stores the chat memory (may differ for super sessions). */
  storageSessionId?: string;
  /** Context kind used to resolve storage and super-session rules. */
  contextKind?: import('@agentx/shared').SessionContextKind;
}

export interface SearchOptions {
  embedding?: number[];
  limit?: number;
  category?: MemoryNodeCategory;
  agentId?: string;
  tag?: string;
  sessionId?: string | null;
  /** Minimum cosine similarity for vector matches. */
  minRelevance?: number;
}

export interface IMemoryService {
  readonly name?: string;

  /** Assemble formatted memory context for a prompt section. */
  assembleContext(
    sessionId: string,
    query: string,
    options?: AssembleContextOptions,
  ): Promise<MemoryContextState>;

  /** Ingest arbitrary text into the fabric (LLM extraction optional). */
  ingest(input: IngestInput): Promise<IngestResult>;

  /** Ingest a chat turn into cortex memory. */
  ingestChatTurn(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    options?: ChatTurnIngestOptions,
  ): Promise<void>;

  search(query: string, options?: SearchOptions): Promise<MemoryNode[]>;

  getFabric(): MemoryFabric;
}
