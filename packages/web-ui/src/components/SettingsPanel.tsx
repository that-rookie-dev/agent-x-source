import { useState, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import SettingsIcon from '@mui/icons-material/Settings';
import { PanelHeader } from './PanelHeader';
import PersonIcon from '@mui/icons-material/Person';
import StorageIcon from '@mui/icons-material/Storage';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BuildIcon from '@mui/icons-material/Build';
import ModelIcon from '@mui/icons-material/Psychology';
import BrainIcon from '@mui/icons-material/Memory';
import SpeedIcon from '@mui/icons-material/Speed';
import NotificationsIcon from '@mui/icons-material/Notifications';
import KeyboardVoiceIcon from '@mui/icons-material/KeyboardVoice';
import { CheckCircle } from './CheckCircle';
import { config, personaApi, type AgentXConfig, type AgentPersonaConfig } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import {
  settingsTheme,
  settingsTabSx,
  settingsGridBgSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsMonoSx,
} from '../styles/settings-theme';
import { SettingsCard } from './settings/SettingsCard';
import { SettingsSectionHeader } from './settings/SettingsSectionHeader';
import { PersistenceTab } from './settings/PersistenceTab';
import { PersonaConfigPanel } from './settings/PersonaConfigPanel';
import { WebSearchToolsTab, mergeWebSearchConfig } from './settings/WebSearchToolsTab';
import { ChannelsTab, mergeChannelsConfig } from './settings/ChannelsTab';
import { LocalModelTab } from './settings/LocalModelTab';
import { RuntimeTab } from './settings/RuntimeTab';
import { VoiceTab, mergeVoiceConfig } from './settings/VoiceTab';
import { notifyVoiceConfigUpdated } from '../voice/support';
import { ProvidersPanel } from './ProvidersPanel';
import { useLocalModelSupported } from '../hooks/useSystemCapabilities';

type SettingsTab = 'general' | 'persona' | 'models' | 'tools' | 'persistence' | 'local-model' | 'channels' | 'runtime' | 'voice';

const ALL_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'models', label: 'Models', icon: <ModelIcon sx={{ fontSize: 14 }} /> },
  { id: 'runtime', label: 'Runtime', icon: <SpeedIcon sx={{ fontSize: 14 }} /> },
  { id: 'general', label: 'Profile', icon: <PersonIcon sx={{ fontSize: 14 }} /> },
  { id: 'persona', label: 'Persona', icon: <SmartToyIcon sx={{ fontSize: 14 }} /> },
  { id: 'local-model', label: 'Local', icon: <BrainIcon sx={{ fontSize: 14 }} /> },
  { id: 'voice', label: 'Voice', icon: <KeyboardVoiceIcon sx={{ fontSize: 14 }} /> },
  { id: 'channels', label: 'Channels', icon: <NotificationsIcon sx={{ fontSize: 14 }} /> },
  { id: 'tools', label: 'Search', icon: <BuildIcon sx={{ fontSize: 14 }} /> },
  { id: 'persistence', label: 'Storage', icon: <StorageIcon sx={{ fontSize: 14 }} /> },
];

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const localModelSupported = useLocalModelSupported();
  const tabs = useMemo(() => localModelSupported ? ALL_TABS : ALL_TABS.filter((t) => t.id !== 'local-model'), [localModelSupported]);
  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [persona, setPersona] = useState<AgentPersonaConfig | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { config.get().then(setCfg).catch(() => {}); }, []);

  useEffect(() => {
    if (!localModelSupported && activeTab === 'local-model') {
      setActiveTab('models');
    }
  }, [localModelSupported, activeTab]);

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
      const payload: AgentXConfig = {
        ...cfg,
        channels: mergeChannelsConfig(cfg.channels),
        tools: cfg.tools?.webSearch
          ? { ...cfg.tools, webSearch: mergeWebSearchConfig(cfg.tools.webSearch) }
          : cfg.tools,
        voice: mergeVoiceConfig(cfg.voice),
      };
      await config.update(payload);
      setCfg(payload);
      setConfig(payload);
      notifyVoiceConfigUpdated(payload.voice);
      if (persona) await personaApi.save(persona);
      window.dispatchEvent(new CustomEvent('agentx:persona-updated'));
      setMessage('saved');
      setTimeout(() => setMessage(''), 2500);
    } catch {
      setMessage('error');
    } finally {
      setSaving(false);
    }
  };

  const webSearchConfig = mergeWebSearchConfig(cfg?.tools?.webSearch);
  const channelsConfig = mergeChannelsConfig(cfg?.channels);

  if (!cfg) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: settingsTheme.bg.void }}>
        <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          ◈ INITIALIZING COMMAND DECK…
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: settingsTheme.bg.void, ...settingsGridBgSx }}>
      <PanelHeader
        title="Settings"
        subtitle="Mission control · neural links · ops config"
        icon={<SettingsIcon sx={{ fontSize: 18, color: settingsTheme.accent.hud }} />}
      />

      <Box sx={{
        flexShrink: 0,
        display: 'flex',
        borderBottom: `1px solid ${settingsTheme.border.default}`,
        px: 3,
        bgcolor: settingsTheme.bg.panel,
        overflowX: 'auto',
      }}>
        {tabs.map((tab) => (
          <Button key={tab.id} onClick={() => setActiveTab(tab.id)} sx={settingsTabSx(activeTab === tab.id)}>
            {tab.icon} {tab.label}
          </Button>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pt: 2, pb: 10 }}>
        {activeTab === 'general' && (
          <Box>
            <SettingsSectionHeader
              icon={<PersonIcon sx={{ fontSize: 16 }} />}
              title="Profile"
              subtitle="Your callsign for crew comms and system logs"
            />
            <SettingsCard title="Callsign">
              <TextField
                size="small"
                label="Callsign"
                value={cfg.user?.callsign ?? ''}
                onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })}
                sx={{ ...settingsTextFieldSx, maxWidth: 320 }}
                placeholder="e.g. Commander"
              />
              <Typography sx={settingsHelperSx}>Used in crew communication and log entries.</Typography>
            </SettingsCard>
          </Box>
        )}
        {activeTab === 'persona' && (
          personaLoading ? (
            <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, p: 4, ...settingsMonoSx }}>
              Loading persona…
            </Typography>
          ) : (
            <PersonaConfigPanel value={persona} onChange={setPersona} />
          )
        )}
        {activeTab === 'models' && <ProvidersPanel />}
        {activeTab === 'local-model' && <LocalModelTab />}
        {activeTab === 'voice' && (
          <VoiceTab
            value={cfg.voice}
            onChange={(voice) => setCfg({ ...cfg, voice })}
          />
        )}
        {activeTab === 'channels' && (
          <ChannelsTab
            value={channelsConfig}
            onChange={(channels) => setCfg({ ...cfg, channels })}
          />
        )}
        {activeTab === 'tools' && (
          <WebSearchToolsTab
            value={webSearchConfig}
            onChange={(webSearch) => setCfg({
              ...cfg,
              tools: { ...cfg.tools, webSearch },
            })}
          />
        )}
        {activeTab === 'persistence' && <PersistenceTab />}
        {activeTab === 'runtime' && (
          <RuntimeTab cfg={cfg} onChange={setCfg} />
        )}
      </Box>

      <Box sx={{
        flexShrink: 0, px: 3, py: 1.5,
        borderTop: `1px solid ${settingsTheme.border.default}`,
        bgcolor: settingsTheme.bg.panel,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2,
      }}>
        {message === 'saved' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CheckCircle size={16} color={settingsTheme.accent.signal} />
            <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>CONFIG SAVED</Typography>
          </Box>
        )}
        {message === 'error' && <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>SAVE FAILED</Typography>}
        {message === 'description_required' && <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>PERSONA DESCRIPTION REQUIRED</Typography>}
        <Button variant="contained" onClick={handleSave} disabled={saving}
          sx={{
            bgcolor: colors.text.primary, color: colors.bg.primary,
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1.5px',
            px: 3, py: 0.75, minWidth: 110,
            '&:hover': { bgcolor: colors.text.secondary },
          }}>
          {saving ? 'Saving…' : 'Commit'}
        </Button>
      </Box>
    </Box>
  );
}
