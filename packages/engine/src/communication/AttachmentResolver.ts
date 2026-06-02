import type {
  TurnAttachment,
  NormalizedAttachment,
} from '@agentx/shared';

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
    const mimeType = attachment.mimeType ?? this.guessMimeType(attachment);

    let content = '';
    let isInline = false;

    if (attachment.data) {
      content = attachment.data;
      isInline = true;
    } else if (attachment.url) {
      try {
        content = attachment.url;
        isInline = false;
      } catch {
        content = '';
      }
    }

    return {
      id: attachment.id,
      type: attachment.type,
      name: this.sanitizeFileName(attachment.name),
      mimeType,
      content,
      isInline,
    };
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
    // eslint-disable-next-line no-control-regex
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }
}
