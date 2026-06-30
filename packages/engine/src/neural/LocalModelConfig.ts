/**
 * Shared runtime configuration for the user-downloaded local LLM.
 *
 * The web-api sets this from the active AgentXConfig so engine classes can use
 * the same model for extraction, consolidation, and distillation without
 * hardcoding a default model ID.
 */
export interface LocalModelRuntimeConfig {
  modelId?: string;
  modelName?: string;
  displayName?: string;
  cacheDir?: string;
  dtype?: string;
  enabled: boolean;
}

let localModelConfig: LocalModelRuntimeConfig | null = null;

export function setLocalModelConfig(config: LocalModelRuntimeConfig | null): void {
  localModelConfig = config;
}

export function getLocalModelConfig(): LocalModelRuntimeConfig | null {
  return localModelConfig;
}
