import type { MemoryNode, MemoryNodeCategory, MemoryFabric } from '../../neural/MemoryFabric.js';
import type { DocumentIngestInput, DocumentIngestResult } from '../../neural/DocumentIngester.js';
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
  /** When true, perform a full GraphRAG retrieve instead of pure vector search. */
  useGraphRag?: boolean;
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

  /** Ingest a document/RAG source into the memory fabric. */
  ingestDocument(input: DocumentIngestInput): Promise<DocumentIngestResult>;

  /** Ingest a chat turn (and user profile, if super session) into memory. */
  ingestChatTurn(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    options?: ChatTurnIngestOptions,
  ): Promise<void>;

  /** Generic text ingestion with optional extraction/embedding. */
  ingest(input: IngestInput): Promise<IngestResult>;

  /** Vector (or GraphRAG) search over memory. */
  search(query: string, options?: SearchOptions): Promise<MemoryNode[]>;

  /** Reinforce a set of context node IDs. */
  reinforce(nodeIds: string[]): Promise<void>;

  /** Return the underlying MemoryFabric for low-level operations. */
  getFabric(): MemoryFabric;
}
