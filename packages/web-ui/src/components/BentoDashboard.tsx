import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useColorScheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import ChatIcon from '@mui/icons-material/Chat';
import ForumIcon from '@mui/icons-material/Forum';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TelegramIcon from '@mui/icons-material/Telegram';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import SlackIcon from '@mui/icons-material/Forum';
import EmailIcon from '@mui/icons-material/Email';
import MicIcon from '@mui/icons-material/Mic';
import ScheduleIcon from '@mui/icons-material/Schedule';
import StorageIcon from '@mui/icons-material/Storage';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import SensorsIcon from '@mui/icons-material/Sensors';
import CloudIcon from '@mui/icons-material/Cloud';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useApp } from '../store/AppContext';
import { usePageVisible } from '../hooks/usePageVisible';
import { useLocationPermission } from '../hooks/useLocationPermission';
import { PanelHeader } from './PanelHeader';
import { VoiceAgentCard, VoiceAgentHeaderControls } from './voice/VoiceAgentCard';
import { VoiceParticleField, type ParticlePhase } from './voice/VoiceParticleField';
import { VoiceConnectionPulses } from './voice/VoiceConnectionPulses';
import { colors, alphaColor, MONO } from '../theme';
import {
  sessions as sessionsApi,
  bridges,
  automation,
  webuiActive,
  subagents,
  runtime,
} from '../api';
import type { SessionInfo, BridgeStatus, AutomationTaskRecord, SubAgentTaskInfo, SystemMetrics, Weather } from '../api';

interface ChannelDef {
  id: string;
  name: string;
  icon: ReactNode;
  status: BridgeStatus | null;
  loading: boolean;
}

const CHANNELS: ChannelDef[] = [
  { id: 'telegram', name: 'Telegram', icon: <TelegramIcon sx={{ fontSize: 18, color: '#0088cc' }} />, status: null, loading: true },
  { id: 'discord', name: 'Discord', icon: <HeadphonesIcon sx={{ fontSize: 18, color: '#5865f2' }} />, status: null, loading: true },
  { id: 'slack', name: 'Slack', icon: <SlackIcon sx={{ fontSize: 18, color: '#ecb22e' }} />, status: null, loading: true },
  { id: 'email', name: 'Email', icon: <EmailIcon sx={{ fontSize: 18, color: colors.accent.cyan }} />, status: null, loading: true },
];

const MODE_CYCLE = ['dark', 'light', 'system'] as const;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function shortModel(model?: string): string {
  if (!model) return '—';
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
}

function BentoCard({ title, icon, action, children, colSpan, sx, voiceAgentCard }: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  colSpan?: number;
  sx?: object;
  voiceAgentCard?: boolean;
}) {
  return (
    <Box sx={{
      height: '100%',
      gridColumn: colSpan ? { sm: `span ${colSpan}`, md: `span ${colSpan}`, lg: `span ${colSpan}` } : undefined,
      border: `1px solid ${colors.border.default}`,
      borderRadius: '8px',
      bgcolor: colors.bg.secondary,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 140,
      ...sx,
    }}
      data-bento-card
      {...(voiceAgentCard ? { 'data-voice-agent-card': true } : {})}
    >
      <PanelHeader title={title} icon={icon} action={action} compact />
      <Box sx={{ flex: 1, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
        {children}
      </Box>
    </Box>
  );
}

function StatRow({ label, value, color, loading }: { label: string; value: string | number; color?: string; loading?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
      <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim, letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      {loading ? (
        <CircularProgress size={10} sx={{ color: colors.text.dim }} />
      ) : (
        <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: color || colors.text.secondary, fontWeight: 600 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color }}>{label}</Typography>
    </Box>
  );
}

function channelStatusLabel(status: BridgeStatus | null, loading: boolean): { label: string; color: string } {
  if (loading) return { label: 'Checking…', color: colors.text.dim };
  if (!status) return { label: 'Unknown', color: colors.text.dim };
  if (status.error) return { label: 'Error', color: colors.accent.red };
  if (status.connected) return { label: 'Connected', color: colors.accent.green };
  if (status.configured) return { label: 'Disconnected', color: colors.accent.orange };
  return { label: 'Not configured', color: colors.text.dim };
}

function taskColor(status: AutomationTaskRecord['status']): string {
  switch (status) {
    case 'active': return colors.accent.green;
    case 'paused': return colors.accent.orange;
    case 'cancelled': return colors.accent.red;
    case 'completed': return colors.text.dim;
    default: return colors.text.dim;
  }
}

function subagentColor(status: SubAgentTaskInfo['status']): string {
  switch (status) {
    case 'running': return colors.accent.green;
    case 'queued': return colors.accent.orange;
    case 'pending': return colors.accent.blue;
    case 'completed': return colors.text.dim;
    case 'failed': return colors.accent.red;
    case 'cancelled': return colors.accent.red;
    default: return colors.text.dim;
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function weatherDescription(code: number): string {
  // WMO Weather interpretation codes (Open-Meteo)
  if (code === 0) return 'Clear sky';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Unknown';
}

function formatClientDateTime(timezone: string): { time: string; date: string } {
  const now = new Date();
  try {
    const time = now.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const date = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return { time, date };
  } catch {
    return { time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) };
  }
}

export function BentoDashboard() {
  const navigate = useNavigate();
  const { healthData, serverOnline, refreshHealth, username } = useApp();
  const visible = usePageVisible();
  const { mode, setMode } = useColorScheme();
  const mounted = useRef(true);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [channels, setChannels] = useState<ChannelDef[]>(CHANNELS);
  const [tasks, setTasks] = useState<AutomationTaskRecord[]>([]);
  const [voiceActiveForPulses, setVoiceActiveForPulses] = useState(false);
  const [voiceSearchWeb, setVoiceSearchWeb] = useState(false);
  const [voiceBypassChip, setVoiceBypassChip] = useState(false);
  const [voiceParticlePhase, setVoiceParticlePhase] = useState<ParticlePhase>('disabled');
  const voiceCardRef = useRef<HTMLDivElement | null>(null);

  // Track the Voice Agent card element for the particle field centering
  useEffect(() => {
    const el = document.querySelector('[data-voice-agent-card]') as HTMLDivElement | null;
    if (el) voiceCardRef.current = el;
  }, []);

  const [subagentTasks, setSubagentTasks] = useState<SubAgentTaskInfo[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const location = useLocationPermission(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Prevent space bar from scrolling the page while the dashboard is open.
  // Space is used for push-to-talk and should never scroll the dashboard.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await sessionsApi.list();
      if (!mounted.current) return;
      const recent = [...list].sort((a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
      ).slice(0, 5);
      setSessions(recent);
    } catch {
      if (!mounted.current) return;
      setSessions([]);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    const results = await Promise.allSettled([
      bridges.telegram.status(),
      bridges.discord.status(),
      bridges.slack.status(),
      bridges.email.status(),
    ]);
    if (!mounted.current) return;
    setChannels((prev) => prev.map((ch, i) => {
      const r = results[i];
      const status = r?.status === 'fulfilled' ? (r.value as BridgeStatus) : null;
      return { ...ch, status, loading: false };
    }));
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const list = await automation.tasks();
      if (!mounted.current) return;
      setTasks(list);
    } catch {
      if (!mounted.current) return;
      setTasks([]);
    }
  }, []);

  const loadSubagents = useCallback(async () => {
    try {
      const list = await subagents.list();
      if (!mounted.current) return;
      setSubagentTasks(list);
    } catch {
      if (!mounted.current) return;
      setSubagentTasks([]);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await runtime.metrics();
      if (!mounted.current) return;
      setMetrics(m);
    } catch {
      // ignore
    }
  }, []);

  // Fetch weather once location is resolved, and refresh on focus/visibility.
  useEffect(() => {
    if (!visible) return;
    const coords = location.clientSituation;
    if (!coords || coords.latitude == null || coords.longitude == null) {
      setWeather(null);
      setWeatherLoading(false);
      return;
    }
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        setWeatherLoading(true);
        const w = await runtime.weather(coords.latitude!, coords.longitude!);
        if (!cancelled) setWeather(w);
      } catch {
        if (!cancelled) setWeather(null);
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };
    fetchWeather();
    const id = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible, location.clientSituation]);

  useEffect(() => {
    if (!visible) return;
    const register = async () => { try { await webuiActive.register(); } catch { /* ignore */ } };
    register();
    const id = setInterval(register, 60000);
    return () => {
      clearInterval(id);
      webuiActive.unregister().catch(() => {});
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void refreshHealth();
    const id = setInterval(() => { void refreshHealth(); }, 15000);
    return () => clearInterval(id);
  }, [visible, refreshHealth]);

  useEffect(() => {
    if (!visible || !serverOnline) return;
    const loadAll = () => {
      void loadSessions();
      void loadChannels();
      void loadTasks();
      void loadSubagents();
      void loadMetrics();
    };
    loadAll();
    const id = setInterval(loadAll, 10000);
    return () => clearInterval(id);
  }, [visible, serverOnline, loadSessions, loadChannels, loadTasks, loadSubagents, loadMetrics]);

  const openSession = useCallback((id: string) => {
    navigate(`/console/chat/${id}`);
  }, [navigate]);

  const currentMode = mode ?? 'system';
  const cycleMode = () => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(currentMode as typeof MODE_CYCLE[number]) + 1) % MODE_CYCLE.length]!;
    setMode(next);
  };
  const modeIcon = currentMode === 'light'
    ? <LightModeOutlinedIcon sx={{ fontSize: 16 }} />
    : currentMode === 'system'
      ? <ContrastIcon sx={{ fontSize: 16 }} />
      : <DarkModeOutlinedIcon sx={{ fontSize: 16 }} />;

  const activeTaskCount = tasks.filter((t) => t.status === 'active').length;
  const topTasks = tasks.slice(0, 3);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: colors.bg.primary }}>
      <Box sx={{
        flexShrink: 0,
        px: 2, py: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <img src="/logo.png" alt="Agent-X" style={{ width: 24, height: 24, objectFit: 'contain' }} />
          <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", color: colors.text.primary, letterSpacing: '1px' }}>
            AGENT-X
          </Typography>
          {healthData?.version && (
            <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim, mt: 0.25 }}>
              v{healthData.version}
            </Typography>
          )}
          <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim, letterSpacing: '2px', ml: 0.5 }}>
            DASHBOARD
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: serverOnline ? colors.accent.green : colors.accent.red }} />
            <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: serverOnline ? colors.accent.green : colors.accent.red }}>
              {serverOnline ? 'ONLINE' : 'OFFLINE'}
            </Typography>
          </Box>
          {username && (
            <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}>
              {username}
            </Typography>
          )}
          <Tooltip title={`Theme: ${currentMode}`}>
            <IconButton onClick={cycleMode} sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}>
              {modeIcon}
            </IconButton>
          </Tooltip>

        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2, position: 'relative' }}>
        {/* SVG connection pulses from Voice Agent to surrounding cards */}
        <VoiceConnectionPulses active={voiceActiveForPulses} />

        {/* Dashboard-wide particle field — centered on the Voice Agent card */}
        <VoiceParticleField
          phase={voiceParticlePhase}
          active={voiceActiveForPulses}
          centerRef={voiceCardRef}
        />

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
          gridTemplateRows: { lg: 'auto auto auto' },
          gap: 2,
          alignItems: 'stretch',
          position: 'relative',
          zIndex: 1,
        }}>
          {/* Row 1: Recent conversations (col 1) | Voice Agent (cols 2-3, rows 1-2) | Channels (col 4) */}
          <BentoCard
            title="Recent conversations"
            icon={<ChatIcon sx={{ fontSize: 18, color: colors.accent.purple }} />}
            sx={{ gridColumn: { lg: '1' }, gridRow: { lg: '1' } }}
          >
            {sessions.length === 0 ? (
              <Typography sx={{ fontSize: '0.72rem', color: colors.text.tertiary, mt: 1 }}>
                No recent conversations.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {sessions.map((s) => {
                  const isCrew = (s.contextKind ?? 'agent_x') === 'crew_private';
                  const title = s.title || `Session ${s.id.slice(0, 8)}`;
                  const isActive = s.status === 'active';
                  return (
                    <Box
                      key={s.id}
                      onClick={() => openSession(s.id)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        p: 0.75,
                        borderRadius: '6px',
                        border: `1px solid ${colors.border.subtle}`,
                        bgcolor: colors.bg.primary,
                        cursor: 'pointer',
                        transition: 'border-color 0.15s, transform 0.15s',
                        '&:hover': { borderColor: colors.border.accent, transform: 'translateY(-1px)' },
                      }}
                    >
                      <Box sx={{
                        width: 24, height: 24, borderRadius: '5px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        bgcolor: alphaColor(isCrew ? colors.accent.purple : colors.accent.blue, 0.12),
                        border: `1px solid ${alphaColor(isCrew ? colors.accent.purple : colors.accent.blue, 0.25)}`,
                      }}>
                        {isCrew ? <ForumIcon sx={{ fontSize: 13, color: colors.accent.purple }} /> : <SmartToyIcon sx={{ fontSize: 13, color: colors.accent.blue }} />}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.primary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {title}
                        </Typography>
                        <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim }}>
                          {formatDateTime(s.updatedAt || s.createdAt)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {s.turnStatus?.status === 'running' && (
                          <Box sx={{
                            px: 0.5, py: 0.1, borderRadius: '4px', fontSize: '0.45rem',
                            fontFamily: MONO, fontWeight: 700, lineHeight: 1.2,
                            bgcolor: alphaColor(colors.accent.blue, 0.15), color: colors.accent.blue,
                            border: `1px solid ${alphaColor(colors.accent.blue, 0.3)}`,
                          }}>
                            RUNNING
                          </Box>
                        )}
                        {isActive && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green }} />}
                        <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim }}>
                          {s.messageCount} msg
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </BentoCard>

          {/* Voice Agent — centered 2x2 centerpiece */}
          <BentoCard
            title="Voice Agent"
            icon={<MicIcon sx={{ fontSize: 18, color: colors.accent.blue }} />}
            action={
              <VoiceAgentHeaderControls
                searchWeb={voiceSearchWeb}
                bypassChip={voiceBypassChip}
                onSearchWebChange={setVoiceSearchWeb}
                onBypassChipChange={setVoiceBypassChip}
              />
            }
            colSpan={2}
            voiceAgentCard
            sx={{
              gridColumn: { lg: '2 / 4' },
              gridRow: { lg: '1 / 3' },
              minHeight: { lg: 320 },
              border: `1px solid ${alphaColor(colors.accent.blue, '22')}`,
              boxShadow: `0 0 24px ${alphaColor(colors.accent.blue, '08')}`,
              bgcolor: alphaColor(colors.bg.secondary, 'cc'),
            }}
          >
            <VoiceAgentCard
              onActiveChange={setVoiceActiveForPulses}
              onPhaseChange={setVoiceParticlePhase}
              searchWeb={voiceSearchWeb}
              bypassChip={voiceBypassChip}
            />
          </BentoCard>

          <BentoCard
            title="Channels"
            icon={<StorageIcon sx={{ fontSize: 18, color: colors.accent.cyan }} />}
            sx={{ gridColumn: { lg: '4' }, gridRow: { lg: '1' } }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.25 }}>
              {channels.map((ch) => {
                const { label, color } = channelStatusLabel(ch.status, ch.loading);
                return (
                  <Box key={ch.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {ch.icon}
                      <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.secondary }}>{ch.name}</Typography>
                    </Box>
                    {ch.loading ? (
                      <CircularProgress size={10} sx={{ color: colors.text.dim }} />
                    ) : (
                      <StatusBadge color={color} label={label} />
                    )}
                  </Box>
                );
              })}
            </Box>
          </BentoCard>

          {/* Row 2: System status (col 1) | Automation (col 4) — Voice Agent continues in cols 2-3 */}
          <BentoCard
            title="System status"
            icon={<SmartToyIcon sx={{ fontSize: 18, color: colors.accent.green }} />}
            sx={{ gridColumn: { lg: '1' }, gridRow: { lg: '2' } }}
          >
            <StatRow label="Worker" value={serverOnline ? 'Online' : 'Offline'} color={serverOnline ? colors.accent.green : colors.accent.red} />
            <StatRow label="Provider" value={healthData?.config?.provider || '—'} />
            <StatRow label="Model" value={shortModel(healthData?.config?.model)} />
            <StatRow label="Uptime" value={healthData ? formatUptime(healthData.uptime) : '—'} />
            <StatRow label="Memory" value={healthData ? `${Math.round((healthData.memory?.heapUsed ?? 0) / 1024 / 1024)} MB` : '—'} />
            <StatRow label="Sessions" value={healthData?.sessionCount ?? 0} />
            <StatRow label="Sub-agents" value={healthData?.agentHealth?.activeSubAgents ?? 0} color={healthData?.agentHealth?.activeSubAgents ? colors.accent.blue : colors.text.dim} />
          </BentoCard>

          <BentoCard
            title="Automation tasks"
            icon={<ScheduleIcon sx={{ fontSize: 18, color: colors.accent.orange }} />}
            sx={{ gridColumn: { lg: '4' }, gridRow: { lg: '2' } }}
          >
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <StatusBadge color={activeTaskCount > 0 ? colors.accent.green : colors.text.dim} label={`${activeTaskCount} active`} />
              <StatusBadge color={colors.accent.orange} label={`${tasks.filter((t) => t.status === 'paused').length} paused`} />
              <StatusBadge color={colors.text.dim} label={`${tasks.length} total`} />
            </Box>
            {topTasks.length === 0 ? (
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mt: 1 }}>
                No automation tasks running.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
                {topTasks.map((t) => (
                  <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
                      {t.title || t.displayId}
                    </Typography>
                    <StatusBadge color={taskColor(t.status)} label={t.status} />
                  </Box>
                ))}
                {tasks.length > 3 && (
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO, mt: 0.25 }}>
                    +{tasks.length - 3} more
                  </Typography>
                )}
              </Box>
            )}
          </BentoCard>

          <BentoCard
            title="Sub-agents"
            icon={<SmartToyIcon sx={{ fontSize: 18, color: colors.accent.blue }} />}
            sx={{ gridColumn: { lg: '1' }, gridRow: { lg: '3' } }}
          >
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <StatusBadge color={subagentTasks.filter((t) => t.status === 'running').length > 0 ? colors.accent.green : colors.text.dim} label={`${subagentTasks.filter((t) => t.status === 'running').length} running`} />
              <StatusBadge color={colors.accent.orange} label={`${subagentTasks.filter((t) => t.status === 'queued' || t.status === 'pending').length} queued`} />
              <StatusBadge color={colors.text.dim} label={`${subagentTasks.length} total`} />
            </Box>
            {subagentTasks.length === 0 ? (
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mt: 1 }}>
                No active sub-agents.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
                {subagentTasks.slice(0, 3).map((t) => (
                  <Box
                    key={t.id}
                    onClick={() => t.parentSessionId && openSession(t.parentSessionId)}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: t.parentSessionId ? 'pointer' : 'default' }}
                  >
                    <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>
                      {t.instruction?.slice(0, 40) || t.id.slice(0, 8)}
                    </Typography>
                    <StatusBadge color={subagentColor(t.status)} label={t.status} />
                  </Box>
                ))}
                {subagentTasks.length > 3 && (
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO, mt: 0.25 }}>
                    +{subagentTasks.length - 3} more
                  </Typography>
                )}
              </Box>
            )}
          </BentoCard>

          <BentoCard title="System metrics" icon={<SensorsIcon sx={{ fontSize: 18, color: colors.accent.green }} />} sx={{ gridColumn: { lg: '2' }, gridRow: { lg: '3' } }}>
            <StatRow label="CPU (process)" value={metrics ? `${metrics.cpu.process}%` : '—'} color={metrics && metrics.cpu.process > 80 ? colors.accent.red : colors.text.secondary} />
            <StatRow label="CPU (system)" value={metrics ? `${metrics.cpu.system}%` : '—'} />
            <StatRow label="Memory used" value={metrics ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}` : '—'} />
            <StatRow label="Memory %" value={metrics ? `${metrics.memory.percent}%` : '—'} color={metrics && metrics.memory.percent > 85 ? colors.accent.red : colors.text.secondary} />
            <StatRow label="Heap used" value={metrics ? formatBytes(metrics.memory.heapUsed) : '—'} />
            <StatRow label="Uptime" value={metrics ? formatUptime(metrics.uptime) : '—'} />
          </BentoCard>

          <BentoCard title="Time & location" icon={<AccessTimeIcon sx={{ fontSize: 18, color: colors.accent.cyan }} />} sx={{ gridColumn: { lg: '3' }, gridRow: { lg: '3' } }}>
            {(() => {
              const { time, date } = formatClientDateTime(location.timezone);
              return (
                <>
                  <StatRow label="Time" value={time} />
                  <StatRow label="Date" value={date} />
                  <StatRow label="Timezone" value={location.timezone} />
                  <StatRow
                    label="Location"
                    value={location.label || '—'}
                    loading={location.state === 'checking'}
                  />
                </>
              );
            })()}
          </BentoCard>

          <BentoCard title="Weather" icon={<CloudIcon sx={{ fontSize: 18, color: colors.accent.purple }} />} sx={{ gridColumn: { lg: '4' }, gridRow: { lg: '3' } }}>
            {weatherLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <CircularProgress size={14} sx={{ color: colors.text.dim }} />
              </Box>
            ) : weather ? (
              <>
                <StatRow label="Conditions" value={weatherDescription(weather.current.weatherCode)} />
                <StatRow label="Temperature" value={`${weather.current.temperature}°C`} color={colors.accent.orange} />
                <StatRow label="Wind" value={`${weather.current.windSpeed} km/h`} />
                <StatRow label="Updated" value={new Date(weather.current.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
              </>
            ) : (
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mt: 1 }}>
                Weather unavailable. Enable location access or wait for location detection.
              </Typography>
            )}
          </BentoCard>


        </Box>
      </Box>
    </Box>
  );
}
