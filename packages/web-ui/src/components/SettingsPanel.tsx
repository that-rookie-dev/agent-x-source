import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { config, factoryReset, setAuthToken, type AgentXConfig } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function SettingsPanel() {
  const { config: appConfig, setConfig, initialize } = useApp();
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

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

  const handleFactoryReset = async () => {
    setResetting(true);
    setResetError('');
    try {
      await factoryReset.reset();
      setAuthToken(null);
      sessionStorage.removeItem('agentx_auth_token');
      setResetOpen(false);
      setConfirmText('');
      await initialize();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'Factory reset failed');
    } finally {
      setResetting(false);
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

        {/* ─── Danger Zone ─── */}
        <Divider sx={{ my: 3, borderColor: '#d32f2f40' }} />

        <Box sx={{ border: '1px solid #d32f2f40', borderRadius: 1, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <WarningAmberIcon sx={{ fontSize: 18, color: '#d32f2f' }} />
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#d32f2f', letterSpacing: '0.5px' }}>
              DANGER ZONE
            </Typography>
          </Box>

          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 2, lineHeight: 1.6 }}>
            Permanently deletes all local data and resets the application to its factory state.
            This includes your configuration, credentials, sessions, chat history, files, memory,
            and all plugin settings. This action cannot be undone.
          </Typography>

          <Button variant="outlined" onClick={() => setResetOpen(true)}
            sx={{
              borderColor: '#d32f2f', color: '#d32f2f', fontSize: '0.75rem', textTransform: 'none',
              '&:hover': { borderColor: '#ff6659', bgcolor: '#d32f2f10' },
            }}>
            Factory Reset
          </Button>
        </Box>
      </Box>

      {/* ─── Factory Reset Confirmation Dialog ─── */}
      <Dialog open={resetOpen} onClose={() => { if (!resetting) { setResetOpen(false); setConfirmText(''); setResetError(''); } }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <WarningAmberIcon sx={{ color: '#d32f2f', fontSize: 22 }} />
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>Factory Reset</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.secondary, mb: 2, lineHeight: 1.7 }}>
            This will permanently delete <strong>all</strong> of the following local data:
          </Typography>

          <Box component="ul" sx={{ m: 0, pl: 2, mb: 2, fontSize: '0.7rem', color: colors.text.dim, lineHeight: 2 }}>
            <li>Authentication credentials and sessions</li>
            <li>Provider API keys and model configuration</li>
            <li>Chat history, conversations, and message logs</li>
            <li>Uploaded files and file references</li>
            <li>Secret Sauce (SOUL, memories, identity, diary)</li>
            <li>Crew definitions and agent orchestration settings</li>
            <li>Plugin registry and all plugin configurations</li>
            <li>MCP and ACP server configurations</li>
            <li>RAG index and knowledge base</li>
            <li>User preferences and UI settings</li>
          </Box>

          <Typography sx={{ fontSize: '0.75rem', color: '#d32f2f', fontWeight: 600, mb: 1.5 }}>
            This action cannot be undone. You will need to set up Agent-X from scratch.
          </Typography>

          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 1 }}>
            Type <strong>RESET</strong> to confirm.
          </Typography>
          <TextField size="small" fullWidth value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type RESET to confirm"
            sx={{ '& .MuiInputBase-input': { fontSize: '0.75rem' } }}
          />

          {resetError && (
            <Alert severity="error" sx={{ mt: 1.5, fontSize: '0.7rem' }}>{resetError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setResetOpen(false); setConfirmText(''); setResetError(''); }}
            disabled={resetting}
            sx={{ fontSize: '0.75rem', textTransform: 'none', color: colors.text.secondary }}>
            Cancel
          </Button>
          <Button onClick={handleFactoryReset} disabled={confirmText !== 'RESET' || resetting} variant="contained"
            sx={{
              bgcolor: '#d32f2f', color: '#fff', fontSize: '0.75rem', textTransform: 'none',
              '&:hover': { bgcolor: '#b71c1c' },
              '&.Mui-disabled': { bgcolor: '#d32f2f50', color: '#ffffff80' },
            }}>
            {resetting ? 'Deleting...' : 'Delete Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
