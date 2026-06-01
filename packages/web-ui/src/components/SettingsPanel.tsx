import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import { config, providers as provApi, models as modelsApi, crews, type AgentXConfig, type ProviderInfo, type Crew } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [crewList, setCrewList] = useState<Crew[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    config.get().then(setCfg).catch(() => {});
    provApi.available().then(setAvailableProviders).catch(() => {});
    crews.list().then(setCrewList).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true);
    setMessage('');
    try {
      await config.update(cfg);
      setConfig(cfg);
      setMessage('Settings saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchModel = async (model: string) => {
    try {
      await modelsApi.switch(model);
      if (cfg) setCfg({ ...cfg, provider: { ...cfg.provider, activeModel: model } });
    } catch { /* ignore */ }
  };

  const handleSwitchCrew = async (crewId: string) => {
    try { await crews.switch(crewId); } catch { /* ignore */ }
  };

  if (!cfg) return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: colors.text.dim }}>Loading settings...</Typography></Box>;

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Settings</Typography>
      {message && <Alert severity={message.includes('failed') || message.includes('Failed') ? 'error' : 'success'} sx={{ mb: 2 }}>{message}</Alert>}

      {/* Provider & Model */}
      <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>Provider & Model</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Provider</InputLabel>
          <Select value={cfg.provider.activeProvider} label="Provider" onChange={(e) => setCfg({ ...cfg, provider: { ...cfg.provider, activeProvider: e.target.value } })}>
            {availableProviders.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" label="Active Model" value={cfg.provider.activeModel} onChange={(e) => setCfg({ ...cfg, provider: { ...cfg.provider, activeModel: e.target.value } })} sx={{ flex: 1 }} />
        <Button size="small" onClick={() => handleSwitchModel(cfg.provider.activeModel)} sx={{ color: colors.accent.blue }}>Switch</Button>
      </Box>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* Crew */}
      <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>Active Crew</Typography>
      <FormControl size="small" sx={{ minWidth: 200, mb: 2 }}>
        <InputLabel>Crew</InputLabel>
        <Select label="Crew" defaultValue="" onChange={(e) => handleSwitchCrew(e.target.value)}>
          {crewList.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.isDefault ? ' (default)' : ''}</MenuItem>)}
        </Select>
      </FormControl>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* User */}
      <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>User</Typography>
      <TextField size="small" label="Callsign" value={cfg.user?.callsign ?? ''} onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })} sx={{ mb: 2 }} />

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* UI */}
      <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>UI Preferences</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Animation</InputLabel>
          <Select value={cfg.ui?.animationSpeed ?? 'normal'} label="Animation" onChange={(e) => setCfg({ ...cfg, ui: { ...cfg.ui, animationSpeed: e.target.value } })}>
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="reduced">Reduced</MenuItem>
            <MenuItem value="normal">Normal</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
        {saving ? 'Saving...' : 'Save Settings'}
      </Button>
    </Box>
  );
}
