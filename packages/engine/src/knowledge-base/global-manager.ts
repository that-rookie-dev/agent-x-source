import type { KnowledgeBaseService } from './KnowledgeBaseService.js';

let service: KnowledgeBaseService | null = null;

export function setKnowledgeBaseService(next: KnowledgeBaseService | null): void {
  service = next;
}

export function getKnowledgeBaseService(): KnowledgeBaseService | null {
  return service;
}
