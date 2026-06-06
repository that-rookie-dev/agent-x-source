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
import { config, type AgentXConfig } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    config.get().then(setCfg).catch(() => {});
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

  if (!cfg) return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: colors.text.dim }}>Loading settings...</Typography></Box>;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5, pb: 1.5 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 600 }}>Settings</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mt: 0.25 }}>
          Configure user preferences and UI behavior
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {message && <Alert severity={message.includes('failed') || message.includes('Failed') ? 'error' : 'success'} sx={{ mb: 2, fontSize: '0.75rem' }} onClose={() => setMessage('')}>{message}</Alert>}

        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, mb: 1.5 }}>User</Typography>
        <TextField size="small" label="Callsign" value={cfg.user?.callsign ?? ''}
          onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })}
          sx={{ mb: 3, maxWidth: 360 }} InputProps={{ sx: { fontSize: '0.75rem' } }}
          placeholder="e.g. Commander" />

        <Divider sx={{ my: 2.5, borderColor: colors.border.default }} />

        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, mb: 1.5 }}>UI Preferences</Typography>
        <FormControl size="small" sx={{ minWidth: 160, mb: 3 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Animation</InputLabel>
          <Select value={cfg.ui?.animationSpeed ?? 'normal'} label="Animation"
            onChange={(e) => setCfg({ ...cfg, ui: { ...cfg.ui, animationSpeed: e.target.value } })} sx={{ fontSize: '0.75rem' }}>
            <MenuItem value="none" sx={{ fontSize: '0.75rem' }}>None</MenuItem>
            <MenuItem value="reduced" sx={{ fontSize: '0.75rem' }}>Reduced</MenuItem>
            <MenuItem value="normal" sx={{ fontSize: '0.75rem' }}>Normal</MenuItem>
          </Select>
        </FormControl>

        <Button variant="contained" onClick={handleSave} disabled={saving}
          sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.75rem', textTransform: 'none', px: 3 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
}
