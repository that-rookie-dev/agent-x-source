import { KnowledgeBaseManager } from './KnowledgeBaseManager.js';

let globalManager: KnowledgeBaseManager | null = null;

export function setKnowledgeBaseManager(manager: KnowledgeBaseManager | null): void {
  globalManager = manager;
}

export function getKnowledgeBaseManager(): KnowledgeBaseManager | null {
  return globalManager;
}
