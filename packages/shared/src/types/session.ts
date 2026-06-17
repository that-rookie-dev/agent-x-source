export interface Session {
  id: string;
  title: string;
  parentId?: string | null;
  crewId: string | null;
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
  crewId?: string;
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenAvailable: number;
}
