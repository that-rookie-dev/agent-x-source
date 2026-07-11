/** Persisted Agent-X canvas artifact — interactive TSX or legacy markdown snapshot. */
export type CanvasContentFormat = 'markdown' | 'canvas_tsx';

export interface AgentXCanvasRecord {
  id: string;
  sessionId: string;
  messageId?: string | null;
  title: string;
  excerpt: string;
  /** Relative path under data dir, e.g. `canvases/{id}/canvas.canvas.tsx` */
  filePath: string;
  contentFormat: CanvasContentFormat;
  sourceRole?: 'user' | 'assistant' | 'system' | null;
  compileError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  sessionId: string;
  title: string;
  messageId?: string;
  sourceRole?: 'user' | 'assistant' | 'system';
  contentFormat?: CanvasContentFormat;
  /** Legacy markdown body */
  contentMarkdown?: string;
  /** Interactive React canvas source */
  contentTsx?: string;
}

export interface CanvasContentPayload {
  record: AgentXCanvasRecord;
  contentMarkdown?: string;
  contentTsx?: string;
  compiledJs?: string;
  compileError?: string | null;
}
