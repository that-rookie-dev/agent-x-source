import { useState, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SettingsIcon from '@mui/icons-material/Settings';
import SearchIcon from '@mui/icons-material/Search';
import { plugins, type PluginInfo } from '../api';
import { colors } from '../theme';

export function PluginsPanel() {
  const [available, setAvailable] = useState<PluginInfo[]>([]);
  const [installed, setInstalled] = useState<PluginInfo[]>([]);
  const [configPlugin, setConfigPlugin] = useState<PluginInfo | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const load = () => {
    plugins.available().then(setAvailable).catch(() => {});
    plugins.installed().then(setInstalled).catch(() => {});
  };
  useEffect(load, []);

  const handleInstall = async (id: string) => {
    try { await plugins.install(id); load(); } catch { /* ignore */ }
  };

  const handleUninstall = async (id: string) => {
    try { await plugins.uninstall(id); load(); } catch { /* ignore */ }
  };

  const handleToggle = async (id: string) => {
    try { await plugins.toggle(id); load(); } catch { /* ignore */ }
  };

  const handleConfigure = async (p: PluginInfo) => {
    try {
      const detail = await plugins.getConfig(p.id);
      setConfigPlugin(detail);
      const vals: Record<string, string> = {};
      detail.configFields?.forEach((f) => { vals[f.key] = String(detail.config?.[f.key] ?? ''); });
      setConfigValues(vals);
    } catch {
      setConfigPlugin(p);
      setConfigValues({});
    }
  };

  const handleSaveConfig = async () => {
    if (!configPlugin) return;
    try {
      await plugins.updateConfig(configPlugin.id, configValues);
      setConfigPlugin(null);
      load();
    } catch { /* ignore */ }
  };

  const allPlugins = [...installed, ...available.filter((a) => !installed.find((i) => i.id === a.id))];

  const categories = useMemo(() => {
    const set = new Set<string>();
    allPlugins.forEach((p) => { if (p.category) set.add(p.category); });
    return ['all', ...Array.from(set).sort()];
  }, [allPlugins]);

  const visiblePlugins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPlugins.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [allPlugins, search, categoryFilter]);

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 600, mb: 0.5 }}>Plugin Hub</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>
        Project tools and integrations to extend Agent-X capabilities
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          InputProps={{
            startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: colors.text.dim }} /></InputAdornment>),
            sx: { fontSize: '0.75rem' },
          }}
        />
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
          {visiblePlugins.length}/{allPlugins.length}
        </Typography>
      </Box>

      {categories.length > 1 && (
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
          {categories.map((cat) => (
            <Chip
              key={cat}
              size="small"
              label={cat === 'all' ? `All (${allPlugins.length})` : `${cat} (${allPlugins.filter((p) => p.category === cat).length})`}
              onClick={() => setCategoryFilter(cat)}
              sx={{
                fontSize: '0.55rem', height: 22, cursor: 'pointer',
                bgcolor: categoryFilter === cat ? colors.accent.blue + '30' : 'transparent',
                border: `1px solid ${categoryFilter === cat ? colors.accent.blue : colors.border.default}`,
                color: categoryFilter === cat ? colors.text.primary : colors.text.dim,
              }}
            />
          ))}
        </Box>
      )}

      {visiblePlugins.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>
            {allPlugins.length === 0 ? 'No plugins available' : 'No plugins match your filters'}
          </Typography>
        </Box>
      )}

      {visiblePlugins.map((p) => {
        const isInstalled = p.installed;
        const isActive = p.enabled;
        return (
          <Box key={p.id} sx={{
            p: 1.5, mb: 1, borderRadius: 1, bgcolor: colors.bg.tertiary,
            border: `1px solid ${isActive ? colors.accent.green + '40' : colors.border.default}`,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{p.name}</Typography>
                  {p.category && <Chip size="small" label={p.category} sx={{ height: 16, fontSize: '0.45rem', color: colors.text.dim }} />}
                  <Chip size="small" label={isActive ? 'Active' : isInstalled ? 'Disabled' : 'Available'} sx={{
                    height: 18, fontSize: '0.5rem',
                    color: isActive ? colors.accent.green : isInstalled ? colors.accent.orange : colors.text.dim,
                    borderColor: isActive ? colors.accent.green + '40' : isInstalled ? colors.accent.orange + '40' : colors.border.default,
                  }} variant="outlined" />
                </Box>
                <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 0.25 }}>{p.description}</Typography>
              </Box>

              {/* Action buttons */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {isInstalled && (
                  <>
                    <Button size="small" onClick={() => handleToggle(p.id)}
                      sx={{ fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto', color: isActive ? colors.accent.orange : colors.accent.green }}>
                      {isActive ? 'Disable' : 'Enable'}
                    </Button>
                    {p.configFields && p.configFields.length > 0 && (
                      <Button size="small" startIcon={<SettingsIcon sx={{ fontSize: 12 }} />} onClick={() => handleConfigure(p)}
                        sx={{ fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto', color: colors.text.secondary }}>
                        Configure
                      </Button>
                    )}
                    <Button size="small" onClick={() => handleUninstall(p.id)}
                      sx={{ fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto', color: colors.accent.red }}>
                      Uninstall
                    </Button>
                  </>
                )}
                {!isInstalled && (
                  <Button size="small" variant="outlined" onClick={() => handleInstall(p.id)}
                    sx={{ fontSize: '0.55rem', textTransform: 'none', borderColor: colors.accent.blue, color: colors.accent.blue }}>
                    Install
                  </Button>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}

      {/* Configure Dialog */}
      <Dialog open={!!configPlugin} onClose={() => setConfigPlugin(null)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 360 } }}>
        <DialogTitle sx={{ fontSize: '0.85rem' }}>Configure {configPlugin?.name}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          {configPlugin?.configFields?.map((field) => (
            <TextField
              key={field.key}
              size="small"
              label={field.label}
              type={field.type === 'password' ? 'password' : 'text'}
              required={field.required}
              value={configValues[field.key] ?? ''}
              onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
            />
          ))}
          {(!configPlugin?.configFields || configPlugin.configFields.length === 0) && (
            <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>No configuration options available for this plugin.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigPlugin(null)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleSaveConfig} variant="contained" sx={{ bgcolor: colors.accent.blue, textTransform: 'none' }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
