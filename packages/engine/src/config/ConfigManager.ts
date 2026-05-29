import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentXConfig, ProviderProfile } from '@agentx/shared';
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

  /**
   * Returns true if the setup wizard has been completed.
   * Only returns true if setupComplete is explicitly set to true.
   */
  isSetupComplete(): boolean {
    if (!this.isConfigured()) return false;
    try {
      const config = this.load();
      return config.setupComplete === true;
    } catch {
      return false;
    }
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
      // Migrate legacy single-key provider credentials into profiles
      try {
        let migrated = false;
        const providers = this.config.provider?.providers ?? {};
        for (const creds of Object.values(providers)) {
          // If the provider doesn't have an explicit profiles map, but has apiKey/baseUrl,
          // convert into a default profile for multi-profile support.
          // Note: keep top-level apiKey/baseUrl for backwards compatibility.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = creds as any;
          if ((c.profiles === undefined || c.profiles === null) && (c.apiKey || c.baseUrl)) {
            const profileId = 'default';
            const profile: ProviderProfile = {
              label: 'Default',
              apiKey: c.apiKey,
              baseUrl: c.baseUrl,
              createdAt: new Date().toISOString(),
            };
            c.profiles = { [profileId]: profile };
            c.activeProfile = profileId;
            // ensure compat fields remain in place
            c.apiKey = c.apiKey;
            c.baseUrl = c.baseUrl;
            migrated = true;
          }
        }
        if (migrated) {
          // persist migration
          this.save(this.config);
        }
      } catch { /* non-critical migration failure */ }
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

  // --- Provider profile helpers ---
  getProviderProfiles(providerId: string): { activeProfile?: string; profiles?: Record<string, ProviderProfile> } {
    const cfg = this.load();
    const p = cfg.provider.providers?.[providerId];
    return { activeProfile: p?.activeProfile, profiles: p?.profiles };
  }

  getActiveProviderProfile(providerId: string): ProviderProfile | undefined {
    const cfg = this.load();
    const p = cfg.provider.providers?.[providerId];
    if (!p || !p.activeProfile) return undefined;
    return p.profiles?.[p.activeProfile];
  }

  addProviderProfile(providerId: string, profileId: string, profile: ProviderProfile, setActive = true): void {
    const cfg = this.load();
    if (!cfg.provider.providers[providerId]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cfg.provider.providers as any)[providerId] = { configured: false };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (cfg.provider.providers as any)[providerId];
    p.profiles = p.profiles ?? {};
    p.profiles[profileId] = profile;
    if (setActive) p.activeProfile = profileId;
    p.apiKey = profile.apiKey;
    p.baseUrl = profile.baseUrl;
    p.configured = true;
    this.save(cfg);
  }

  removeProviderProfile(providerId: string, profileId: string): void {
    const cfg = this.load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (cfg.provider.providers as any)[providerId];
    if (!p || !p.profiles || !p.profiles[profileId]) return;
    delete p.profiles[profileId];
    if (p.activeProfile === profileId) {
      const remaining = Object.keys(p.profiles || {});
      p.activeProfile = remaining[0] ?? undefined;
      const active = p.activeProfile ? p.profiles[p.activeProfile] : undefined;
      p.apiKey = active?.apiKey;
      p.baseUrl = active?.baseUrl;
    }
    if (!p.profiles || Object.keys(p.profiles).length === 0) {
      p.profiles = undefined;
      p.activeProfile = undefined;
      p.apiKey = undefined;
      p.baseUrl = undefined;
      p.configured = false;
    }
    this.save(cfg);
  }

  setActiveProviderProfile(providerId: string, profileId: string): void {
    const cfg = this.load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (cfg.provider.providers as any)[providerId];
    if (!p || !p.profiles || !p.profiles[profileId]) return;
    p.activeProfile = profileId;
    const active = p.profiles[profileId];
    p.apiKey = active.apiKey;
    p.baseUrl = active.baseUrl;
    p.configured = true;
    this.save(cfg);
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
