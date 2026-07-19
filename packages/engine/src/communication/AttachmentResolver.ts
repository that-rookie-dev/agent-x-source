import type {
  TurnAttachment,
  NormalizedAttachment,
  StoredAttachment,
} from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';

export class AttachmentResolver {
  async resolve(
    attachments: TurnAttachment[],
  ): Promise<NormalizedAttachment[]> {
    const resolved: NormalizedAttachment[] = [];

    for (const attachment of attachments) {
      const normalized = await this.resolveOne(attachment);
      resolved.push(normalized);
    }

    return resolved;
  }

  private async resolveOne(
    attachment: TurnAttachment,
  ): Promise<NormalizedAttachment> {
    const service = getAttachmentService();
    const name = this.sanitizeFileName(attachment.name);

    // If an MCP / tool gives us an on-disk path, register it as a reference.
    if (attachment.originalPath) {
      let stored: StoredAttachment | null = null;
      try {
        stored = await service.registerAttachment({
          sessionId: '',
          filename: name,
          mimeType: attachment.mimeType,
          source: attachment.source ?? 'mcp',
          originalPath: attachment.originalPath,
        });
      } catch {
        stored = null;
      }
      if (stored) {
        return {
          id: attachment.id,
          type: this.attachmentType(stored.mimeType, attachment.type),
          name: stored.filename,
          mimeType: stored.mimeType,
          storageId: stored.id,
          content: '',
          isInline: false,
        };
      }
      return {
        id: attachment.id,
        type: attachment.type,
        name,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        content: `[Attachment ${name} not found]`,
        isInline: false,
      };
    }

    if (attachment.storageId) {
      const stored = service.getAttachment(attachment.storageId);
      if (stored) {
        return {
          id: attachment.id,
          type: this.attachmentType(stored.mimeType, attachment.type),
          name: stored.filename,
          mimeType: stored.mimeType,
          storageId: stored.id,
          content: '',
          isInline: stored.mimeType.startsWith('image/'),
        };
      }
      return {
        id: attachment.id,
        type: attachment.type,
        name,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        content: `[Attachment ${name} not found]`,
        isInline: false,
      };
    }

    const mimeType = attachment.mimeType ?? this.guessMimeType(attachment);

    let content = '';
    let isInline = false;

    if (attachment.data) {
      content = attachment.data;
      isInline = true;
    } else if (attachment.url) {
      content = attachment.url;
      isInline = false;
    }

    return {
      id: attachment.id,
      type: attachment.type,
      name,
      mimeType,
      content,
      isInline,
    };
  }

  private attachmentType(
    mimeType: string,
    fallback: 'file' | 'image' | 'url',
  ): 'file' | 'image' | 'url' {
    if (mimeType.startsWith('image/')) return 'image';
    return fallback === 'url' ? 'url' : 'file';
  }

  private guessMimeType(attachment: TurnAttachment): string {
    if (attachment.mimeType) return attachment.mimeType;

    const ext = attachment.name.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      json: 'application/json',
      txt: 'text/plain',
      md: 'text/markdown',
      ts: 'text/typescript',
      tsx: 'text/typescript',
      js: 'text/javascript',
      jsx: 'text/javascript',
      py: 'text/x-python',
      rs: 'text/x-rust',
      go: 'text/x-go',
      java: 'text/x-java',
      html: 'text/html',
      css: 'text/css',
    };

    return ext ? (mimeMap[ext] ?? 'application/octet-stream') : 'application/octet-stream';
  }

  private sanitizeFileName(name: string): string {
    // eslint-disable-next-line no-control-regex -- strip illegal filename characters
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }
}
