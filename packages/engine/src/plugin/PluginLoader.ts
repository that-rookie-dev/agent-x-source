import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type {
  PluginManifest,
  PluginInstance,
  PluginLoader,
  PluginToolDescriptor,
  ToolDefinition,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getConfigDir, getDataDir } from '../config/paths.js';

const logger = getLogger();

interface PluginPackageJson {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  'agent-x'?: {
    plugin?: PluginManifest;
  };
  keywords?: string[];
  main?: string;
}

export class DefaultPluginLoader implements PluginLoader {
  private loaded: Map<string, PluginInstance> = new Map();
  private scanDirs: string[];

  constructor(extraScanDirs?: string[]) {
    const dirs = [
      join(getConfigDir(), 'plugins'),
      join(getDataDir(), 'plugins'),
    ];
    if (extraScanDirs) dirs.push(...extraScanDirs);
    this.scanDirs = dirs;
  }

  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.scanDirs) {
      if (!existsSync(dir)) continue;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          if (!statSync(fullPath).isDirectory()) continue;

          // Check for package.json with agent-x plugin metadata
          const pkgPath = join(fullPath, 'package.json');
          if (existsSync(pkgPath)) {
            try {
              const pkg: PluginPackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              const pluginMeta = pkg['agent-x']?.plugin;
              if (pluginMeta) {
                manifests.push({
                  ...pluginMeta,
                  id: pluginMeta.id || pkg.name,
                  name: pluginMeta.name || pkg.name,
                  version: pluginMeta.version || pkg.version,
                  description: pluginMeta.description || pkg.description || '',
                  author: pkg.author,
                  license: pkg.license,
                  source: 'plugin',
                });
              }
            } catch {
              // Invalid package.json — skip
            }
            continue;
          }

          // Check for .plugin.json manifest file
          const manifestPath = join(fullPath, `${entry}.plugin.json`);
          const altManifestPath = join(fullPath, 'plugin.json');
          for (const mp of [manifestPath, altManifestPath]) {
            if (existsSync(mp)) {
              try {
                const manifest: PluginManifest = JSON.parse(readFileSync(mp, 'utf-8'));
                if (manifest.id && manifest.name) {
                  manifest.source = 'plugin';
                  manifests.push(manifest);
                }
              } catch {
                // Invalid manifest — skip
              }
              break;
            }
          }
        }
      } catch {
        // Permission error on directory—skip
      }
    }

    // Scan node_modules for packages tagged with 'agent-x-plugin'
    try {
      const nmPlugins = this.scanNodeModules();
      manifests.push(...nmPlugins);
    } catch {
      // node_modules scan best-effort
    }

    return manifests;
  }

  async load(manifest: PluginManifest): Promise<PluginInstance> {
    if (this.loaded.has(manifest.id)) {
      return this.loaded.get(manifest.id)!;
    }

    const tools = this.descriptorsToTools(manifest.tools, manifest.source);

    const instance: PluginInstance = {
      manifest,
      enabled: true,
      config: {},
      tools,
      async start() {
        logger.info('PLUGIN_START', `Starting plugin ${manifest.id}`);
      },
      async stop() {
        logger.info('PLUGIN_STOP', `Stopping plugin ${manifest.id}`);
      },
      async execute(toolId: string, _args: Record<string, unknown>) {
        logger.info('PLUGIN_EXECUTE', `Plugin ${manifest.id} tool ${toolId} — no runtime executor`);
        return { success: false, output: `Plugin "${manifest.id}" has no runtime executor` };
      },
    };

    // Try to load a runtime module from the plugin directory
    const pluginDir = this.resolvePluginDir(manifest);
    if (pluginDir) {
      try {
        const require = createRequire(join(pluginDir, 'noop.js'));
        const mainModule = require(join(pluginDir, 'index.js'));
        if (mainModule?.start) instance.start = () => mainModule.start(instance.config);
        if (mainModule?.stop) instance.stop = () => mainModule.stop();
        if (mainModule?.execute) {
          instance.execute = (toolId, args) => mainModule.execute(toolId, args, instance.config);
        }
        if (mainModule?.tools) {
          instance.tools = mainModule.tools as ToolDefinition[];
        }
      } catch {
        // No runtime module — plugin provides declarations only
      }
    }

    this.loaded.set(manifest.id, instance);
    return instance;
  }

  async unload(pluginId: string): Promise<void> {
    const instance = this.loaded.get(pluginId);
    if (instance) {
      await instance.stop();
      this.loaded.delete(pluginId);
    }
  }

  getLoaded(): PluginInstance[] {
    return [...this.loaded.values()];
  }

  private descriptorsToTools(
    descriptors: PluginToolDescriptor[],
    source: 'plugin',
  ): ToolDefinition[] {
    return descriptors.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      modelDescription: d.modelDescription,
      category: d.category,
      riskLevel: d.riskLevel,
      schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(d.schema).map(([key, val]) => [
            key,
            typeof val === 'object' && val !== null
              ? { type: String((val as Record<string, unknown>)['type'] ?? 'string'), description: String((val as Record<string, unknown>)['description'] ?? '') }
              : { type: 'string', description: String(val) },
          ]),
        ),
        required: [],
      },
      composable: true,
      source,
    }));
  }

  private resolvePluginDir(manifest: PluginManifest): string | null {
    for (const dir of this.scanDirs) {
      const candidate = join(dir, manifest.id);
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    }
    return null;
  }

  private scanNodeModules(): PluginManifest[] {
    const result: PluginManifest[] = [];
    const cwd = process.cwd();
    const nmPaths = [
      join(cwd, 'node_modules'),
      ...this.resolveGlobalNodeModules(),
    ];

    const seen = new Set<string>();
    for (const nmPath of nmPaths) {
      if (!existsSync(nmPath)) continue;
      try {
        const packages = readdirSync(nmPath);
        for (const pkgName of packages) {
          if (pkgName.startsWith('.') || pkgName.startsWith('@')) continue;
          if (seen.has(pkgName)) continue;
          seen.add(pkgName);

          const pkgJsonPath = join(nmPath, pkgName, 'package.json');
          if (!existsSync(pkgJsonPath)) continue;

          try {
            const pkg: PluginPackageJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            const hasKeyword = pkg.keywords?.includes('agent-x-plugin');
            const hasPluginMeta = !!pkg['agent-x']?.plugin;

            if (!hasKeyword && !hasPluginMeta) continue;

            const meta = pkg['agent-x']?.plugin;
            if (meta) {
              result.push({
                ...meta,
                id: meta.id || pkg.name,
                name: meta.name || pkg.name,
                version: meta.version || pkg.version,
                description: meta.description || pkg.description || '',
                source: 'plugin',
              });
            } else {
              result.push({
                id: pkg.name,
                name: pkg.name,
                version: pkg.version,
                description: pkg.description || '',
                source: 'plugin',
                tools: [],
              });
            }
          } catch {
            // Skip invalid package.json
          }
        }
      } catch {
        // Permission error
      }
    }
    return result;
  }

  private resolveGlobalNodeModules(): string[] {
    const paths: string[] = [];
    try {
      const require = createRequire(join(process.cwd(), 'noop.js'));
      const globalPaths = require.resolve.paths?.('') ?? [];
      for (const gp of globalPaths) {
        const nm = join(gp, 'node_modules');
        if (existsSync(nm)) paths.push(nm);
      }
    } catch {
      // Best-effort
    }
    return paths;
  }
}
