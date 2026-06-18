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
import Alert from '@mui/material/Alert';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonIcon from '@mui/icons-material/Person';
import PaletteIcon from '@mui/icons-material/Palette';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { config, factoryReset, setAuthToken, type AgentXConfig } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

const cardSx = {
  bgcolor: colors.bg.secondary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 1.5,
  p: 3,
  mb: 2,
};

const sectionLabelSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mb: 2.5,
};

const sectionTitleSx = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: colors.text.primary,
  letterSpacing: '0.01em',
};

const helperSx = {
  fontSize: '0.65rem',
  color: colors.text.dim,
  mt: 0.5,
  lineHeight: 1.5,
};

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
      setMessage('saved');
      setTimeout(() => setMessage(''), 2500);
    } catch (e) {
      setMessage('error');
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

  if (!cfg) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: '0.8rem', color: colors.text.dim }}>Loading settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ flexShrink: 0, px: 4, pt: 3, pb: 2, borderBottom: `1px solid ${colors.border.default}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <SettingsIcon sx={{ fontSize: 20, color: colors.text.secondary }} />
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: colors.text.primary }}>
            Settings
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, ml: 4.5 }}>
          Configure your profile, appearance, and application preferences
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 4, pt: 3, pb: 10 }}>
        {/* ── Profile ── */}
        <Box sx={cardSx}>
          <Box sx={sectionLabelSx}>
            <PersonIcon sx={{ fontSize: 16, color: colors.text.secondary }} />
            <Typography sx={sectionTitleSx}>Profile</Typography>
          </Box>

          <TextField
            size="small"
            label="Callsign"
            value={cfg.user?.callsign ?? ''}
            onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })}
            sx={{ maxWidth: 320 }}
            slotProps={{
              input: { sx: { fontSize: '0.8rem' } },
              inputLabel: { sx: { fontSize: '0.75rem' } },
            }}
            placeholder="e.g. Commander"
          />
          <Typography sx={helperSx}>
            Your personal callsign. Used in crew communication and logs to identify you.
          </Typography>
        </Box>

        {/* ── Appearance ── */}
        <Box sx={cardSx}>
          <Box sx={sectionLabelSx}>
            <PaletteIcon sx={{ fontSize: 16, color: colors.text.secondary }} />
            <Typography sx={sectionTitleSx}>Appearance</Typography>
          </Box>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel sx={{ fontSize: '0.75rem' }}>Animation Speed</InputLabel>
            <Select
              value={cfg.ui?.animationSpeed ?? 'normal'}
              label="Animation Speed"
              onChange={(e) => setCfg({ ...cfg, ui: { ...cfg.ui, animationSpeed: e.target.value } })}
              sx={{ fontSize: '0.8rem' }}
            >
              <MenuItem value="none" sx={{ fontSize: '0.8rem' }}>None — instant transitions</MenuItem>
              <MenuItem value="reduced" sx={{ fontSize: '0.8rem' }}>Reduced — subtle motion</MenuItem>
              <MenuItem value="normal" sx={{ fontSize: '0.8rem' }}>Normal — full animations</MenuItem>
            </Select>
          </FormControl>
          <Typography sx={helperSx}>
            Controls the speed of UI transitions, shimmer effects, and loading animations.
          </Typography>
        </Box>

        {/* ── Danger Zone ── */}
        <Box
          sx={{
            ...cardSx,
            border: `1px solid ${colors.accent.red}30`,
            bgcolor: `${colors.accent.red}05`,
            mb: 0,
          }}
        >
          <Box sx={{ ...sectionLabelSx, mb: 2 }}>
            <WarningAmberIcon sx={{ fontSize: 16, color: colors.accent.red }} />
            <Typography sx={{ ...sectionTitleSx, color: colors.accent.red }}>
              Danger Zone
            </Typography>
          </Box>

          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 2.5, lineHeight: 1.7 }}>
            Permanently erase all local data — configuration, credentials, sessions, chat history,
            memories, plugins, and preferences. Your account will be signed out.
          </Typography>

          <Button
            variant="outlined"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setResetOpen(true)}
            sx={{
              borderColor: colors.accent.red,
              color: colors.accent.red,
              fontSize: '0.75rem',
              textTransform: 'none',
              px: 2.5,
              '&:hover': {
                borderColor: colors.accent.red,
                bgcolor: `${colors.accent.red}10`,
              },
            }}
          >
            Factory Reset
          </Button>
        </Box>
      </Box>

      {/* Sticky Save Bar */}
      <Box
        sx={{
          flexShrink: 0,
          px: 4,
          py: 2,
          borderTop: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.secondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 2,
        }}
      >
        {message === 'saved' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CheckCircleIcon sx={{ fontSize: 16, color: colors.accent.green }} />
            <Typography sx={{ fontSize: '0.75rem', color: colors.accent.green }}>Settings saved</Typography>
          </Box>
        )}
        {message === 'error' && (
          <Typography sx={{ fontSize: '0.75rem', color: colors.accent.red }}>Save failed — try again</Typography>
        )}
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          sx={{
            bgcolor: colors.text.primary,
            color: colors.bg.primary,
            fontSize: '0.8rem',
            fontWeight: 600,
            textTransform: 'none',
            px: 3.5,
            py: 1,
            minWidth: 120,
            '&:hover': { bgcolor: colors.text.secondary },
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>

      {/* Factory Reset Dialog */}
      <Dialog
        open={resetOpen}
        onClose={() => {
          if (!resetting) { setResetOpen(false); setConfirmText(''); setResetError(''); }
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}` } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <WarningAmberIcon sx={{ color: colors.accent.red, fontSize: 22 }} />
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>Factory Reset</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.secondary, mb: 2, lineHeight: 1.7 }}>
            This will permanently delete everything stored locally:
          </Typography>

          <Box component="ul" sx={{ m: 0, pl: 2, mb: 2, fontSize: '0.7rem', color: colors.text.dim, lineHeight: 2.1 }}>
            <li>Authentication credentials and active sessions</li>
            <li>Provider API keys and model configurations</li>
            <li>All chat history, conversations, and message logs</li>
            <li>Uploaded files and file references</li>
            <li>Crew definitions and orchestration settings</li>
            <li>User preferences and UI settings</li>
          </Box>

          <Typography sx={{ fontSize: '0.75rem', color: colors.accent.red, fontWeight: 600, mb: 1.5 }}>
            This cannot be undone. You will need to reconfigure Agent-X from scratch.
          </Typography>

          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 1 }}>
            Type <strong style={{ color: colors.text.primary }}>RESET</strong> to confirm.
          </Typography>
          <TextField
            size="small"
            fullWidth
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type RESET to confirm"
            slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
          />

          {resetError && (
            <Alert severity="error" sx={{ mt: 1.5, fontSize: '0.7rem' }}>{resetError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => { setResetOpen(false); setConfirmText(''); setResetError(''); }}
            disabled={resetting}
            sx={{ fontSize: '0.8rem', textTransform: 'none', color: colors.text.secondary }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleFactoryReset}
            disabled={confirmText !== 'RESET' || resetting}
            variant="contained"
            sx={{
              bgcolor: colors.accent.red,
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 600,
              textTransform: 'none',
              px: 3,
              '&:hover': { bgcolor: '#d32f2f' },
              '&.Mui-disabled': { bgcolor: `${colors.accent.red}40`, color: '#ffffff60' },
            }}
          >
            {resetting ? 'Deleting...' : 'Delete Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
