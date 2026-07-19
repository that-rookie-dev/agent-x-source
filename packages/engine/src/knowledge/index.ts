export { KnowledgeBaseManager } from './KnowledgeBaseManager.js';
export type { KnowledgeBaseManagerOptions, KnowledgeStatusListener } from './KnowledgeBaseManager.js';
export {
  getKnowledgeBaseManager,
  setKnowledgeBaseManager,
} from './global-manager.js';

export type { IVectorStore } from './VectorStore.js';
export { MemoryVectorStore } from './MemoryVectorStore.js';
export { PgVectorStore } from './PgVectorStore.js';
export { createVectorStore } from './VectorStoreFactory.js';
export type { VectorStoreConfig } from './VectorStoreFactory.js';

export { KnowledgeSourceStore } from './KnowledgeSourceStore.js';
export { DocumentPipeline } from './DocumentPipeline.js';
export type { DocumentPipelineOptions } from './DocumentPipeline.js';

export type { KnowledgeSearchResult, KnowledgeChunk, KnowledgePage, KnowledgeSource } from '@agentx/shared';
