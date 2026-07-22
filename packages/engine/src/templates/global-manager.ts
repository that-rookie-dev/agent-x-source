import type { TemplateService } from './TemplateService.js';

let service: TemplateService | null = null;

export function setTemplateService(next: TemplateService | null): void {
  service = next;
}

export function getTemplateService(): TemplateService | null {
  return service;
}
