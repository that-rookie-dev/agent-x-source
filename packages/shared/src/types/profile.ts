export interface Profile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  expertise: string[];
  traits: string[];
  toolPreferences: ToolCategory[] | null;
  enabledTools: string[] | null;
  disabledTools: string[] | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreateInput {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: string[];
  isDefault?: boolean;
}

// Re-export for convenience
import type { ToolCategory } from './tool.js';
export type { ToolCategory as ProfileToolCategory };
