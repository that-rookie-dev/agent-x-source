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
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ScheduleIcon from '@mui/icons-material/Schedule';
import StorageIcon from '@mui/icons-material/Storage';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import { useApp } from '../store/AppContext';
import { usePageVisible } from '../hooks/usePageVisible';
import { PanelHeader } from './PanelHeader';
import { colors, alphaColor, MONO } from '../theme';
import {
  sessions as sessionsApi,
  bridges,
  automation,
  agent,
  webuiActive,
} from '../api';
import type { SessionInfo, BridgeStatus, AutomationTaskRecord, AgentVitals } from '../api';

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

function BentoCard({ title, icon, action, children, colSpan }: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  colSpan?: number;
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
    }}>
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

export function BentoDashboard() {
  const navigate = useNavigate();
  const { healthData, serverOnline, refreshHealth, username } = useApp();
  const visible = usePageVisible();
  const { mode, setMode } = useColorScheme();
  const mounted = useRef(true);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [channels, setChannels] = useState<ChannelDef[]>(CHANNELS);
  const [tasks, setTasks] = useState<AutomationTaskRecord[]>([]);
  const [vitals, setVitals] = useState<AgentVitals | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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

  const loadVitals = useCallback(async () => {
    try {
      const v = await agent.vitals();
      if (!mounted.current) return;
      setVitals(v);
    } catch {
      // ignore
    }
  }, []);

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
      void loadVitals();
    };
    loadAll();
    const id = setInterval(loadAll, 10000);
    return () => clearInterval(id);
  }, [visible, serverOnline, loadSessions, loadChannels, loadTasks, loadVitals]);

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

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2,
          alignItems: 'stretch',
        }}>
          <BentoCard title="Quick start" icon={<RocketLaunchIcon sx={{ fontSize: 18, color: colors.accent.blue }} />}>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.tertiary, lineHeight: 1.45 }}>
              Dashboard overview for Agent-X. Use the left sidebar to open chat, crews, automation, and settings.
            </Typography>
          </BentoCard>

          <BentoCard
            title="Recent conversations"
            icon={<ChatIcon sx={{ fontSize: 18, color: colors.accent.purple }} />}
            colSpan={2}
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

          <BentoCard
            title="Channels"
            icon={<StorageIcon sx={{ fontSize: 18, color: colors.accent.cyan }} />}
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

          <BentoCard
            title="System status"
            icon={<SmartToyIcon sx={{ fontSize: 18, color: colors.accent.green }} />}
            colSpan={2}
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
            title="Background tasks"
            icon={<ScheduleIcon sx={{ fontSize: 18, color: colors.accent.orange }} />}
          >
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <StatusBadge color={activeTaskCount > 0 ? colors.accent.green : colors.text.dim} label={`${activeTaskCount} active`} />
              <StatusBadge color={colors.accent.orange} label={`${tasks.filter((t) => t.status === 'paused').length} paused`} />
              <StatusBadge color={colors.text.dim} label={`${tasks.length} total`} />
            </Box>
            {topTasks.length === 0 ? (
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mt: 1 }}>
                No background tasks running.
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

          <BentoCard title="Agent vitals" icon={<SmartToyIcon sx={{ fontSize: 18, color: colors.accent.purple }} />}>
            <StatRow label="Age" value={vitals ? `${vitals.ageDays}d` : '—'} />
            <StatRow label="Level" value={vitals?.level || '—'} color={colors.accent.purple} />
            <StatRow label="Wisdom" value={vitals ? `${Math.round(vitals.wisdomScore)}` : '—'} />
            <StatRow label="Mood" value={vitals?.currentMood || '—'} color={vitals?.currentMood === 'enthusiastic' || vitals?.currentMood === 'confident' ? colors.accent.green : colors.text.secondary} />
            <StatRow label="Memories" value={vitals?.memories.total ?? '—'} />
            <StatRow label="Experiences" value={vitals?.totalExperiences ?? '—'} />
          </BentoCard>


        </Box>
      </Box>
    </Box>
  );
}
