import { normalize, resolve, relative, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type {
  TurnAttachment,
  NormalizedAttachment,
  StoredAttachment,
} from '@agentx/shared';
import { isPathInsideRoot } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';

export class AttachmentResolver {
  private workspaceRoot: string | null = null;

  /** Active Agent-X workspace root — required to accept source=workspace path refs. */
  setWorkspaceRoot(root: string | null | undefined): void {
    this.workspaceRoot = root ? normalize(resolve(root)) : null;
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

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

  private deny(attachment: TurnAttachment, name: string, reason: string): NormalizedAttachment {
    return {
      id: attachment.id,
      type: attachment.type,
      name,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      content: `[Attachment ${name} blocked: ${reason}]`,
      isInline: false,
    };
  }

  private folderHint(absPath: string, name: string): string {
    const rel = this.workspaceRoot
      ? (relative(this.workspaceRoot, absPath) || '.')
      : absPath;
    return [
      `--- Attached workspace folder: ${name} ---`,
      `Absolute path: ${absPath}`,
      `Workspace-relative path: ${rel}`,
      'Treat this as a directory reference for the user\'s request.',
      'Explore it with filesystem tools (list_dir / glob / read) — do not treat it as a single file.',
    ].join('\n');
  }

  private async resolveOne(
    attachment: TurnAttachment,
  ): Promise<NormalizedAttachment> {
    const service = getAttachmentService();
    const name = this.sanitizeFileName(attachment.name);
    const source = attachment.source ?? undefined;

    // Workspace @file / @folder mentions — must stay inside the active workspace root.
    if (source === 'workspace') {
      if (!attachment.originalPath) {
        return this.deny(attachment, name, 'workspace attachment missing originalPath');
      }
      if (!this.workspaceRoot) {
        return this.deny(attachment, name, 'workspace root not configured');
      }
      if (!isPathInsideRoot(attachment.originalPath, this.workspaceRoot)) {
        return this.deny(attachment, name, 'path outside workspace');
      }
    }

    // Folder mentions: path hint only — never register/extract as a file.
    if (attachment.type === 'folder' && attachment.originalPath) {
      if (source === 'workspace' || !source) {
        if (!source && this.workspaceRoot && !isPathInsideRoot(attachment.originalPath, this.workspaceRoot)) {
          return this.deny(attachment, name, 'path outside workspace');
        }
      }
      if (!existsSync(attachment.originalPath)) {
        return this.deny(attachment, name, 'folder not found');
      }
      try {
        if (!statSync(attachment.originalPath).isDirectory()) {
          return this.deny(attachment, name, 'not a directory');
        }
      } catch {
        return this.deny(attachment, name, 'folder not readable');
      }
      return {
        id: attachment.id,
        type: 'folder',
        name: name || basename(attachment.originalPath),
        mimeType: attachment.mimeType ?? 'inode/directory',
        content: this.folderHint(normalize(resolve(attachment.originalPath)), name || basename(attachment.originalPath)),
        isInline: false,
      };
    }

    // If an MCP / tool / workspace path gives us an on-disk path, register it as a reference.
    if (attachment.originalPath) {
      // Chat/API must not smuggle arbitrary paths under a non-workspace source.
      // Tool/MCP paths are still allowed when source is tool/mcp/gmail/upload omit.
      if (source === 'workspace' || !source) {
        // already validated workspace above when source === workspace
        // bare originalPath without source: treat as workspace-scoped when root is set
        if (!source && this.workspaceRoot && !isPathInsideRoot(attachment.originalPath, this.workspaceRoot)) {
          return this.deny(attachment, name, 'path outside workspace');
        }
      }

      // Auto-detect directories sent without type=folder (defensive).
      try {
        if (existsSync(attachment.originalPath) && statSync(attachment.originalPath).isDirectory()) {
          return {
            id: attachment.id,
            type: 'folder',
            name: name || basename(attachment.originalPath),
            mimeType: 'inode/directory',
            content: this.folderHint(normalize(resolve(attachment.originalPath)), name || basename(attachment.originalPath)),
            isInline: false,
          };
        }
      } catch {
        // fall through to file registration
      }

      let stored: StoredAttachment | null = null;
      try {
        stored = await service.registerAttachment({
          sessionId: '',
          filename: name,
          mimeType: attachment.mimeType,
          source: source ?? 'mcp',
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
        type: attachment.type === 'folder' ? 'file' : attachment.type,
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
        type: attachment.type === 'folder' ? 'file' : attachment.type,
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
      type: attachment.type === 'folder' ? 'file' : attachment.type,
      name,
      mimeType,
      content,
      isInline,
    };
  }

  private attachmentType(
    mimeType: string,
    fallback: 'file' | 'image' | 'url' | 'folder',
  ): 'file' | 'image' | 'url' {
    if (fallback === 'folder') return 'file';
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
