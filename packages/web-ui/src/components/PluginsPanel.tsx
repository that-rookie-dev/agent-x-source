import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import { plugins, type PluginInfo } from '../api';
import { colors } from '../theme';

export function PluginsPanel() {
  const [available, setAvailable] = useState<PluginInfo[]>([]);
  const [installed, setInstalled] = useState<PluginInfo[]>([]);

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

  const allPlugins = [...installed, ...available.filter((a) => !installed.find((i) => i.id === a.id))];

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Plugins Hub</Typography>

      <Grid container spacing={2}>
        {allPlugins.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <Card sx={{ bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}>
              <CardContent sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.name}</Typography>
                  <Chip size="small" label={p.installed ? (p.enabled ? 'Active' : 'Disabled') : 'Available'} sx={{
                    fontSize: '0.55rem', height: 18,
                    bgcolor: p.enabled ? colors.accent.green + '20' : 'transparent',
                    color: p.enabled ? colors.accent.green : colors.text.dim,
                  }} />
                </Box>
                <Typography variant="caption" sx={{ color: colors.text.tertiary, display: 'block', mt: 0.5 }}>{p.description}</Typography>
              </CardContent>
              <CardActions sx={{ pt: 0 }}>
                {p.installed ? (
                  <>
                    <Button size="small" onClick={() => handleToggle(p.id)} sx={{ fontSize: '0.7rem' }}>
                      {p.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="small" onClick={() => handleUninstall(p.id)} sx={{ fontSize: '0.7rem', color: colors.accent.red }}>
                      Uninstall
                    </Button>
                  </>
                ) : (
                  <Button size="small" onClick={() => handleInstall(p.id)} sx={{ fontSize: '0.7rem', color: colors.accent.blue }}>
                    Install
                  </Button>
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {allPlugins.length === 0 && (
        <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>No plugins available</Typography>
      )}
    </Box>
  );
}
