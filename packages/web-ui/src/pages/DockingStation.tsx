import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import { Footer } from '../components/Footer';
import { webuiActive, agent, crewCatalog, type AgentVitals, type CatalogSeedStatusResponse } from '../api';
import type { HealthStatus } from '../api';

function buildTerminalLines(h: HealthStatus | null): Array<{ type: 'banner' | 'blank' | 'info' | 'success' | 'dim' | 'heading'; text: string }> {
  const v = h?.version || '';
  const provider = h?.config?.provider || '—';
  const model = h?.config?.model || '—';
  const user = h?.config?.user || 'Operator';

  const sessions = h?.sessionCount ?? 0;
  const telegram = h?.telegramConnected ? `Connected${h.telegramBot ? ` (@${h.telegramBot})` : ''}` : 'Not configured';
  const mem = h ? `${Math.round((h.memory?.heapUsed ?? 0) / 1024 / 1024)} MB` : '—';
  const uptime = h ? formatUptime(h.uptime) : '—';

  return [
    { type: 'banner', text: ` █████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗  ██╗` },
    { type: 'banner', text: `██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ╚██╗██╔╝` },
    { type: 'banner', text: `███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║  █████╗╚███╔╝ ` },
    { type: 'banner', text: `██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║  ╚════╝██╔██╗ ` },
    { type: 'banner', text: `██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ██╔╝ ██╗` },
    { type: 'banner', text: `╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚═╝  ╚═╝` },
    ...(v ? [{ type: 'banner' as const, text: `                                              v${v}` }] : []),
    { type: 'blank', text: '' },
    { type: 'info', text: `  Welcome back, ${user}.` },
    { type: 'blank', text: '' },
    { type: 'heading', text: '  SYSTEM' },
    { type: 'success', text: `  \u2713 Provider     ${provider}` },
    { type: 'success', text: `  \u2713 Model        ${model}` },
    { type: 'success', text: `  \u2713 Sessions     ${sessions}` },
    { type: 'success', text: `  \u2713 Memory       ${mem}` },
    { type: 'success', text: `  \u2713 Uptime       ${uptime}` },
    { type: 'success', text: `  \u2713 Telegram     ${telegram}` },
    { type: 'blank', text: '' },
    { type: 'heading', text: '  CAPABILITIES' },
    { type: 'dim', text: '  183 tools \u00B7 16 providers \u00B7 22 MCP servers' },
    { type: 'dim', text: '  6 channels \u00B7 Multi-agent mesh \u00B7 Persistent memory' },
    { type: 'dim', text: '  AES-256-GCM encrypted storage \u00B7 Self-destruct tamper protection' },
    { type: 'blank', text: '' },
    { type: 'info', text: '  Ready to launch. All systems nominal.' },
  ];
}

export function DockingStation() {
  const { serverOnline, refreshHealth, healthData } = useApp();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [visibleLines, setVisibleLines] = useState(0);
  const [lines, setLines] = useState<ReturnType<typeof buildTerminalLines>>([]);
  const [vitals, setVitals] = useState<AgentVitals | null>(null);
  const [catalogSeed, setCatalogSeed] = useState<CatalogSeedStatusResponse | null>(null);
  // Register Web-UI as active and keep it refreshed
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    
    const register = async () => {
      try {
        await webuiActive.register();
      } catch { /* ignore */ }
    };

    register();
    // Refresh every 20 seconds to keep the marker alive
    intervalId = setInterval(register, 20000);

    // Unregister on unmount
    return () => {
      clearInterval(intervalId);
      webuiActive.unregister().catch(() => {});
    };
  }, []);

  const recheckServer = useCallback(async () => {
    setChecking(true);
    await refreshHealth();
    setChecking(false);
  }, [refreshHealth]);

  useEffect(() => { recheckServer(); }, [recheckServer]);

  useEffect(() => {
    if (!serverOnline) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await crewCatalog.seedStatus();
        if (!cancelled) setCatalogSeed(status);
      } catch {
        if (!cancelled) setCatalogSeed(null);
      }
    };
    void poll();
    const interval = setInterval(() => {
      void poll();
    }, catalogSeed?.status === 'seeding' ? 400 : 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverOnline, catalogSeed?.status]);

  // Fetch agent vitals
  useEffect(() => {
    agent.vitals().then(setVitals).catch(() => {});
    const interval = setInterval(() => { agent.vitals().then(setVitals).catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Rebuild terminal lines when health data changes
  useEffect(() => {
    const built = buildTerminalLines(healthData);
    setLines(built);
    setVisibleLines(0); // restart animation
  }, [healthData]);

  const handleLaunch = useCallback(() => {
    navigate('/console/chat');
  }, [navigate]);

  // Typewriter animation
  useEffect(() => {
    if (visibleLines >= lines.length) return;
    const delay = lines[visibleLines]?.type === 'blank' ? 200
      : lines[visibleLines]?.type === 'banner' ? 60
      : lines[visibleLines]?.type === 'heading' ? 300
      : 80;
    const timeout = setTimeout(() => setVisibleLines((v) => v + 1), delay);
    return () => clearTimeout(timeout);
  }, [visibleLines, lines]);
  const version = healthData?.version || '';

  return (
    <Box sx={{
      height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', bgcolor: colors.bg.primary,
    }}>
      {/* Main content row */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* ─── Left: Terminal area ─── */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 3, overflow: 'hidden' }}>
          {/* Header with version */}
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <img src="/logo.png" alt="Agent-X" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            <Typography sx={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", color: colors.text.primary }}>
              AGENT-X
            </Typography>
            {version && (
            <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: colors.text.primary, fontWeight: 600 }}>
              v{version}
            </Typography>
            )}
            <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim, letterSpacing: '3px', ml: 1 }}>
              MISSION CONTROL
            </Typography>
          </Box>

        {/* Terminal */}
        <Box sx={{
          flex: 1, display: 'flex', flexDirection: 'column',
          border: `1px solid ${colors.border.default}`,
          borderRadius: '6px', overflow: 'hidden', minHeight: 0,
          bgcolor: colors.bg.secondary,
        }}>
          {/* Terminal bar */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
            borderBottom: `1px solid ${colors.border.default}`,
          }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.border.strong }} />
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.border.accent }} />
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.text.dim }} />
            <Typography sx={{ ml: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim }}>
              agentx — mission-control
            </Typography>
          </Box>

          {/* Terminal body */}
          <Box sx={{
            flex: 1, px: 3, py: 2.5, overflow: 'auto',
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', lineHeight: 1.8,
          }}>
            {lines.slice(0, visibleLines).map((line, i) => {
              if (line.type === 'blank') return <Box key={i} sx={{ height: '0.6rem' }} />;
              const color =
                line.type === 'banner' ? colors.accent.blue :
                line.type === 'success' ? colors.accent.green :
                line.type === 'heading' ? colors.text.primary :
                line.type === 'info' ? colors.text.secondary :
                colors.text.dim;
              const fontWeight = line.type === 'heading' ? 700 : 400;
              const letterSpacing = line.type === 'heading' ? '2px' : undefined;
              return (
                <Box key={i} sx={{ color, fontWeight, letterSpacing, whiteSpace: 'pre', ...(line.type === 'banner' && { lineHeight: 1 }) }}>
                  {line.text}
                </Box>
              );
            })}
            {visibleLines < lines.length && (
              <Box component="span" sx={{
                display: 'inline-block', width: 7, height: '1em',
                bgcolor: colors.text.primary, verticalAlign: 'text-bottom', ml: 0.5,
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
              }} />
            )}
          </Box>
        </Box>
      </Box>

      {/* ─── Right: Sidebar ─── */}
      <Box sx={{
        width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderLeft: `1px solid ${colors.border.default}`, p: 3,
        justifyContent: 'space-between',
      }}>
        {/* Status section */}
        <Box>
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim, letterSpacing: '2px', mb: 2 }}>
            SYSTEM STATUS
          </Typography>

          <StatusRow label="Worker" value={serverOnline ? 'Online' : 'Offline'} color={serverOnline ? colors.accent.green : colors.accent.red} checking={checking} />
          <StatusRow label="Engine" value={serverOnline && healthData?.agentActive ? 'Active' : serverOnline ? 'Standby' : 'Down'} color={serverOnline && healthData?.agentActive ? colors.accent.green : serverOnline ? colors.accent.orange : colors.accent.red} />
          {healthData && (
            <>
              <StatusRow label="Provider" value={healthData.config?.provider || '—'} color={colors.text.primary} />
              <StatusRow label="Model" value={shortModel(healthData.config?.model)} color={colors.text.primary} />
    
              <StatusRow label="Telegram" value={healthData.telegramConnected ? `Connected${healthData.telegramBot ? ` (@${healthData.telegramBot})` : ''}` : '—'} color={healthData.telegramConnected ? colors.accent.green : colors.text.dim} />
              <StatusRow label="Sessions" value={String(healthData.sessionCount ?? 0)} color={colors.text.primary} />
              <StatusRow label="Memory" value={`${Math.round((healthData.memory?.heapUsed ?? 0) / 1024 / 1024)} MB`} color={colors.text.primary} />
              <StatusRow label="Uptime" value={formatUptime(healthData.uptime)} color={colors.text.primary} />
            </>
          )}

          {catalogSeed && catalogSeed.expectedCount > 0 && (
            <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim, letterSpacing: '2px', mb: 1 }}>
                CREW HUB CATALOG
              </Typography>
              <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: colors.text.secondary, mb: 0.75 }}>
                {catalogSeed.status === 'ready'
                  ? `${catalogSeed.seededCount} crews indexed`
                  : catalogSeed.status === 'seeding'
                    ? `Indexing ${catalogSeed.processedInRun || catalogSeed.seededCount} / ${catalogSeed.expectedCount}`
                    : catalogSeed.status === 'error'
                      ? `Seed failed: ${catalogSeed.error ?? 'unknown error'}`
                      : `${catalogSeed.seededCount} / ${catalogSeed.expectedCount}`}
              </Typography>
              {(catalogSeed.status === 'seeding' || (catalogSeed.seededCount < catalogSeed.expectedCount && catalogSeed.status !== 'error')) && (
                <LinearProgress
                  variant="determinate"
                  value={catalogSeed.percent}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    bgcolor: colors.bg.tertiary,
                    '& .MuiLinearProgress-bar': { bgcolor: colors.accent.purple },
                  }}
                />
              )}
            </Box>
          )}
        </Box>

        {/* Launch */}
        <Box>
          {serverOnline ? (
            <Button
              fullWidth
              variant="contained"
              startIcon={<RocketLaunchIcon sx={{ fontSize: '0.85rem !important' }} />}
              onClick={handleLaunch}
              sx={{
                py: 1.3,
                bgcolor: colors.text.primary, color: colors.bg.primary,
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                fontSize: '0.7rem', letterSpacing: '2px', borderRadius: '3px',
                '&:hover': { bgcolor: '#ddd' },
              }}
            >
              LAUNCH
            </Button>
          ) : (
            <Box>
              <Typography sx={{ color: colors.accent.red, mb: 1.5, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', textAlign: 'center' }}>
                Daemon not detected
              </Typography>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<RefreshIcon sx={{ fontSize: '0.8rem !important' }} />}
                onClick={recheckServer}
                sx={{
                  borderColor: colors.border.strong, color: colors.text.secondary,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem',
                  '&:hover': { borderColor: colors.text.secondary },
                }}
              >
                Retry
              </Button>
            </Box>
          )}

        </Box>
      </Box>
      </Box>

      {/* Agent Vitals */}
      {vitals && vitals.status !== 'uninitialized' && (
        <Box sx={{
          borderTop: `1px solid ${colors.border.default}`,
          px: 3, py: 2, mx: 3, mb: 2,
          bgcolor: colors.bg.secondary, borderRadius: 1,
          border: `1px solid ${colors.border.default}`,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <VitalChip label="Age" value={`${vitals.ageDays}d`} />
            <VitalChip label="Level" value={vitals.level} color={colors.accent.blue} />
            <VitalChip label="Wisdom" value={`${Math.round(vitals.wisdomScore)}`} />
            <VitalChip label="Experiences" value={String(vitals.totalExperiences)} />
            <VitalChip label="Memories" value={String(vitals.memories.total)} />
            <VitalChip label="Mood" value={vitals.currentMood} color={
              vitals.currentMood === 'enthusiastic' || vitals.currentMood === 'confident' ? colors.accent.green :
              vitals.currentMood === 'frustrated' || vitals.currentMood === 'anxious' ? colors.accent.orange :
              colors.text.secondary
            } />
          </Box>
        </Box>
      )}

      <Footer />
    </Box>
  );
}

function StatusRow({ label, value, color, checking }: { label: string; value: string; color: string; checking?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim }}>
        {label}
      </Typography>
      {checking ? (
        <CircularProgress size={8} sx={{ color: colors.text.dim }} />
      ) : (
        <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color, fontWeight: 500 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function shortModel(model?: string): string {
  if (!model) return '—';
  // Trim long model paths like "models/gemini-flash-lite-latest"
  const parts = model.split('/');
  return parts[parts.length - 1] || model;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function VitalChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim, letterSpacing: '0.5px' }}>
        {label}
      </Typography>
      <Typography sx={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', fontWeight: 700,
        color: color || colors.text.primary,
      }}>
        {value}
      </Typography>
    </Box>
  );
}
