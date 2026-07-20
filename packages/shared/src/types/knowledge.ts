/** Lifecycle states for a knowledge source ingestion job. */
export type KnowledgeSourceStatus =
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'graphing'
  | 'ready'
  | 'failed';

/** A document/file that has been uploaded into the knowledge base. */
export interface KnowledgeSource {
  id: string;
  /** Optional session/tenant scoping. */
  sessionId?: string;
  /** Original file name. */
  name: string;
  mimeType: string;
  size: number;
  /** Reference into AttachmentService / file storage. */
  storageId: string;
  status: KnowledgeSourceStatus;
  /** 0-100 progress, derived from the current pipeline stage. */
  progress: number;
  error?: string;
  /** Auto-generated short summary, available after indexing. */
  summary?: string;
  chunkCount?: number;
  pageCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** A searchable chunk of a knowledge source. */
export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  /** Position within the document. */
  index: number;
  content: string;
  /** Optional vector embedding; stored as JSONB when pgvector is unavailable. */
  embedding?: number[];
  /** Source/page/heading metadata. */
  metadata?: Record<string, unknown>;
}

/** A single page of a paginated knowledge source (e.g. PDF slide). */
export interface KnowledgePage {
  id: string;
  sourceId: string;
  pageNumber: number;
  /** Raw or cleaned text for the page. */
  content: string;
  /** LLM summary of the page, generated during indexing. */
  summary?: string;
  embedding?: number[];
  /** Original filename; stored in vector metadata for search display. */
  sourceName?: string;
}

/** Result returned by a knowledge-base search. */
export interface KnowledgeSearchResult {
  id: string;
  content: string;
  sourceId: string;
  sourceName: string;
  /** 0-1 relevance score. */
  score: number;
  kind: 'chunk' | 'page' | 'entity' | 'summary';
  metadata?: Record<string, unknown>;
}

/** Payload used to create a new knowledge source. */
export interface CreateKnowledgeSourceInput {
  name: string;
  mimeType: string;
  size: number;
  storageId: string;
  sessionId?: string;
}

/** Client request to search the knowledge base. */
export interface KnowledgeSearchRequest {
  query: string;
  topK?: number;
  kind?: 'chunk' | 'page' | 'all';
  /** Limit search to a single source. */
  sourceId?: string;
}

/** Client response for a knowledge source list. */
export interface KnowledgeSourceListResponse {
  sources: KnowledgeSource[];
}
