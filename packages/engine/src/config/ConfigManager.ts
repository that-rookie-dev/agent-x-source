import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentXConfig } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { agentXConfigSchema } from './ConfigSchema.js';
import { getConfigPath, getConfigDir, getDataDir, getCacheDir, getLogDir } from './paths.js';

export class ConfigManager {
  private configPath: string;
  private backupPath: string;
  private config: AgentXConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath ?? getConfigPath();
    this.backupPath = this.configPath + '.bak';
  }

  isConfigured(): boolean {
    return existsSync(this.configPath);
  }

  load(): AgentXConfig {
    if (this.config) return this.config;

    if (!this.isConfigured()) {
      throw new Error('Agent-X is not configured. Run the setup wizard first.');
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const validated = agentXConfigSchema.parse(parsed);
      this.config = validated as AgentXConfig;
      // Auto-detect timezone if not set (migration for existing configs)
      if (!this.config.timezone) {
        this.config.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      return this.config;
    } catch (err) {
      // Config corrupted — try backup
      const logger = getLogger();
      logger.error('CONFIG_LOAD_FAILED', err);

      if (existsSync(this.backupPath)) {
        logger.info('CONFIG_ROLLBACK', 'Attempting to load backup config');
        try {
          const raw = readFileSync(this.backupPath, 'utf-8');
          const parsed = JSON.parse(raw) as unknown;
          const validated = agentXConfigSchema.parse(parsed);
          this.config = validated as AgentXConfig;
          // Restore backup as primary
          writeFileSync(this.configPath, raw, 'utf-8');
          return this.config;
        } catch (backupErr) {
          logger.error('CONFIG_BACKUP_ALSO_CORRUPT', backupErr);
        }
      }

      throw err;
    }
  }

  save(config: AgentXConfig): void {
    const validated = agentXConfigSchema.parse(config);
    const dir = dirname(this.configPath);
    mkdirSync(dir, { recursive: true });

    // Backup current config before writing
    if (existsSync(this.configPath)) {
      try {
        copyFileSync(this.configPath, this.backupPath);
      } catch {
        // Backup failure is non-critical
      }
    }

    writeFileSync(this.configPath, JSON.stringify(validated, null, 2), 'utf-8');
    this.config = validated as AgentXConfig;
  }

  update(partial: Partial<AgentXConfig>): void {
    const current = this.load();
    const merged = { ...current, ...partial };
    this.save(merged);
  }

  /**
   * Restore config from backup file. Returns true if restored.
   */
  restoreBackup(): boolean {
    if (!existsSync(this.backupPath)) return false;

    try {
      const raw = readFileSync(this.backupPath, 'utf-8');
      // Validate backup is parseable
      const parsed = JSON.parse(raw) as unknown;
      agentXConfigSchema.parse(parsed);
      // Replace current with backup
      const dir = dirname(this.configPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.configPath, raw, 'utf-8');
      this.config = null; // Force reload on next access
      return true;
    } catch {
      return false;
    }
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

  reset(): void {
    if (existsSync(this.configPath)) {
      unlinkSync(this.configPath);
    }
    this.config = null;
  }
}
