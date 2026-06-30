import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import PowerIcon from '@mui/icons-material/Power';
import HubIcon from '@mui/icons-material/Hub';
import { PanelHeader } from './PanelHeader';
import { mcp, type MCPServer } from '../api';
import { colors } from '../theme';

// Pre-configured MCP server catalog
interface MCPCatalogEntry {
  id: string;
  name: string;
  description: string;
  command: string;
  args?: string[];
  category: string;
  configFields?: { key: string; label: string; placeholder: string }[];
}

const MCP_CATALOG: MCPCatalogEntry[] = [
  { id: 'filesystem', name: 'Filesystem', description: 'Read, write, and manage local files', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], category: 'Core' },
  { id: 'github', name: 'GitHub', description: 'Interact with GitHub repos, issues, PRs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], category: 'Dev', configFields: [{ key: 'GITHUB_TOKEN', label: 'GitHub Token', placeholder: 'ghp_...' }] },
  { id: 'gitlab', name: 'GitLab', description: 'GitLab repository and CI/CD management', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'], category: 'Dev', configFields: [{ key: 'GITLAB_TOKEN', label: 'GitLab Token', placeholder: 'glpat-...' }] },
  { id: 'postgres', name: 'PostgreSQL', description: 'Query and manage PostgreSQL databases', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], category: 'Database', configFields: [{ key: 'DATABASE_URL', label: 'Database URL', placeholder: 'postgresql://user:pass@host/db' }] },
  { id: 'sqlite', name: 'SQLite', description: 'Query and manage SQLite databases', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite'], category: 'Database', configFields: [{ key: 'DB_PATH', label: 'Database Path', placeholder: '/path/to/db.sqlite' }] },
  { id: 'redis', name: 'Redis', description: 'Redis key-value store operations', command: 'npx', args: ['-y', '@modelcontextprotocol/server-redis'], category: 'Database', configFields: [{ key: 'REDIS_URL', label: 'Redis URL', placeholder: 'redis://localhost:6379' }] },
  { id: 'brave-search', name: 'Brave Search', description: 'Web search via Brave Search API', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], category: 'Search', configFields: [{ key: 'BRAVE_API_KEY', label: 'Brave API Key', placeholder: 'BSA...' }] },
  { id: 'google-search', name: 'Google Search', description: 'Web search via Google Custom Search', command: 'npx', args: ['-y', '@modelcontextprotocol/server-google-search'], category: 'Search', configFields: [{ key: 'GOOGLE_API_KEY', label: 'Google API Key', placeholder: '' }, { key: 'GOOGLE_CX', label: 'Custom Search ID', placeholder: '' }] },
  { id: 'puppeteer', name: 'Puppeteer', description: 'Browser automation and web scraping', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'], category: 'Web' },
  { id: 'fetch', name: 'Fetch', description: 'HTTP requests and URL content fetching', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], category: 'Web' },
  { id: 'memory', name: 'Memory', description: 'Persistent knowledge graph memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], category: 'Core' },
  { id: 'sequential-thinking', name: 'Sequential Thinking', description: 'Step-by-step reasoning and planning', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], category: 'Reasoning' },
  { id: 'slack', name: 'Slack', description: 'Read and send Slack messages', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], category: 'Communication', configFields: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...' }] },
  { id: 'notion', name: 'Notion', description: 'Notion workspace pages and databases', command: 'npx', args: ['-y', '@notionhq/mcp-server-notion'], category: 'Productivity', configFields: [{ key: 'NOTION_API_KEY', label: 'Notion API Key', placeholder: 'ntn_...' }] },
  { id: 'linear', name: 'Linear', description: 'Linear issue tracking integration', command: 'npx', args: ['-y', '@modelcontextprotocol/server-linear'], category: 'Productivity', configFields: [{ key: 'LINEAR_API_KEY', label: 'Linear API Key', placeholder: 'lin_api_...' }] },
  { id: 'docker', name: 'Docker', description: 'Docker container management', command: 'npx', args: ['-y', '@modelcontextprotocol/server-docker'], category: 'DevOps' },
  { id: 'kubernetes', name: 'Kubernetes', description: 'Kubernetes cluster management', command: 'npx', args: ['-y', '@modelcontextprotocol/server-kubernetes'], category: 'DevOps' },
  { id: 'aws', name: 'AWS', description: 'Amazon Web Services management', command: 'npx', args: ['-y', '@modelcontextprotocol/server-aws'], category: 'Cloud', configFields: [{ key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: '' }, { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: '' }] },
  { id: 'gcp', name: 'Google Cloud', description: 'Google Cloud Platform services', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gcp'], category: 'Cloud' },
  { id: 'sentry', name: 'Sentry', description: 'Error tracking and monitoring', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sentry'], category: 'Monitoring', configFields: [{ key: 'SENTRY_AUTH_TOKEN', label: 'Auth Token', placeholder: '' }] },
  { id: 'playwright', name: 'Playwright', description: 'Browser testing and automation', command: 'npx', args: ['-y', '@executeautomation/playwright-mcp-server'], category: 'Testing' },
  { id: 'everything', name: 'Everything', description: 'MCP test/demo server with sample tools', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], category: 'Dev' },
];

export function MCPPanel() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [tab, setTab] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [catalogConfig, setCatalogConfig] = useState<{ entry: MCPCatalogEntry; values: Record<string, string> } | null>(null);

  const load = () => { mcp.servers().then(setServers).catch(() => {}); };
  useEffect(load, []);

  const handleAdd = async () => {
    if (!newName || !newCommand) return;
    try {
      await mcp.add({ name: newName, command: newCommand, args: newArgs ? newArgs.split(' ') : undefined });
      setDialogOpen(false);
      setNewName(''); setNewCommand(''); setNewArgs('');
      load();
    } catch { /* ignore */ }
  };

  const handleRestart = async (id: string) => {
    try { await mcp.restart(id); load(); } catch { /* ignore */ }
  };

  const handleRemove = async (id: string) => {
    try { await mcp.remove(id); load(); } catch { /* ignore */ }
  };

  const handleCatalogInstall = async (entry: MCPCatalogEntry) => {
    if (entry.configFields && entry.configFields.length > 0) {
      setCatalogConfig({ entry, values: {} });
      return;
    }
    try {
      await mcp.add({ name: entry.name, command: entry.command, args: entry.args });
      load();
    } catch { /* ignore */ }
  };

  const handleCatalogConfigSave = async () => {
    if (!catalogConfig) return;
    const { entry, values } = catalogConfig;
    // Append env vars as args
    const envArgs = Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    try {
      await mcp.add({ name: entry.name, command: entry.command, args: [...(entry.args ?? []), ...envArgs] });
      setCatalogConfig(null);
      load();
    } catch { /* ignore */ }
  };

  const isInstalled = (catalogId: string) => servers.some((s) => s.name.toLowerCase() === catalogId || s.name.toLowerCase() === MCP_CATALOG.find((c) => c.id === catalogId)?.name.toLowerCase());

  const categories = [...new Set(MCP_CATALOG.map((c) => c.category))];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="MCP Servers"
        subtitle="Pre-configured open-source and third-party MCP servers. Enable with one click."
        icon={<HubIcon sx={{ fontSize: 20 }} />}
        action={
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => setDialogOpen(true)}
            sx={{ fontSize: '0.6rem', textTransform: 'none', color: colors.accent.blue }}>
            Custom Server
          </Button>
        }
      />
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: '0.65rem', textTransform: 'none', py: 0.5 } }}>
        <Tab label={`Active (${servers.length})`} />
        <Tab label={`Catalog (${MCP_CATALOG.length})`} />
      </Tabs>

      {/* Active servers tab */}
      {tab === 0 && (
        <Box>
          {servers.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1 }}>
              <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>No active MCP servers. Browse the catalog to enable some.</Typography>
            </Box>
          )}
          {servers.map((s) => (
            <Box key={s.id} sx={{ p: 1.5, mb: 1, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${s.status === 'running' ? colors.accent.green + '40' : colors.border.default}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{s.name}</Typography>
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                    {s.command ?? `${s.host}:${s.port}`}
                    {s.toolCount !== undefined && ` • ${s.toolCount} tools`}
                  </Typography>
                </Box>
                <Chip size="small" label={s.status} variant="outlined" sx={{
                  fontSize: '0.5rem', height: 18, textTransform: 'uppercase',
                  color: s.status === 'running' ? colors.accent.green : s.status === 'error' ? colors.accent.red : colors.text.dim,
                  borderColor: s.status === 'running' ? colors.accent.green + '60' : s.status === 'error' ? colors.accent.red + '60' : colors.border.default,
                }} />
                <IconButton size="small" onClick={() => handleRestart(s.id)} sx={{ color: colors.accent.blue, p: 0.5 }}>
                  <RefreshIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton size="small" onClick={() => handleRemove(s.id)} sx={{ color: colors.accent.red, p: 0.5 }}>
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Catalog tab */}
      {tab === 1 && (
        <Box>
          {categories.map((cat) => (
            <Box key={cat} sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, letterSpacing: '0.5px', mb: 0.5, textTransform: 'uppercase' }}>{cat}</Typography>
              {MCP_CATALOG.filter((c) => c.category === cat).map((entry) => {
                const installed = isInstalled(entry.id);
                return (
                  <Box key={entry.id} sx={{ p: 1.5, mb: 0.75, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${installed ? colors.accent.green + '40' : colors.border.default}` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{entry.name}</Typography>
                          {installed && <Chip size="small" label="Enabled" sx={{ height: 16, fontSize: '0.45rem', color: colors.accent.green, borderColor: colors.accent.green + '40' }} variant="outlined" />}
                        </Box>
                        <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>{entry.description}</Typography>
                      </Box>
                      {!installed ? (
                        <Button size="small" startIcon={<PowerIcon sx={{ fontSize: 12 }} />} onClick={() => handleCatalogInstall(entry)}
                          sx={{ fontSize: '0.55rem', textTransform: 'none', color: colors.accent.blue, minWidth: 'auto' }}>
                          Enable
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => { const s = servers.find((sv) => sv.name.toLowerCase() === entry.name.toLowerCase()); if (s) handleRemove(s.id); }}
                          sx={{ fontSize: '0.55rem', textTransform: 'none', color: colors.accent.red, minWidth: 'auto' }}>
                          Disable
                        </Button>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      {/* Custom Server Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 380 } }}>
        <DialogTitle sx={{ fontSize: '0.85rem' }}>Add Custom MCP Server</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField size="small" label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Custom Server" />
          <TextField size="small" label="Command" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="npx -y @my/mcp-server" />
          <TextField size="small" label="Args (space-separated)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} placeholder="--port 3000 --verbose" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ bgcolor: colors.accent.blue, textTransform: 'none' }}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* Catalog Config Dialog */}
      <Dialog open={!!catalogConfig} onClose={() => setCatalogConfig(null)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 380 } }}>
        <DialogTitle sx={{ fontSize: '0.85rem' }}>Configure {catalogConfig?.entry.name}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>{catalogConfig?.entry.description}</Typography>
          {catalogConfig?.entry.configFields?.map((field) => (
            <TextField
              key={field.key}
              size="small"
              label={field.label}
              type="password"
              value={catalogConfig.values[field.key] ?? ''}
              onChange={(e) => setCatalogConfig({ ...catalogConfig, values: { ...catalogConfig.values, [field.key]: e.target.value } })}
              placeholder={field.placeholder}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCatalogConfig(null)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleCatalogConfigSave} variant="contained" sx={{ bgcolor: colors.accent.blue, textTransform: 'none' }}>Enable</Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Box>
  );
}
