export interface Profile {
  id: string;
  name: string;
  systemPrompt: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreateInput {
  id: string;
  name: string;
  systemPrompt: string;
  isDefault?: boolean;
}
