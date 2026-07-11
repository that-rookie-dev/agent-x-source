/** Persisted markdown document saved from chat or agent tools. */
export type MarkdownDocumentFormat = 'markdown' | 'legacy_tsx';

export interface MarkdownDocumentRecord {
  id: string;
  sessionId: string;
  messageId?: string | null;
  title: string;
  excerpt: string;
  /** Relative path under data dir, e.g. `markdown/{id}/content.md` */
  filePath: string;
  contentFormat: MarkdownDocumentFormat;
  sourceRole?: 'user' | 'assistant' | 'system' | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMarkdownDocumentInput {
  sessionId: string;
  title: string;
  messageId?: string;
  sourceRole?: 'user' | 'assistant' | 'system';
  contentFormat?: MarkdownDocumentFormat;
  contentMarkdown?: string;
  /** Legacy interactive TSX source (converted to markdown on save) */
  contentTsx?: string;
}

export interface MarkdownDocumentPayload {
  record: MarkdownDocumentRecord;
  contentMarkdown?: string;
}
