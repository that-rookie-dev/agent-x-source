import { getDataDir } from '@agentx/shared';
import { AttachmentService } from './AttachmentService.js';

let instance: AttachmentService | null = null;

export function getAttachmentService(): AttachmentService {
  if (!instance) {
    instance = new AttachmentService(getDataDir());
  }
  return instance;
}

export { AttachmentService } from './AttachmentService.js';
