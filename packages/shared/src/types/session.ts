export interface Session {
  id: string;
  title: string;
  profileId: string | null;
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenUsed: number;
  tokenAvailable: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface SessionCreateInput {
  profileId?: string;
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenAvailable: number;
}
