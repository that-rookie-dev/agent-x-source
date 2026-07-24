import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import SettingsIcon from '@mui/icons-material/Settings';
import { PanelHeader } from './PanelHeader';
import TuneIcon from '@mui/icons-material/Tune';
import StorageIcon from '@mui/icons-material/Storage';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import ModelIcon from '@mui/icons-material/Psychology';
import BrainIcon from '@mui/icons-material/Memory';
import SpeedIcon from '@mui/icons-material/Speed';
import NotificationsIcon from '@mui/icons-material/Notifications';
import KeyboardVoiceIcon from '@mui/icons-material/KeyboardVoice';
import SecurityIcon from '@mui/icons-material/Security';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import { CheckCircle } from './CheckCircle';
import { config, personaApi, settingsPermissions, type AgentXConfig, type AgentPersonaConfig } from '../api';
import { useApp } from '../store/AppContext';
import {
  settingsTheme,
  settingsTabSx,
  settingsMonoSx,
} from '../styles/settings-theme';
import { PersistenceTab } from './settings/PersistenceTab';
import { PersonaConfigPanel } from './settings/PersonaConfigPanel';
import { WebSearchToolsTab, mergeWebSearchConfig } from './settings/WebSearchToolsTab';
import { ChannelsTab, mergeChannelsConfig } from './settings/ChannelsTab';
import { LocalModelTab } from './settings/LocalModelTab';
import { PerformanceTab } from './settings/PerformanceTab';
import { VoiceTab, mergeVoiceConfig } from './settings/VoiceTab';
import { notifyVoiceConfigUpdated } from '../voice/support';
import { ProvidersPanel } from './ProvidersPanel';
import { useLocalModelSupported } from '../hooks/useSystemCapabilities';
import { KnowledgeTab } from './settings/KnowledgeTab';
import { PermissionsTab } from './settings/PermissionsTab';
import { GeneralTab } from './settings/GeneralTab';

type SettingsTab =
  | 'general'
  | 'models'
  | 'persona'
  | 'tools'
  | 'persistence'
  | 'local-model'
  | 'knowledge'
  | 'channels'
  | 'performance'
  | 'voice'
  | 'permissions';

type SaveFlash = 'idle' | 'saving' | 'saved' | 'error' | 'persona';

const ALL_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <TuneIcon sx={{ fontSize: 14 }} /> },
  { id: 'models', label: 'Models', icon: <ModelIcon sx={{ fontSize: 14 }} /> },
  { id: 'performance', label: 'Performance', icon: <SpeedIcon sx={{ fontSize: 14 }} /> },
  { id: 'persona', label: 'Persona', icon: <SmartToyIcon sx={{ fontSize: 14 }} /> },
  { id: 'local-model', label: 'Local', icon: <BrainIcon sx={{ fontSize: 14 }} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <LibraryBooksIcon sx={{ fontSize: 14 }} /> },
  { id: 'voice', label: 'Voice', icon: <KeyboardVoiceIcon sx={{ fontSize: 14 }} /> },
  { id: 'channels', label: 'Channels', icon: <NotificationsIcon sx={{ fontSize: 14 }} /> },
  { id: 'tools', label: 'Search', icon: <TravelExploreIcon sx={{ fontSize: 14 }} /> },
  { id: 'persistence', label: 'Storage', icon: <StorageIcon sx={{ fontSize: 14 }} /> },
  { id: 'permissions', label: 'Permissions', icon: <SecurityIcon sx={{ fontSize: 14 }} /> },
];

const AUTOSAVE_MS = 700;
const SAVED_VISIBLE_MS = 3000;

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const localModelSupported = useLocalModelSupported();
  const tabs = useMemo(() => localModelSupported ? ALL_TABS : ALL_TABS.filter((t) => t.id !== 'local-model'), [localModelSupported]);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [persona, setPersona] = useState<AgentPersonaConfig | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [saveFlash, setSaveFlash] = useState<SaveFlash>('idle');

  const cfgRef = useRef(cfg);
  const personaRef = useRef(persona);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  cfgRef.current = cfg;
  personaRef.current = persona;

  useEffect(() => { config.get().then(setCfg).catch(() => {}); }, []);

  useEffect(() => {
    if (!localModelSupported && activeTab === 'local-model') {
      setActiveTab('general');
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

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedClearRef.current) clearTimeout(savedClearRef.current);
  }, []);

  const flash = useCallback((next: SaveFlash) => {
    setSaveFlash(next);
    if (savedClearRef.current) clearTimeout(savedClearRef.current);
    if (next === 'saved' || next === 'error' || next === 'persona') {
      savedClearRef.current = setTimeout(() => setSaveFlash('idle'), SAVED_VISIBLE_MS);
    }
  }, []);

  const persistNow = useCallback(async (nextCfg: AgentXConfig, nextPersona: AgentPersonaConfig | null) => {
    flash('saving');
    try {
      const { permissions, ...rest } = nextCfg;
      const payload: Partial<AgentXConfig> = {
        ...rest,
        channels: mergeChannelsConfig(nextCfg.channels),
        tools: nextCfg.tools?.webSearch
          ? { ...nextCfg.tools, webSearch: mergeWebSearchConfig(nextCfg.tools.webSearch) }
          : nextCfg.tools,
        voice: mergeVoiceConfig(nextCfg.voice),
      };
      await settingsPermissions.update(permissions ?? {});
      await config.update(payload);
      const merged = { ...nextCfg, ...payload };
      setCfg(merged);
      setConfig(merged);
      notifyVoiceConfigUpdated(payload.voice);

      if (nextPersona) {
        if (!nextPersona.description?.trim()) {
          flash('persona');
          return;
        }
        await personaApi.save(nextPersona);
        window.dispatchEvent(new CustomEvent('agentx:persona-updated'));
      }
      flash('saved');
    } catch {
      flash('error');
    }
  }, [flash, setConfig]);

  const scheduleSave = useCallback((nextCfg: AgentXConfig, nextPersona?: AgentPersonaConfig | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const personaToSave = nextPersona !== undefined ? nextPersona : personaRef.current;
    saveTimerRef.current = setTimeout(() => {
      void persistNow(nextCfg, personaToSave);
    }, AUTOSAVE_MS);
  }, [persistNow]);

  const updateCfg = useCallback((next: AgentXConfig | ((prev: AgentXConfig) => AgentXConfig)) => {
    setCfg((prev) => {
      if (!prev) return prev;
      const resolved = typeof next === 'function' ? next(prev) : next;
      scheduleSave(resolved);
      return resolved;
    });
  }, [scheduleSave]);

  const updatePersona = useCallback((p: AgentPersonaConfig | null) => {
    setPersona(p);
    if (cfgRef.current && p) scheduleSave(cfgRef.current, p);
  }, [scheduleSave]);

  const webSearchConfig = mergeWebSearchConfig(cfg?.tools?.webSearch);
  const channelsConfig = mergeChannelsConfig(cfg?.channels);

  const headerAction = (() => {
    if (saveFlash === 'saved') {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <CheckCircle size={14} color={settingsTheme.accent.signal} />
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.signal, fontWeight: 600, ...settingsMonoSx }}>
            Saved
          </Typography>
        </Box>
      );
    }
    if (saveFlash === 'saving') {
      return (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          Saving…
        </Typography>
      );
    }
    if (saveFlash === 'error') {
      return (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
          Save failed
        </Typography>
      );
    }
    if (saveFlash === 'persona') {
      return (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
          Persona description required
        </Typography>
      );
    }
    return null;
  })();

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
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: settingsTheme.bg.void }}>
      <PanelHeader
        title="Settings"
        subtitle="Mission control · neural links · ops config"
        icon={<SettingsIcon sx={{ fontSize: 18, color: settingsTheme.accent.hud }} />}
        action={headerAction}
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

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pt: 1.5, pb: 3 }}>
        {activeTab === 'general' && <GeneralTab cfg={cfg} onChange={updateCfg} />}
        {activeTab === 'persona' && (
          personaLoading ? (
            <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, p: 4, ...settingsMonoSx }}>
              Loading persona…
            </Typography>
          ) : (
            <PersonaConfigPanel value={persona} onChange={updatePersona} />
          )
        )}
        {activeTab === 'models' && <ProvidersPanel />}
        {activeTab === 'local-model' && <LocalModelTab />}
        {activeTab === 'knowledge' && <KnowledgeTab />}
        {activeTab === 'voice' && (
          <VoiceTab
            value={cfg.voice}
            onChange={(voice) => updateCfg({ ...cfg, voice })}
          />
        )}
        {activeTab === 'channels' && (
          <ChannelsTab
            value={channelsConfig}
            onChange={(channels) => updateCfg({ ...cfg, channels })}
          />
        )}
        {activeTab === 'tools' && (
          <WebSearchToolsTab
            value={webSearchConfig}
            onChange={(webSearch) => updateCfg({
              ...cfg,
              tools: { ...cfg.tools, webSearch },
            })}
          />
        )}
        {activeTab === 'persistence' && <PersistenceTab />}
        {activeTab === 'performance' && (
          <PerformanceTab cfg={cfg} onChange={updateCfg} />
        )}
        {activeTab === 'permissions' && (
          <PermissionsTab
            value={cfg.permissions}
            onChange={(permissions) => updateCfg({ ...cfg, permissions })}
          />
        )}
      </Box>
    </Box>
  );
}
