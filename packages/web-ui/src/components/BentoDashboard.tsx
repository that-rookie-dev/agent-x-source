import { useEffect, useRef, useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useColorScheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import MicIcon from '@mui/icons-material/Mic';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ScheduleIcon from '@mui/icons-material/Schedule';
import GroupsIcon from '@mui/icons-material/Groups';
import SpeedIcon from '@mui/icons-material/Speed';
import MemoryIcon from '@mui/icons-material/Memory';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import { useAppCore, useAppLive } from '../store/AppContext';
import { usePageVisible } from '../hooks/usePageVisible';
import { VoiceAgentCard, VoiceAgentHeaderControls } from './voice/VoiceAgentCard';
import { VoiceParticleField, type ParticlePhase } from './voice/VoiceParticleField';
import { VoiceConnectionPulses } from './voice/VoiceConnectionPulses';
import { colors, alphaColor, MONO } from '../theme';
import {
  sessions as sessionsApi,
  automation,
  webuiActive,
  subagents,
  runtime,
  performance as performanceApi,
} from '../api';
import type {
  SessionInfo,
  AutomationTaskRecord,
  SubAgentTaskInfo,
  SystemMetrics,
  PerformanceShowcaseResponse,
  PerformancePresetId,
} from '../api';

const MODE_CYCLE = ['dark', 'light', 'system'] as const;

const PRESET_LABEL: Record<PerformancePresetId, string> = {
  quiet: 'Quiet',
  balanced: 'Balanced',
  performance: 'Performance',
  max: 'Max',
};

/** Dashboard is mounted only while the panel is open — also pause when the tab is hidden. */
const METRICS_MS = 4_000;
const ACTIVITY_MS = 6_000;
const HEALTH_MS = 15_000;

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
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

function shortModel(model?: string): string {
  if (!model) return '—';
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
}

function meterColor(pct: number): string {
  if (pct >= 85) return colors.accent.red;
  if (pct >= 65) return colors.accent.orange;
  return colors.accent.cyan;
}

function Panel({
  title,
  icon,
  action,
  children,
  sx,
  voiceAgentCard,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  sx?: object;
  voiceAgentCard?: boolean;
}) {
  return (
    <Box
      data-bento-card
      {...(voiceAgentCard ? { 'data-voice-agent-card': true } : {})}
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '10px',
        border: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
        ...sx,
      }}
    >
      <Box sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1.25,
        py: 0.85,
        borderBottom: `1px solid ${colors.border.subtle}`,
        bgcolor: alphaColor(colors.bg.tertiary, '66'),
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {icon}
          <Typography sx={{
            fontSize: '0.62rem',
            fontFamily: MONO,
            fontWeight: 700,
            letterSpacing: '1.4px',
            color: colors.text.secondary,
            textTransform: 'uppercase',
          }}>
            {title}
          </Typography>
        </Box>
        {action}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, p: 1.25, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </Box>
    </Box>
  );
}

function ProgressMeter({
  label,
  value,
  max = 100,
  display,
  accent,
  hint,
}: {
  label: string;
  value: number;
  max?: number;
  display: string;
  accent: string;
  hint?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.45 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: '0.58rem', fontFamily: MONO, color: colors.text.dim, letterSpacing: '0.6px' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, fontWeight: 700, color: accent }}>
          {display}
        </Typography>
      </Box>
      <Box sx={{
        height: 6,
        borderRadius: 99,
        bgcolor: alphaColor(colors.border.strong, '55'),
        overflow: 'hidden',
        position: 'relative',
      }}>
        <Box sx={{
          height: '100%',
          width: `${pct}%`,
          borderRadius: 99,
          bgcolor: accent,
          boxShadow: `0 0 12px ${alphaColor(accent, '55')}`,
          transition: 'width 480ms cubic-bezier(0.22, 1, 0.36, 1)',
        }} />
      </Box>
      {hint && (
        <Typography sx={{ fontSize: '0.52rem', fontFamily: MONO, color: colors.text.dim }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function LiveDot({ on }: { on: boolean }) {
  return (
    <Box sx={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      bgcolor: on ? colors.accent.green : colors.accent.red,
      boxShadow: on ? `0 0 0 0 ${alphaColor(colors.accent.green, '70')}` : 'none',
      animation: on ? 'axLivePulse 1.8s ease-out infinite' : 'none',
      '@keyframes axLivePulse': {
        '0%': { boxShadow: `0 0 0 0 ${alphaColor(colors.accent.green, '55')}` },
        '70%': { boxShadow: `0 0 0 8px ${alphaColor(colors.accent.green, '00')}` },
        '100%': { boxShadow: `0 0 0 0 ${alphaColor(colors.accent.green, '00')}` },
      },
    }} />
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.65rem',
      fontFamily: MONO,
      color: colors.text.dim,
      py: 1.5,
      textAlign: 'center',
    }}>
      {children}
    </Typography>
  );
}

function ActivityRow({
  title,
  meta,
  status,
  statusColor,
  onClick,
}: {
  title: string;
  meta?: string;
  status: string;
  statusColor: string;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 0.85,
        py: 0.65,
        borderRadius: '6px',
        border: `1px solid ${colors.border.subtle}`,
        bgcolor: alphaColor(colors.bg.primary, '80'),
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 150ms ease, transform 150ms ease',
        '&:hover': onClick ? {
          borderColor: alphaColor(statusColor, '55'),
          transform: 'translateY(-1px)',
        } : undefined,
      }}
    >
      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontSize: '0.68rem',
          fontFamily: MONO,
          color: colors.text.primary,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {title}
        </Typography>
        {meta && (
          <Typography sx={{ fontSize: '0.52rem', fontFamily: MONO, color: colors.text.dim }}>
            {meta}
          </Typography>
        )}
      </Box>
      <Typography sx={{
        fontSize: '0.5rem',
        fontFamily: MONO,
        fontWeight: 700,
        letterSpacing: '0.6px',
        color: statusColor,
        textTransform: 'uppercase',
        flexShrink: 0,
      }}>
        {status}
      </Typography>
    </Box>
  );
}

export function BentoDashboard() {
  const navigate = useNavigate();
  const { username } = useAppCore();
  const { healthData, serverOnline, refreshHealth } = useAppLive();
  const visible = usePageVisible();
  const { mode, setMode } = useColorScheme();
  const mounted = useRef(true);

  const [voiceActiveForPulses, setVoiceActiveForPulses] = useState(false);
  const [voiceSearchWeb, setVoiceSearchWeb] = useState(false);
  const [voiceBypassChip, setVoiceBypassChip] = useState(false);
  const [voiceParticlePhase, setVoiceParticlePhase] = useState<ParticlePhase>('disabled');
  const voiceCardRef = useRef<HTMLDivElement | null>(null);

  const [subagentTasks, setSubagentTasks] = useState<SubAgentTaskInfo[]>([]);
  const [tasks, setTasks] = useState<AutomationTaskRecord[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionInfo[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [perf, setPerf] = useState<PerformanceShowcaseResponse | null>(null);
  const [lastTick, setLastTick] = useState<number>(Date.now());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const el = document.querySelector('[data-voice-agent-card]') as HTMLDivElement | null;
    if (el) voiceCardRef.current = el;
  });

  // Space is push-to-talk — never scroll the dashboard.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await runtime.metrics();
      if (mounted.current) setMetrics(m);
    } catch { /* ignore */ }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const [agentList, autoList, sessionList, perfStatus] = await Promise.all([
        subagents.list().catch(() => [] as SubAgentTaskInfo[]),
        automation.tasks().catch(() => [] as AutomationTaskRecord[]),
        sessionsApi.list().catch(() => [] as SessionInfo[]),
        performanceApi.status().catch(() => null),
      ]);
      if (!mounted.current) return;
      setSubagentTasks(agentList.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'pending'));
      setTasks(autoList.filter((t) => t.status === 'active' || t.status === 'paused'));
      setActiveSessions(
        [...sessionList]
          .filter((s) => s.turnStatus?.status === 'running' || s.status === 'active')
          .sort((a, b) => {
            const ar = a.turnStatus?.status === 'running' ? 1 : 0;
            const br = b.turnStatus?.status === 'running' ? 1 : 0;
            if (ar !== br) return br - ar;
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
          })
          .slice(0, 8),
      );
      if (perfStatus) setPerf(perfStatus);
      setLastTick(Date.now());
    } catch { /* ignore */ }
  }, []);

  // Presence ping — only while dashboard is visible.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const register = async () => {
      if (cancelled) return;
      try { await webuiActive.register(); } catch { /* ignore */ }
    };
    void register();
    const id = setInterval(register, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      webuiActive.unregister().catch(() => {});
    };
  }, [visible]);

  // Live metrics loop — stops the moment the tab hides or the panel unmounts.
  useEffect(() => {
    if (!visible || !serverOnline) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void loadMetrics();
    };
    tick();
    const id = setInterval(tick, METRICS_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible, serverOnline, loadMetrics]);

  // Activity + performance loop.
  useEffect(() => {
    if (!visible || !serverOnline) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void loadActivity();
    };
    tick();
    const id = setInterval(tick, ACTIVITY_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible, serverOnline, loadActivity]);

  // Health is slower — shared app store.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void refreshHealth();
    };
    tick();
    const id = setInterval(tick, HEALTH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible, refreshHealth]);

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

  const activePreset = (perf?.showcase.activePreset ?? 'balanced') as PerformancePresetId;
  const lanes = perf?.showcase.active;
  const cpuPct = metrics?.cpu.system ?? metrics?.cpu.process ?? 0;
  const memPct = metrics?.memory.percent ?? 0;
  const runningSubs = subagentTasks.filter((t) => t.status === 'running').length;
  const queuedSubs = subagentTasks.filter((t) => t.status === 'queued' || t.status === 'pending').length;
  const activeAutos = tasks.filter((t) => t.status === 'active').length;
  const pausedAutos = tasks.filter((t) => t.status === 'paused').length;
  const runningTurns = activeSessions.filter((s) => s.turnStatus?.status === 'running');
  const crewSessions = activeSessions.filter((s) => (s.contextKind ?? 'agent_x') === 'crew_private');

  const subCap = lanes?.subAgents ?? Math.max(1, runningSubs + queuedSubs);
  const toolCap = lanes?.toolParallel ?? 1;
  const llmCap = lanes?.llmGlobal ?? 1;
  const bgCap = lanes?.backgroundConcurrency ?? 1;

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      bgcolor: colors.bg.primary,
      backgroundImage: `
        radial-gradient(ellipse 80% 50% at 15% -10%, ${alphaColor(colors.accent.cyan, '12')}, transparent 55%),
        radial-gradient(ellipse 60% 40% at 90% 0%, ${alphaColor(colors.accent.blue, '10')}, transparent 50%)
      `,
    }}>
      {/* Top bar */}
      <Box sx={{
        flexShrink: 0,
        px: 2,
        py: 1.1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        borderBottom: `1px solid ${colors.border.default}`,
        bgcolor: alphaColor(colors.bg.secondary, 'cc'),
        backdropFilter: 'blur(10px)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <img src="/logo.png" alt="Agent-X" style={{ width: 22, height: 22, objectFit: 'contain' } as CSSProperties} />
          <Typography sx={{
            fontSize: '0.95rem',
            fontWeight: 700,
            fontFamily: MONO,
            color: colors.text.primary,
            letterSpacing: '1.5px',
          }}>
            LIVE
          </Typography>
          <LiveDot on={serverOnline && visible} />
          <Typography sx={{
            fontSize: '0.58rem',
            fontFamily: MONO,
            color: serverOnline ? colors.accent.green : colors.accent.red,
            letterSpacing: '1px',
          }}>
            {serverOnline ? (visible ? 'STREAMING' : 'PAUSED') : 'OFFLINE'}
          </Typography>
          <Box sx={{ width: 1, height: 14, bgcolor: colors.border.default, mx: 0.25 }} />
          <Typography sx={{ fontSize: '0.58rem', fontFamily: MONO, color: colors.text.dim }}>
            {PRESET_LABEL[activePreset]} · {shortModel(healthData?.config?.model)}
          </Typography>
          {metrics && (
            <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim, display: { xs: 'none', md: 'inline' } }}>
              up {formatUptime(metrics.uptime)}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {username && (
            <Typography sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.secondary }}>
              {username}
            </Typography>
          )}
          <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.text.dim, display: { xs: 'none', sm: 'inline' } }}>
            {new Date(lastTick).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Typography>
          <Tooltip title={`Theme: ${currentMode}`}>
            <IconButton size="small" onClick={cycleMode} sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}>
              {modeIcon}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 1.25, md: 1.5 }, position: 'relative' }}>
        {voiceActiveForPulses && (
          <>
            <VoiceConnectionPulses active />
            <VoiceParticleField phase={voiceParticlePhase} active centerRef={voiceCardRef} />
          </>
        )}

        <Box sx={{
          position: 'relative',
          zIndex: 1,
          height: { lg: '100%' },
          minHeight: { xs: 640, lg: 0 },
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.35fr) minmax(280px, 0.9fr)' },
          gridTemplateRows: { lg: 'minmax(0, 1fr) minmax(200px, 0.72fr)' },
        }}>
          {/* Voice hero */}
          <Panel
            title="Voice Agent"
            icon={<MicIcon sx={{ fontSize: 15, color: colors.accent.blue }} />}
            action={
              <VoiceAgentHeaderControls
                searchWeb={voiceSearchWeb}
                bypassChip={voiceBypassChip}
                onSearchWebChange={setVoiceSearchWeb}
                onBypassChipChange={setVoiceBypassChip}
              />
            }
            voiceAgentCard
            sx={{
              gridColumn: { lg: '1' },
              gridRow: { lg: '1 / 3' },
              border: `1px solid ${alphaColor(colors.accent.blue, '30')}`,
              boxShadow: `0 0 28px ${alphaColor(colors.accent.blue, '08')}`,
              background: `linear-gradient(165deg, ${alphaColor(colors.accent.blue, '08')} 0%, ${colors.bg.secondary} 42%)`,
            }}
          >
            <VoiceAgentCard
              onActiveChange={setVoiceActiveForPulses}
              onPhaseChange={setVoiceParticlePhase}
              searchWeb={voiceSearchWeb}
              bypassChip={voiceBypassChip}
            />
          </Panel>

          {/* System + Performance */}
          <Box sx={{
            gridColumn: { lg: '2' },
            gridRow: { lg: '1' },
            display: 'grid',
            gridTemplateRows: '1fr 1fr',
            gap: 1.25,
            minHeight: { xs: 320, lg: 0 },
          }}>
            <Panel
              title="System"
              icon={<MemoryIcon sx={{ fontSize: 15, color: colors.accent.cyan }} />}
              action={
                <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.text.dim }}>
                  {metrics ? `${metrics.cpu.process}% proc` : '—'}
                </Typography>
              }
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, justifyContent: 'center', flex: 1 }}>
                <ProgressMeter
                  label="CPU"
                  value={cpuPct}
                  display={metrics ? `${cpuPct.toFixed(0)}%` : '—'}
                  accent={meterColor(cpuPct)}
                  hint={metrics ? `process ${metrics.cpu.process}% · system ${metrics.cpu.system}%` : 'Waiting for metrics…'}
                />
                <ProgressMeter
                  label="RAM"
                  value={memPct}
                  display={metrics ? `${memPct.toFixed(0)}%` : '—'}
                  accent={meterColor(memPct)}
                  hint={metrics ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}` : undefined}
                />
                <ProgressMeter
                  label="Heap"
                  value={metrics ? (metrics.memory.heapUsed / Math.max(1, metrics.memory.heapTotal)) * 100 : 0}
                  display={metrics ? formatBytes(metrics.memory.heapUsed) : '—'}
                  accent={colors.accent.blue}
                  hint={metrics ? `of ${formatBytes(metrics.memory.heapTotal)}` : undefined}
                />
              </Box>
            </Panel>

            <Panel
              title="Performance"
              icon={<SpeedIcon sx={{ fontSize: 15, color: colors.accent.orange }} />}
              action={
                <Typography sx={{
                  fontSize: '0.5rem',
                  fontFamily: MONO,
                  fontWeight: 700,
                  color: colors.accent.orange,
                  letterSpacing: '0.8px',
                }}>
                  {PRESET_LABEL[activePreset].toUpperCase()}
                </Typography>
              }
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, justifyContent: 'center', flex: 1 }}>
                <ProgressMeter
                  label="Sub-agents"
                  value={runningSubs + queuedSubs}
                  max={subCap}
                  display={`${runningSubs + queuedSubs}/${subCap}`}
                  accent={colors.accent.blue}
                  hint={queuedSubs > 0 ? `${queuedSubs} queued` : `${lanes?.effectiveCores ?? '—'} effective cores`}
                />
                <ProgressMeter
                  label="LLM lane"
                  value={Math.min(llmCap, runningTurns.length || (healthData?.agentHealth?.activeSubAgents ?? 0))}
                  max={llmCap}
                  display={`${Math.min(llmCap, runningTurns.length)}/${llmCap}`}
                  accent={colors.accent.purple}
                  hint={`tools ${toolCap} · bg ${bgCap}`}
                />
                <ProgressMeter
                  label="Budget"
                  value={lanes?.budgetPercent ?? 40}
                  max={80}
                  display={`${lanes?.budgetPercent ?? '—'}%`}
                  accent={colors.accent.orange}
                  hint="Soft concurrency ceiling (80% hard max)"
                />
              </Box>
            </Panel>
          </Box>

          {/* Bottom activity strip */}
          <Box sx={{
            gridColumn: { lg: '2' },
            gridRow: { lg: '2' },
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap: 1.25,
            minHeight: 0,
          }}>
            <Panel
              title="Sub-agents"
              icon={<SmartToyIcon sx={{ fontSize: 15, color: colors.accent.blue }} />}
              action={
                <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: runningSubs ? colors.accent.green : colors.text.dim }}>
                  {runningSubs} run · {queuedSubs} q
                </Typography>
              }
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {subagentTasks.length === 0 ? (
                  <EmptyHint>Idle</EmptyHint>
                ) : (
                  subagentTasks.slice(0, 5).map((t) => (
                    <ActivityRow
                      key={t.id}
                      title={t.instruction?.slice(0, 48) || t.id.slice(0, 8)}
                      meta={t.background ? 'background' : t.parentSessionId?.slice(0, 8)}
                      status={t.status}
                      statusColor={
                        t.status === 'running' ? colors.accent.green
                          : t.status === 'queued' || t.status === 'pending' ? colors.accent.orange
                            : colors.text.dim
                      }
                      onClick={t.parentSessionId ? () => openSession(t.parentSessionId!) : undefined}
                    />
                  ))
                )}
              </Box>
            </Panel>

            <Panel
              title="Automations"
              icon={<ScheduleIcon sx={{ fontSize: 15, color: colors.accent.orange }} />}
              action={
                <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: activeAutos ? colors.accent.green : colors.text.dim }}>
                  {activeAutos} active · {pausedAutos} paused
                </Typography>
              }
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {tasks.length === 0 ? (
                  <EmptyHint>None scheduled</EmptyHint>
                ) : (
                  tasks.slice(0, 5).map((t) => (
                    <ActivityRow
                      key={t.id}
                      title={t.title || t.displayId}
                      meta={t.nextRunAt ? `next ${new Date(t.nextRunAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : t.scheduleType}
                      status={t.status}
                      statusColor={t.status === 'active' ? colors.accent.green : colors.accent.orange}
                      onClick={() => navigate('/console/automation')}
                    />
                  ))
                )}
              </Box>
            </Panel>

            <Panel
              title="Crew & turns"
              icon={<GroupsIcon sx={{ fontSize: 15, color: colors.accent.cyan }} />}
              action={
                <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: runningTurns.length ? colors.accent.green : colors.text.dim }}>
                  {runningTurns.length} live · {crewSessions.length} crew
                </Typography>
              }
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {activeSessions.length === 0 ? (
                  <EmptyHint>No active turns</EmptyHint>
                ) : (
                  activeSessions.slice(0, 5).map((s) => {
                    const running = s.turnStatus?.status === 'running';
                    const isCrew = (s.contextKind ?? 'agent_x') === 'crew_private';
                    return (
                      <ActivityRow
                        key={s.id}
                        title={s.title || s.hostCrewName || `Session ${s.id.slice(0, 8)}`}
                        meta={isCrew ? (s.hostCrewCallsign || 'crew') : shortModel(s.model || healthData?.config?.model)}
                        status={running ? 'running' : 'active'}
                        statusColor={running ? colors.accent.green : colors.text.dim}
                        onClick={() => openSession(s.id)}
                      />
                    );
                  })
                )}
              </Box>
            </Panel>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
