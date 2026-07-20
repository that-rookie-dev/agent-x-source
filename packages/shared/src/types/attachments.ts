export interface StoredAttachment {
  id: string;
  sessionId: string;
  messageId?: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  /** If this attachment was already stored on disk, this is the original path (not copied). */
  originalPath?: string;
  /** True when the file is stored in the transient session temp area. */
  isTemp?: boolean;
  source: 'upload' | 'gmail' | 'tool' | 'mcp' | string;
  createdAt: string;
}

export interface AttachmentPreview {
  kind: 'text' | 'html' | 'table' | 'error';
  content?: string;
  /** Per-page (or per-slide) text when the source is paginated. */
  pages?: string[];
  headers?: string[];
  rows?: string[][];
}

export interface AttachmentReference {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}
