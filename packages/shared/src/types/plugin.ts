import type { ToolDefinition, ToolCategory, ToolRiskLevel } from './tool.js';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  source: 'plugin';
  tools: PluginToolDescriptor[];
  config?: Record<string, PluginConfigField>;
  minAgentVersion?: string;
}

export interface PluginToolDescriptor {
  id: string;
  name: string;
  description: string;
  modelDescription: string;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  schema: Record<string, unknown>;
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
}

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
  tools: ToolDefinition[];
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(toolId: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string }>;
}

export interface PluginLoader {
  discover(): Promise<PluginManifest[]>;
  load(manifest: PluginManifest): Promise<PluginInstance>;
  unload(pluginId: string): Promise<void>;
  getLoaded(): PluginInstance[];
}

export type PluginCategory =
  | 'database'
  | 'messaging'
  | 'storage'
  | 'monitoring'
  | 'search'
  | 'automation'
  | 'tools'
  | 'other';

export interface PluginHubEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  category: PluginCategory;
  icon?: string;
  tags: string[];
  config?: Record<string, PluginConfigField>;
  isBuiltin: boolean;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  category: PluginCategory;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: string;
  updatedAt: string;
  isBuiltin: boolean;
}
