import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentXConfig } from '@agentx/shared';
import { agentXConfigSchema } from './ConfigSchema.js';
import { getConfigPath, getConfigDir, getDataDir, getCacheDir, getLogDir } from './paths.js';

export class ConfigManager {
  private configPath: string;
  private config: AgentXConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath ?? getConfigPath();
  }

  isConfigured(): boolean {
    return existsSync(this.configPath);
  }

  load(): AgentXConfig {
    if (this.config) return this.config;

    if (!this.isConfigured()) {
      throw new Error('Agent-X is not configured. Run the setup wizard first.');
    }

    const raw = readFileSync(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const validated = agentXConfigSchema.parse(parsed);
    this.config = validated as AgentXConfig;
    return this.config;
  }

  save(config: AgentXConfig): void {
    const validated = agentXConfigSchema.parse(config);
    const dir = dirname(this.configPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(validated, null, 2), 'utf-8');
    this.config = validated as AgentXConfig;
  }

  update(partial: Partial<AgentXConfig>): void {
    const current = this.load();
    const merged = { ...current, ...partial };
    this.save(merged);
  }

  ensureDirectories(): void {
    const dirs = [getConfigDir(), getDataDir(), getCacheDir(), getLogDir()];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }
  }

  getPath(): string {
    return this.configPath;
  }
}
