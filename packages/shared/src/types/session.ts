export interface Session {
  id: string;
  title: string;
  parentId?: string | null;
  providerId: string;
  modelId: string;
  scopePath: string;
  mode: 'agent' | 'plan';
  hyperdrive?: boolean;
  tokenUsed: number;
  tokenAvailable: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface SessionCreateInput {
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenAvailable: number;
}
