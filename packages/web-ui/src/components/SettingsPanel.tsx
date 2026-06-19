import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonIcon from '@mui/icons-material/Person';
import StorageIcon from '@mui/icons-material/Storage';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { config, personaApi, type AgentXConfig, type AgentPersonaConfig } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import { PersistenceTab } from './settings/PersistenceTab';
import { PersonaConfigPanel } from './settings/PersonaConfigPanel';

type SettingsTab = 'general' | 'persistence' | 'persona';

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <PersonIcon sx={{ fontSize: 16 }} /> },
  { id: 'persona', label: 'Agent Persona', icon: <SmartToyIcon sx={{ fontSize: 16 }} /> },
  { id: 'persistence', label: 'Persistence', icon: <StorageIcon sx={{ fontSize: 16 }} /> },
];

const cardSx = {
  bgcolor: colors.bg.secondary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 1.5,
  p: 3,
  mb: 2,
};

const helperSx = {
  fontSize: '0.65rem',
  color: colors.text.dim,
  mt: 0.5,
  lineHeight: 1.5,
};

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [persona, setPersona] = useState<AgentPersonaConfig | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { config.get().then(setCfg).catch(() => {}); }, []);

  useEffect(() => {
    if (activeTab === 'persona' && !persona) {
      setPersonaLoading(true);
      personaApi.get().then((p) => {
        if (p && 'name' in p) setPersona(p as AgentPersonaConfig);
        setPersonaLoading(false);
      }).catch(() => setPersonaLoading(false));
    }
  }, [activeTab, persona]);

  const handleSave = async () => {
    if (!cfg) return;
    if (persona && !persona.description?.trim()) {
      setMessage('description_required');
      return;
    }
    setSaving(true); setMessage('');
    try {
      await config.update(cfg);
      setConfig(cfg);
      if (persona) await personaApi.save(persona);
      setMessage('saved');
      setTimeout(() => setMessage(''), 2500);
    } catch {
      setMessage('error');
    } finally {
      setSaving(false);
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
      <Box sx={{ flexShrink: 0, px: 4, pt: 3, pb: 2, borderBottom: `1px solid ${colors.border.default}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <SettingsIcon sx={{ fontSize: 20, color: colors.text.secondary }} />
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: colors.text.primary }}>Settings</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, ml: 4.5 }}>
          Configure your profile, persistence, and preferences
        </Typography>
      </Box>

      <Box sx={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${colors.border.default}`, px: 4 }}>
        {TABS.map((tab) => (
          <Button key={tab.id} onClick={() => setActiveTab(tab.id)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1.25, fontSize: '0.75rem', fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px', textTransform: 'none',
              color: activeTab === tab.id ? colors.text.primary : colors.text.dim,
              borderBottom: activeTab === tab.id ? `2px solid ${colors.text.primary}` : '2px solid transparent',
              borderRadius: 0, minWidth: 0, '&:hover': { color: colors.text.primary, bgcolor: 'transparent' } }}>
            {tab.icon} {tab.label}
          </Button>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 4, pt: 3, pb: 10 }}>
        {activeTab === 'general' && (
          <Box>
            <Box sx={cardSx}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary, mb: 2 }}>Profile</Typography>
              <TextField size="small" label="Callsign" value={cfg.user?.callsign ?? ''}
                onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })} sx={{ maxWidth: 320 }}
                placeholder="e.g. Commander"
                slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
              <Typography sx={helperSx}>Your personal callsign. Used in crew communication and logs.</Typography>
            </Box>
          </Box>
        )}
        {activeTab === 'persona' && (
          personaLoading ? (
            <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, p: 4 }}>Loading persona...</Typography>
          ) : (
            <PersonaConfigPanel value={persona} onChange={setPersona} />
          )
        )}
        {activeTab === 'persistence' && <PersistenceTab />}
      </Box>

      <Box sx={{ flexShrink: 0, px: 4, py: 2, borderTop: `1px solid ${colors.border.default}`, bgcolor: colors.bg.secondary,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
        {message === 'saved' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CheckCircleIcon sx={{ fontSize: 16, color: colors.accent.green }} />
            <Typography sx={{ fontSize: '0.75rem', color: colors.accent.green }}>Settings saved</Typography>
          </Box>
        )}
        {message === 'error' && <Typography sx={{ fontSize: '0.75rem', color: colors.accent.red }}>Save failed — try again</Typography>}
        {message === 'description_required' && <Typography sx={{ fontSize: '0.75rem', color: colors.accent.red }}>Persona description is required</Typography>}
        <Button variant="contained" onClick={handleSave} disabled={saving}
          sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.8rem', fontWeight: 600, textTransform: 'none', px: 3.5, py: 1, minWidth: 120,
            '&:hover': { bgcolor: colors.text.secondary } }}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}
