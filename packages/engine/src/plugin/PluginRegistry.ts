import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginHubEntry, PluginCategory, InstalledPlugin } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getPluginRegistryPath, getAcpConfigPath } from '../config/paths.js';
import { getBuiltinCatalog } from './PluginCatalog.js';

const logger = getLogger();

export interface AcpServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  host?: string;
  port?: number;
  enabled: boolean;
  createdAt: string;
}

export class PluginRegistry {
  private installed: Map<string, InstalledPlugin> = new Map();
  private registryPath: string;
  private acpConfigPath: string;
  private acpServers: Map<string, AcpServerConfig> = new Map();

  constructor(registryPath?: string) {
    this.registryPath = registryPath ?? getPluginRegistryPath();
    this.acpConfigPath = getAcpConfigPath();
    this.load();
    this.loadAcpServers();
  }

  getInstalled(): InstalledPlugin[] {
    return [...this.installed.values()];
  }

  getInstalledByCategory(category: PluginCategory): InstalledPlugin[] {
    return this.getInstalled().filter((p) => p.category === category);
  }

  getInstalledCount(): number {
    return this.installed.size;
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  getPlugin(id: string): InstalledPlugin | undefined {
    return this.installed.get(id);
  }

  isEnabled(id: string): boolean {
    return this.installed.get(id)?.enabled ?? false;
  }

  install(hubEntry: PluginHubEntry): InstalledPlugin {
    if (this.installed.has(hubEntry.id)) {
      throw new Error(`Plugin "${hubEntry.id}" is already installed`);
    }

    const now = new Date().toISOString();
    const defaults: Record<string, unknown> = {};
    if (hubEntry.config) {
      for (const [key, field] of Object.entries(hubEntry.config)) {
        if (field.default !== undefined) {
          defaults[key] = field.default;
        }
      }
    }

    const plugin: InstalledPlugin = {
      id: hubEntry.id,
      name: hubEntry.name,
      version: hubEntry.version,
      description: hubEntry.description,
      category: hubEntry.category,
      enabled: true,
      config: defaults,
      installedAt: now,
      updatedAt: now,
      isBuiltin: hubEntry.isBuiltin,
    };

    this.installed.set(hubEntry.id, plugin);
    this.save();
    logger.info('PLUGIN_INSTALLED', `Installed plugin "${hubEntry.id}" (${hubEntry.name})`);
    return plugin;
  }

  uninstall(id: string): void {
    if (!this.installed.has(id)) {
      throw new Error(`Plugin "${id}" is not installed`);
    }
    this.installed.delete(id);
    this.save();
    logger.info('PLUGIN_UNINSTALLED', `Uninstalled plugin "${id}"`);
  }

  toggle(id: string): boolean {
    const plugin = this.installed.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed`);
    plugin.enabled = !plugin.enabled;
    plugin.updatedAt = new Date().toISOString();
    this.save();
    logger.info('PLUGIN_TOGGLED', `Toggled plugin "${id}" -> ${plugin.enabled}`);
    return plugin.enabled;
  }

  enable(id: string): void {
    const plugin = this.installed.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed`);
    if (!plugin.enabled) {
      plugin.enabled = true;
      plugin.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  disable(id: string): void {
    const plugin = this.installed.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed`);
    if (plugin.enabled) {
      plugin.enabled = false;
      plugin.updatedAt = new Date().toISOString();
      this.save();
    }
  }

  updateConfig(id: string, config: Record<string, unknown>): InstalledPlugin {
    const plugin = this.installed.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed`);
    plugin.config = { ...plugin.config, ...config };
    plugin.updatedAt = new Date().toISOString();
    this.save();
    logger.info('PLUGIN_CONFIG', `Updated config for plugin "${id}"`);
    return plugin;
  }

  getConfig(id: string): Record<string, unknown> {
    return this.installed.get(id)?.config ?? {};
  }

  getAvailable(): PluginHubEntry[] {
    const catalog = getBuiltinCatalog();
    return catalog.filter((entry) => !this.installed.has(entry.id));
  }

  getAvailableByCategory(): Record<PluginCategory, PluginHubEntry[]> {
    const grouped: Record<string, PluginHubEntry[]> = {};
    for (const entry of this.getAvailable()) {
      const cat = entry.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(entry);
    }
    return grouped as Record<PluginCategory, PluginHubEntry[]>;
  }

  getInstalledByCategoryGrouped(): Record<PluginCategory, InstalledPlugin[]> {
    const grouped: Record<string, InstalledPlugin[]> = {};
    for (const entry of this.getInstalled()) {
      const cat = entry.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(entry);
    }
    return grouped as Record<PluginCategory, InstalledPlugin[]>;
  }

  getCategories(): PluginCategory[] {
    const cats = new Set<PluginCategory>();
    for (const entry of getBuiltinCatalog()) {
      cats.add(entry.category);
    }
    for (const entry of this.getInstalled()) {
      cats.add(entry.category);
    }
    return [...cats];
  }

  // ── ACP server config ──

  listAcpServers(): AcpServerConfig[] {
    return [...this.acpServers.values()];
  }

  getAcpServer(id: string): AcpServerConfig | undefined {
    return this.acpServers.get(id);
  }

  addAcpServer(config: Omit<AcpServerConfig, 'id' | 'createdAt' | 'enabled'>): AcpServerConfig {
    const server: AcpServerConfig = {
      id: randomUUID(),
      name: config.name,
      command: config.command,
      args: config.args,
      host: config.host,
      port: config.port,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.acpServers.set(server.id, server);
    this.saveAcpServers();
    return server;
  }

  removeAcpServer(id: string): boolean {
    const existed = this.acpServers.delete(id);
    if (existed) this.saveAcpServers();
    return existed;
  }

  toggleAcpServer(id: string): AcpServerConfig | undefined {
    const server = this.acpServers.get(id);
    if (!server) return undefined;
    server.enabled = !server.enabled;
    this.saveAcpServers();
    return server;
  }

  private loadAcpServers(): void {
    try {
      if (!existsSync(this.acpConfigPath)) return;
      const raw = readFileSync(this.acpConfigPath, 'utf-8');
      const data: AcpServerConfig[] = JSON.parse(raw);
      for (const server of data) {
        this.acpServers.set(server.id, server);
      }
    } catch (error) {
      logger.error('ACP_CONFIG_LOAD_FAILED', error);
    }
  }

  private saveAcpServers(): void {
    try {
      const dir = dirname(this.acpConfigPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = [...this.acpServers.values()];
      writeFileSync(this.acpConfigPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('ACP_CONFIG_SAVE_FAILED', error);
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.registryPath)) return;
      const raw = readFileSync(this.registryPath, 'utf-8');
      const data: InstalledPlugin[] = JSON.parse(raw);
      for (const plugin of data) {
        this.installed.set(plugin.id, plugin);
      }
    } catch (error) {
      logger.error('PLUGIN_REGISTRY_LOAD_FAILED', error);
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.registryPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = [...this.installed.values()];
      writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('PLUGIN_REGISTRY_SAVE_FAILED', error);
    }
  }
}
