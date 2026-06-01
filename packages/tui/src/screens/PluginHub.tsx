import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { Banner } from '../components/Banner.js';
import { PluginRegistry, PostgresStorageAdapter, getBuiltinPlugin, getMarketplaceExtensions } from '@agentx/engine';
import type { MCPBridge, ACPBridge, MarketplaceExtension } from '@agentx/engine';
import type { PluginHubEntry, InstalledPlugin, PluginConfigField } from '@agentx/shared';

type HubView = 'tabs' | 'detail_installed' | 'detail_available' | 'detail_mcp' | 'detail_acp' | 'detail_marketplace' | 'config' | 'config_field_list' | 'confirm_uninstall' | 'comparison' | 'test_connection';
type HubTab = 'installed' | 'available' | 'mcp' | 'acp' | 'marketplace';

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Database',
  messaging: 'Messaging & Notifications',
  storage: 'Storage & Cache',
  monitoring: 'Monitoring & Observability',
  search: 'Search & Discovery',
  automation: 'Automation & Integration',
  tools: 'Developer Tools',
  other: 'Other',
};

const COMPARISON_DATA = [
  { feature: 'Setup', sqlite: 'Zero-config, embedded in app data directory', postgresql: 'Requires external PostgreSQL server, connection string' },
  { feature: 'Concurrency', sqlite: 'Single-writer, limited concurrent reads', postgresql: 'Full concurrent read/write with connection pooling' },
  { feature: 'Storage Limit', sqlite: '~140TB theoretical, degrades past ~100GB', postgresql: 'Petabyte-scale, enterprise-grade' },
  { feature: 'Performance', sqlite: 'Fast for local single-user use', postgresql: 'Optimized for multi-user, parallel queries' },
  { feature: 'User Management', sqlite: 'File-system permissions only', postgresql: 'Role-based access control, SSL, auth methods' },
  { feature: 'Replication', sqlite: 'None (file copy backup)', postgresql: 'Streaming replication, logical replication, hot standby' },
  { feature: 'Cloud Deployment', sqlite: 'Not suitable (file-locking issues)', postgresql: 'Native support on AWS RDS, Azure DB, GCP Cloud SQL' },
  { feature: 'Backup & Restore', sqlite: 'File-level copy', postgresql: 'pg_dump, pg_backrest, WAL archiving, point-in-time recovery' },
  { feature: 'Migration', sqlite: 'N/A (default storage)', postgresql: 'Automatic schema migration on connect' },
];

interface PluginHubProps {
  currentProvider?: string;
  currentModel?: string;
  onClose: () => void;
  registry?: PluginRegistry;
  onPluginChanged?: () => void;
  mcpBridge?: MCPBridge;
  acpBridge?: ACPBridge;
}

export const PluginHub: React.FC<PluginHubProps> = ({ currentProvider, currentModel, onClose, registry: externalRegistry, onPluginChanged, mcpBridge, acpBridge }) => {
  const [localRegistry] = useState(() => new PluginRegistry());
  const registry = externalRegistry ?? localRegistry;
  const [view, setView] = useState<HubView>('tabs');
  const [tab, setTab] = useState<HubTab>('installed');
  const [focusPlugin, setFocusPlugin] = useState<InstalledPlugin | PluginHubEntry | null>(null);

  // Config editing
  const [configKey, setConfigKey] = useState('');
  const [configValue, setConfigValue] = useState('');
  const [configIdx, setConfigIdx] = useState(0);

  // Test connection
  const [testResult, setTestResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  // MCP server status
  const [mcpServerStatus, setMcpServerStatus] = useState<Array<{ name: string; running: boolean; toolCount: number }>>([]);

  useEffect(() => {
    if (mcpBridge) {
      setMcpServerStatus(mcpBridge.getServerStatus());
    }
  }, [mcpBridge]);

  // ACP server status
  const [acpServerStatus, setAcpServerStatus] = useState<Array<{ id: string; name: string; running: boolean; toolCount: number; error?: string }>>([]);

  useEffect(() => {
    if (acpBridge) {
      setAcpServerStatus(acpBridge.getServerStatus());
    }
  }, [acpBridge]);

  // ScrollableList instances need independent input handling — track which list is focused
  const [comparisonOffset, setComparisonOffset] = useState(0);

  // MCP detail
  const [mcpDetailConfig, setMcpDetailConfig] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!testRunning || !focusPlugin) return;
    const connStr = (focusPlugin as InstalledPlugin).config['connectionString'] as string;
    if (!connStr) {
      setTestResult({ ok: false, error: 'No connection string configured' });
      setTestRunning(false);
      return;
    }
    PostgresStorageAdapter.testConnection(connStr).then((result) => {
      setTestResult(result);
      setTestRunning(false);
    });
  }, [testRunning, focusPlugin]);

  useInput((input, key) => {
    if (key.escape) {
      if (view === 'detail_installed' || view === 'detail_available' || view === 'detail_mcp' || view === 'detail_acp' || view === 'detail_marketplace') {
        setView('tabs');
        setFocusPlugin(null);
        setMcpDetailConfig(null);
      } else if (view === 'config' || view === 'confirm_uninstall' || view === 'comparison' || view === 'test_connection') {
        if (focusPlugin && 'installedAt' in focusPlugin) {
          setView('detail_installed');
        } else if (mcpDetailConfig) {
          setView('detail_mcp');
        } else {
          setView('detail_available');
        }
      } else {
        onClose();
      }
      return;
    }

    if (view === 'tabs') {
      if (key.leftArrow || input === 'h') {
        setTab((prev) => {
          const order: HubTab[] = ['installed', 'available', 'mcp', 'acp', 'marketplace'];
          const idx = order.indexOf(prev);
          return order[Math.max(0, idx - 1)] ?? prev;
        });
      }
      if (key.rightArrow || input === 'l') {
        setTab((prev) => {
          const order: HubTab[] = ['installed', 'available', 'mcp', 'acp', 'marketplace'];
          const idx = order.indexOf(prev);
          return order[Math.min(order.length - 1, idx + 1)] ?? prev;
        });
      }
    } else if (view === 'detail_installed') {
      if (input === 't' || input === 'T') handleToggle();
      if (input === 'e' || input === 'E') setView('config_field_list');
      if (input === 'u' || input === 'U') setView('confirm_uninstall');
      if ((input === 'c' || input === 'C') && focusPlugin?.id === 'postgresql') startTestConnection();
      if ((input === 'v' || input === 'V') && focusPlugin?.id === 'postgresql') setView('comparison');
    } else if (view === 'detail_available') {
      if (key.return) handleInstall();
    } else if (view === 'detail_mcp') {
      if (input === 't' || input === 'T') {
        if (focusPlugin && mcpBridge) {
          const name = (focusPlugin as { name: string }).name;
          const cfg = mcpBridge.getServerConfig(name);
          if (cfg) {
            mcpBridge.updateServerConfig(name, { enabled: !(cfg.enabled ?? true) });
            setMcpDetailConfig({ ...cfg, enabled: !(cfg.enabled ?? true) } as unknown as Record<string, unknown>);
            setMcpServerStatus(mcpBridge.getServerStatus());
          }
        }
      }
    } else if (view === 'config_field_list') {
      if (key.escape) { setView('detail_installed'); return; }
    } else if (view === 'confirm_uninstall') {
      if (input === 'u' || input === 'U') handleUninstall();
    } else if (view === 'config') {
      if (key.return) saveConfig();
      if (input === ' ') setConfigValue((v) => v === 'true' ? 'false' : 'true');
      if (input === 'y' || input === 'Y') { setConfigValue('true'); }
      if (input === 'n' || input === 'N') { setConfigValue('false'); }
    } else if (view === 'comparison') {
      if (key.upArrow || input === 'k') setComparisonOffset((o) => Math.max(0, o - 1));
      if (key.downArrow || input === 'j') setComparisonOffset((o) => Math.min(COMPARISON_DATA.length - 1, o + 1));
    }
  });

  const installed = registry.getInstalled();
  const available = registry.getAvailable();

  function getConfigEntries(p: InstalledPlugin | PluginHubEntry): Array<[string, unknown]> {
    if ('installedAt' in p) {
      return Object.entries((p as InstalledPlugin).config);
    }
    return Object.entries((p as PluginHubEntry).config ?? {});
  }

  function handleInstall() {
    if (focusPlugin && 'isBuiltin' in focusPlugin) {
      try {
        registry.install(focusPlugin as PluginHubEntry);
        onPluginChanged?.();
        setView('tabs');
        setFocusPlugin(null);
      } catch { /* ignore */ }
    }
  }

  function handleUninstall() {
    if (focusPlugin && 'installedAt' in focusPlugin) {
      try {
        registry.uninstall(focusPlugin.id);
        onPluginChanged?.();
        setView('tabs');
        setFocusPlugin(null);
      } catch { /* ignore */ }
    }
  }

  function handleToggle() {
    if (focusPlugin && 'installedAt' in focusPlugin) {
      try {
        registry.toggle(focusPlugin.id);
        onPluginChanged?.();
        const updated = registry.getInstalled().find((p) => p.id === focusPlugin.id) ?? null;
        setFocusPlugin(updated);
      } catch { /* ignore */ }
    }
  }

  function openConfigEditor(index?: number) {
    const p = focusPlugin as InstalledPlugin;
    const entries = Object.entries(p.config);
    const idx = index ?? 0;
    if (entries.length > 0 && idx < entries.length) {
      setConfigKey(entries[idx]![0]);
      setConfigValue(String(entries[idx]![1]));
      setConfigIdx(idx);
      setView('config');
    }
  }

  function getConfigSchema(id: string): Record<string, PluginConfigField> {
    const entry = getBuiltinPlugin(id);
    return (entry?.config ?? {}) as Record<string, PluginConfigField>;
  }

  function getFieldLabel(key: string, schema: Record<string, PluginConfigField>): string {
    return schema[key]?.label ?? key;
  }

  function getFieldType(key: string, schema: Record<string, PluginConfigField>): 'string' | 'number' | 'boolean' | 'select' {
    return schema[key]?.type ?? 'string';
  }

  function saveConfig() {
    if (!focusPlugin) return;
    const id = 'installedAt' in focusPlugin ? focusPlugin.id : focusPlugin.id;
    try {
      const entries = getConfigEntries(focusPlugin);
      const origVal = entries[configIdx]?.[1];
      let parsed: unknown = configValue;
      if (typeof origVal === 'number') parsed = Number(configValue);
      else if (typeof origVal === 'boolean') parsed = configValue === 'true';
      registry.updateConfig(id, { [configKey]: parsed });
      onPluginChanged?.();
      setView('detail_installed');
    } catch { /* ignore */ }
  }

  function startTestConnection() {
    setTestResult(null);
    setTestRunning(true);
    setView('test_connection');
  }

  // ── Comparison view ──
  if (view === 'comparison') {
    const visible = COMPARISON_DATA.slice(comparisonOffset, comparisonOffset + 8);
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>SQLite vs PostgreSQL</Text>
          <Text color={COLORS.textDim}>Comparison of storage backends</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {visible.map((row) => (
            <Box key={row.feature} flexDirection="column" marginBottom={1}>
              <Text color={COLORS.primary} bold>{row.feature}</Text>
              <Text color={COLORS.textDim}>  SQLite:     {row.sqlite}</Text>
              <Text color={COLORS.info}>  PostgreSQL: {row.postgresql}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim}>
            {comparisonOffset > 0 ? '↑ more above • ' : ''}
            {comparisonOffset + 8 < COMPARISON_DATA.length ? '↓ more below • ' : ''}
            Esc: back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Test connection view ──
  if (view === 'test_connection') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Test PostgreSQL Connection</Text>
          {testRunning && (
            <Box marginTop={1}>
              <Text color={COLORS.textDim}>Connecting...</Text>
            </Box>
          )}
          {!testRunning && testResult && (
            <Box marginTop={1} flexDirection="column">
              {testResult.ok ? (
                <Box>
                  <Text color={COLORS.success}>Connected!</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  <Text color={COLORS.warning}>Connection failed</Text>
                  <Text color={COLORS.error}>{testResult.error}</Text>
                </Box>
              )}
              {testResult.ok && testResult.version && (
                <Box marginTop={1}>
                  <Text color={COLORS.textDim}>Version: </Text><Text color={COLORS.text}>{testResult.version}</Text>
                </Box>
              )}
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Esc: back</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Config field list ──
  if (view === 'config_field_list' && focusPlugin && 'installedAt' in focusPlugin) {
    const p = focusPlugin as InstalledPlugin;
    const entries = Object.entries(p.config);
    const schema = getConfigSchema(p.id);
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>{p.name} — Configure</Text>
        </Box>
        {entries.length === 0 ? (
          <Box paddingX={2} marginTop={1}><Text color={COLORS.textDim}>No configurable fields.</Text></Box>
        ) : (
          <Box marginTop={1}>
            <ScrollableList
              items={entries}
              label="Config Fields"
              onSelect={([key]) => {
                const idx = entries.findIndex(([k]) => k === key);
                openConfigEditor(idx);
              }}
              onCancel={() => setView('detail_installed')}
              renderItem={([key, value]: [string, unknown], sel: boolean) => {
                const type = getFieldType(key, schema);
                const label = getFieldLabel(key, schema);
                const typeTag = type === 'boolean' ? 'bool' : type;
                return (
                  <Box>
                    <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>{label}</Text>
                    <Text color={COLORS.textDim}>  ({typeTag})</Text>
                    <Text color={COLORS.text}>  {type === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</Text>
                  </Box>
                );
              }}
            />
          </Box>
        )}
      </Box>
    );
  }

  // ── Config editing ──
  if (view === 'config' && focusPlugin) {
    const pluginId = 'installedAt' in focusPlugin ? focusPlugin.id : focusPlugin.id;
    const schema = getConfigSchema(pluginId);
    const fieldType = getFieldType(configKey, schema);
    const fieldLabel = getFieldLabel(configKey, schema);
    const fieldDesc = schema[configKey]?.description;
    const isBool = fieldType === 'boolean';

    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>{focusPlugin.name} — {fieldLabel}</Text>
          {fieldDesc && <Text color={COLORS.textDim}>{fieldDesc}</Text>}
          <Box marginTop={1}>
            {isBool ? (
              <Box flexDirection="row" gap={1}>
                <Text color={COLORS.text}>Value: </Text>
                <Box
                  paddingX={1}
                  borderStyle={configValue === 'true' ? 'bold' : undefined}
                  borderColor={configValue === 'true' ? COLORS.success : COLORS.textDim}
                >
                  <Text color={configValue === 'true' ? COLORS.success : COLORS.textDim} bold={configValue === 'true'}>Yes</Text>
                </Box>
                <Box
                  paddingX={1}
                  borderStyle={configValue === 'false' ? 'bold' : undefined}
                  borderColor={configValue === 'false' ? COLORS.warning : COLORS.textDim}
                >
                  <Text color={configValue === 'false' ? COLORS.warning : COLORS.textDim} bold={configValue === 'false'}>No</Text>
                </Box>
              </Box>
            ) : fieldType === 'number' ? (
              <Box>
                <Text color={COLORS.text}>Value: </Text>
                <TextInput
                  value={configValue}
                  onChange={(v) => { if (/^-?\d*\.?\d*$/.test(v)) setConfigValue(v); }}
                  onSubmit={saveConfig}
                />
              </Box>
            ) : (
              <Box>
                <Text color={COLORS.text}>Value: </Text>
                <TextInput value={configValue} onChange={setConfigValue} onSubmit={saveConfig} />
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            {isBool ? (
              <Text color={COLORS.textDim}>Enter to save • Space to toggle • Esc to cancel</Text>
            ) : (
              <Text color={COLORS.textDim}>Enter to save • Esc to cancel</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Confirm uninstall ──
  if (view === 'confirm_uninstall' && focusPlugin) {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.warning} bold>Uninstall {focusPlugin.name}?</Text>
          <Text color={COLORS.textDim}>Configuration will be removed.</Text>
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Press U to confirm • Esc to cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Detail: Installed plugin ──
  if (view === 'detail_installed' && focusPlugin && 'installedAt' in focusPlugin) {
    const p = focusPlugin as InstalledPlugin;
    const entries = getConfigEntries(p);
    const isPostgres = p.id === 'postgresql';
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>{p.name} <Text color={COLORS.textDim}>v{p.version}</Text></Text>
          <Text color={COLORS.textDim}>{p.description}</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box><Text color={COLORS.textDim}>Status: </Text><Text color={p.enabled ? COLORS.success : COLORS.warning}>{p.enabled ? 'Enabled' : 'Disabled'}</Text></Box>
            <Box><Text color={COLORS.textDim}>Category: </Text><Text>{CATEGORY_LABELS[p.category] ?? p.category}</Text></Box>
            {p.isBuiltin && <Box><Text color={COLORS.info}>Built-in plugin</Text></Box>}
          </Box>
          {entries.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text color={COLORS.primary} bold>Configuration</Text>
              {entries.map(([key, value]) => (
                <Box key={key} marginTop={1}>
                  <Text color={COLORS.textDim}>  {key}: </Text><Text color={COLORS.text}>{String(value)}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>
              T: toggle • E: configure • U: uninstall
              {isPostgres ? ' • C: test connection • V: comparison' : ''}
              {' • Esc: back'}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Detail: Available plugin ──
  if (view === 'detail_available' && focusPlugin && 'isBuiltin' in focusPlugin && !('installedAt' in focusPlugin)) {
    const entry = focusPlugin as PluginHubEntry;
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>{entry.name} <Text color={COLORS.textDim}>v{entry.version}</Text></Text>
          <Text color={COLORS.textDim}>{entry.description}</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box><Text color={COLORS.textDim}>Category: </Text><Text>{CATEGORY_LABELS[entry.category] ?? entry.category}</Text></Box>
            {entry.tags.length > 0 && <Box><Text color={COLORS.textDim}>Tags: </Text><Text>{entry.tags.join(', ')}</Text></Box>}
            {entry.isBuiltin && <Box><Text color={COLORS.info}>Built-in plugin</Text></Box>}
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.success}>Press Enter to install • Esc to go back</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Detail: MCP server ──
  if (view === 'detail_mcp' && focusPlugin && mcpBridge) {
    const serverName = (focusPlugin as { name: string }).name;
    const config = mcpDetailConfig ?? mcpBridge.getServerConfig(serverName) ?? {};
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>MCP Server: {serverName}</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box><Text color={COLORS.textDim}>Command: </Text><Text>{(config as Record<string, unknown>).command as string}</Text></Box>
            <Box><Text color={COLORS.textDim}>Args: </Text><Text>{((config as Record<string, unknown>).args as string[] ?? []).join(' ')}</Text></Box>
            <Box><Text color={COLORS.textDim}>Enabled: </Text><Text color={(config as Record<string, unknown>).enabled !== false ? COLORS.success : COLORS.warning}>{(config as Record<string, unknown>).enabled !== false ? 'Yes' : 'No'}</Text></Box>
            <Box><Text color={COLORS.textDim}>Timeout: </Text><Text>{String((config as Record<string, unknown>).timeout ?? 30)}s</Text></Box>
            <Box><Text color={COLORS.textDim}>Permission Level: </Text><Text>{String((config as Record<string, unknown>).permissionLevel ?? 'medium')}</Text></Box>
            <Box><Text color={COLORS.textDim}>Max Output: </Text><Text>{String((config as Record<string, unknown>).maxOutputSize ?? '100KB')}</Text></Box>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>T: toggle enabled • Esc: back</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Detail: ACP server ──
  if (view === 'detail_acp' && focusPlugin && acpBridge) {
    const serverId = (focusPlugin as { id: string }).id;
    const config = (acpBridge.getServerConfig(serverId) ?? {}) as { name?: string; command?: string; args?: string[]; host?: string; port?: number; enabled?: boolean };
    const status = acpServerStatus.find((s) => s.id === serverId);
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>ACP Server: {config.name}</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box>
              <Text color={COLORS.textDim}>Status: </Text>
              <Text color={status?.running ? COLORS.success : COLORS.warning}>
                {status?.running ? '● Connected' : '○ Disconnected'}
              </Text>
            </Box>
            <Box><Text color={COLORS.textDim}>Tool Count: </Text><Text>{status?.toolCount ?? 0}</Text></Box>
            {config.command && <Box><Text color={COLORS.textDim}>Command: </Text><Text>{config.command} {config.args?.join(' ') ?? ''}</Text></Box>}
            {config.host && <Box><Text color={COLORS.textDim}>Host: </Text><Text>{config.host}:{config.port}</Text></Box>}
            <Box><Text color={COLORS.textDim}>Enabled: </Text><Text color={config.enabled !== false ? COLORS.success : COLORS.warning}>{config.enabled !== false ? 'Yes' : 'No'}</Text></Box>
            {status?.error && <Box><Text color={COLORS.warning}>Error: {status.error}</Text></Box>}
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Esc: back</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Detail: Marketplace extension ──
  if (view === 'detail_marketplace' && focusPlugin && 'permissionLevel' in focusPlugin) {
    const ext = focusPlugin as unknown as MarketplaceExtension;
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>{ext.name} <Text color={COLORS.textDim}>by {ext.author}</Text></Text>
          <Text color={COLORS.textDim}>{ext.description}</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Box><Text color={COLORS.textDim}>Permission Level: </Text><Text color={ext.permissionLevel === 'low' ? COLORS.success : ext.permissionLevel === 'critical' ? COLORS.warning : COLORS.text}>{ext.permissionLevel}</Text></Box>
            <Box><Text color={COLORS.textDim}>Tools: </Text><Text>{ext.tools}</Text></Box>
            <Box><Text color={COLORS.textDim}>Registers in: </Text><Text>{ext.installsTo}</Text></Box>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Esc: back</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Main tab view ──
  const marketplaceExts = getMarketplaceExtensions();

  return (
    <Box flexDirection="column" padding={1}>
      <Banner provider={currentProvider} model={currentModel} />
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text color={COLORS.primary} bold>Plugin Hub  <Text color={COLORS.textDim}>({installed.length} installed / {available.length} available / {marketplaceExts.length} extensions)</Text></Text>
        <Box marginTop={1} flexDirection="row" gap={2}>
          <Text color={tab === 'installed' ? COLORS.primary : COLORS.textDim} bold={tab === 'installed'} underline={tab === 'installed'}>
            Installed ({installed.length})
          </Text>
          <Text color={COLORS.textDim}>|</Text>
          <Text color={tab === 'available' ? COLORS.primary : COLORS.textDim} bold={tab === 'available'} underline={tab === 'available'}>
            Available ({available.length})
          </Text>
          <Text color={COLORS.textDim}>|</Text>
          <Text color={tab === 'mcp' ? COLORS.primary : COLORS.textDim} bold={tab === 'mcp'} underline={tab === 'mcp'}>
            MCP ({mcpServerStatus.length})
          </Text>
          <Text color={COLORS.textDim}>|</Text>
          <Text color={tab === 'acp' ? COLORS.primary : COLORS.textDim} bold={tab === 'acp'} underline={tab === 'acp'}>
            ACP ({acpServerStatus.length})
          </Text>
          <Text color={COLORS.textDim}>|</Text>
          <Text color={tab === 'marketplace' ? COLORS.primary : COLORS.textDim} bold={tab === 'marketplace'} underline={tab === 'marketplace'}>
            Marketplace ({marketplaceExts.length})
          </Text>
        </Box>
        <Text color={COLORS.textDim}>← → / h l: switch tab • Esc: close</Text>
      </Box>

      {tab === 'installed' && (
        <Box marginTop={1}>
          {installed.length === 0 ? (
            <Box paddingX={1}><Text color={COLORS.textDim}>No plugins installed. Switch to Available tab.</Text></Box>
          ) : (
            <ScrollableList
              items={installed}
              label="Installed"
              onSelect={(item) => { setFocusPlugin(item); setView('detail_installed'); }}
              onCancel={onClose}
              renderItem={(item: InstalledPlugin, sel: boolean) => (
                <Box>
                  <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>
                    {item.enabled ? '' : '⏸ '}{item.name}
                  </Text>
                  <Text color={COLORS.textDim}>  v{item.version}  [{item.enabled ? 'ON' : 'OFF'}]</Text>
                </Box>
              )}
            />
          )}
        </Box>
      )}

      {tab === 'available' && (
        <Box marginTop={1}>
          {available.length === 0 ? (
            <Box paddingX={1}><Text color={COLORS.textDim}>All plugins are installed.</Text></Box>
          ) : (
            <ScrollableList
              items={available}
              label="Available"
              onSelect={(item) => { setFocusPlugin(item); setView('detail_available'); }}
              onCancel={onClose}
              renderItem={(item: PluginHubEntry, sel: boolean) => (
                <Box>
                  <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>
                    {item.name}
                  </Text>
                  <Text color={COLORS.textDim}>  v{item.version}  {CATEGORY_LABELS[item.category] ?? item.category}</Text>
                </Box>
              )}
            />
          )}
        </Box>
      )}

      {tab === 'mcp' && (
        <Box marginTop={1}>
          {mcpServerStatus.length === 0 ? (
            <Box paddingX={1}><Text color={COLORS.textDim}>No MCP servers configured. Add servers to ~/.config/agentx/mcp.json.</Text></Box>
          ) : (
            <ScrollableList
              items={mcpServerStatus}
              label="MCP Servers"
              onSelect={(server) => {
                setFocusPlugin(server as unknown as InstalledPlugin);
                setMcpDetailConfig(null);
                setView('detail_mcp');
              }}
              onCancel={onClose}
              renderItem={(server: { name: string; running: boolean; toolCount: number }, sel: boolean) => (
                <Box>
                  <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>
                    {server.name}
                  </Text>
                  <Text color={COLORS.textDim}>  </Text>
                  <Text color={server.running ? COLORS.success : COLORS.warning}>
                    {server.running ? '● Running' : '○ Stopped'}
                  </Text>
                  <Text color={COLORS.textDim}>  {server.toolCount} tool(s)</Text>
                </Box>
              )}
            />
          )}
        </Box>
      )}

      {tab === 'acp' && (
        <Box marginTop={1}>
          {acpServerStatus.length === 0 ? (
            <Box paddingX={1}><Text color={COLORS.textDim}>No ACP servers configured. Add servers to the PluginRegistry.</Text></Box>
          ) : (
            <ScrollableList
              items={acpServerStatus}
              label="ACP Servers"
              onSelect={(server) => {
                setFocusPlugin(server as unknown as InstalledPlugin);
                setView('detail_acp');
              }}
              onCancel={onClose}
              renderItem={(server: { id: string; name: string; running: boolean; toolCount: number }, sel: boolean) => (
                <Box>
                  <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>
                    {server.name}
                  </Text>
                  <Text color={COLORS.textDim}>  </Text>
                  <Text color={server.running ? COLORS.success : COLORS.warning}>
                    {server.running ? '● Connected' : '○ Disconnected'}
                  </Text>
                  <Text color={COLORS.textDim}>  {server.toolCount} tool(s)</Text>
                </Box>
              )}
            />
          )}
        </Box>
      )}

      {tab === 'marketplace' && (
        <Box marginTop={1}>
          {marketplaceExts.length === 0 ? (
            <Box paddingX={1}><Text color={COLORS.textDim}>No extensions available in the marketplace.</Text></Box>
          ) : (
            <ScrollableList
              items={marketplaceExts}
              label="Marketplace"
              onSelect={(ext) => {
                setFocusPlugin(ext as unknown as InstalledPlugin);
                setView('detail_marketplace');
              }}
              onCancel={onClose}
              renderItem={(ext: MarketplaceExtension, sel: boolean) => (
                <Box>
                  <Text color={sel ? COLORS.primary : COLORS.text} bold={sel}>
                    {ext.name}
                  </Text>
                  <Text color={COLORS.textDim}>  by {ext.author}</Text>
                  <Text color={COLORS.textDim}>  </Text>
                  <Text color={ext.permissionLevel === 'low' ? COLORS.success : ext.permissionLevel === 'critical' ? COLORS.warning : COLORS.textDim}>
                    [{ext.permissionLevel}]
                  </Text>
                </Box>
              )}
            />
          )}
        </Box>
      )}
    </Box>
  );
};

export type { PluginHubProps };
