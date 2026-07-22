import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useApp } from '../store/AppContext';
import { colors, alphaColor } from '../theme';
import { Footer } from '../components/Footer';
import { MigrationUpgrade } from '../components/MigrationUpgrade';
import { useVoiceOptional } from '../components/voice/VoiceProvider';
import { useLocationPermission } from '../hooks/useLocationPermission';
import { usePageVisible } from '../hooks/usePageVisible';
import { webuiActive, crewCatalog, crews, clientSituation as clientSituationApi, type CatalogSeedStatusResponse, type Crew } from '../api';
import type { HealthStatus } from '../api';

function computeTotalCrewCatalogCount(
  catalogSeed: CatalogSeedStatusResponse | null,
  roster: Crew[],
): number {
  const hubCount = catalogSeed
    ? (catalogSeed.status === 'ready' ? catalogSeed.seededCount : catalogSeed.expectedCount)
    : 0;
  const customCount = roster.filter((c) => !c.catalogId).length;
  return hubCount + customCount;
}

function buildTerminalLines(
  h: HealthStatus | null,
  catalogSeed: CatalogSeedStatusResponse | null,
  roster: Crew[],
  readyToLaunch: boolean,
): Array<{ type: 'banner' | 'blank' | 'info' | 'success' | 'dim' | 'heading'; text: string }> {
  const v = h?.version || '';
  const provider = h?.config?.provider || '—';
  const model = h?.config?.model || '—';
  const user = h?.config?.user || 'Operator';

  const sessions = h?.sessionCount ?? 0;
  const crewCount = computeTotalCrewCatalogCount(catalogSeed, roster);
  const crewLine = crewCount > 0 ? String(crewCount) : '—';
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
    { type: 'success', text: `  \u2713 Crew         ${crewLine}` },
    { type: 'blank', text: '' },
    { type: 'heading', text: '  CAPABILITIES' },
    { type: 'dim', text: '  218 tools \u00B7 18 providers' },
    { type: 'dim', text: '  4 channels \u00B7 Multi-agent mesh \u00B7 Persistent memory' },
    { type: 'dim', text: '  AES-256-GCM encrypted storage \u00B7 Self-destruct tamper protection' },
    { type: 'blank', text: '' },
    // Only when LAUNCH is clickable — never while still preparing.
    ...(readyToLaunch
      ? [{ type: 'info' as const, text: '  Ready to launch. All systems nominal.' }]
      : []),
  ];
}

export function DockingStation() {
  const { serverOnline, refreshHealth, healthData } = useApp();
  const voice = useVoiceOptional();
  const location = useLocationPermission(true);
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [visibleLines, setVisibleLines] = useState(0);
  const [lines, setLines] = useState<ReturnType<typeof buildTerminalLines>>([]);
  const [catalogSeed, setCatalogSeed] = useState<CatalogSeedStatusResponse | null>(null);
  const [rosterCrews, setRosterCrews] = useState<Crew[]>([]);
  const introStartedRef = useRef(false);
  const introPlayedRef = useRef(false);
  const lastSentClientSituationRef = useRef<string | null>(null);
  const pageVisible = usePageVisible();

  useEffect(() => {
    if (!pageVisible) return;
    let intervalId: ReturnType<typeof setInterval>;

    const register = async () => {
      try {
        await webuiActive.register();
      } catch { /* ignore */ }
    };

    register();
    intervalId = setInterval(register, 60000);

    return () => {
      clearInterval(intervalId);
      webuiActive.unregister().catch(() => {});
    };
  }, [pageVisible]);

  const recheckServer = useCallback(async () => {
    setChecking(true);
    await refreshHealth();
    setChecking(false);
  }, [refreshHealth]);

  useEffect(() => { recheckServer(); }, [recheckServer]);

  useEffect(() => {
    if (!serverOnline) {
      setRosterCrews([]);
      return;
    }
    let cancelled = false;
    crews.list()
      .then((list) => { if (!cancelled) setRosterCrews(list); })
      .catch(() => { if (!cancelled) setRosterCrews([]); });
    return () => { cancelled = true; };
  }, [serverOnline]);

  useEffect(() => {
    if (!serverOnline || !pageVisible) return;
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
  }, [serverOnline, catalogSeed?.status, pageVisible]);

  // Sync the app launch location/timezone to the server
  // use the same context as the desktop/web UI instead of stale or inferred location.
  useEffect(() => {
    if (!serverOnline || !location.clientSituation) return;
    const key = `${location.clientSituation.latitude ?? 'x'},${location.clientSituation.longitude ?? 'x'},${location.clientSituation.locationLabel ?? 'x'},${location.clientSituation.timezone}`;
    if (lastSentClientSituationRef.current === key) return;
    lastSentClientSituationRef.current = key;
    clientSituationApi.set(location.clientSituation).catch(() => {});
  }, [serverOnline, location.clientSituation]);

  const crewCatalogCount = computeTotalCrewCatalogCount(catalogSeed, rosterCrews);

  const voiceModuleEnabled = Boolean(voice?.voiceReady);
  const engineWarmAtLaunch = Boolean(voice?.engineWarmAtLaunch);
  const voiceNeedsReady = voiceModuleEnabled && engineWarmAtLaunch;
  const voiceLaunchReady = !voiceNeedsReady
    || voice?.warmupPhase === 'ready'
    || voice?.warmupPhase === 'failed';
  const voiceResolved = !voiceModuleEnabled || !engineWarmAtLaunch || voiceLaunchReady;
  const voiceOk = !voiceModuleEnabled || !engineWarmAtLaunch || voiceLaunchReady;
  const systemsResolved = !checking && location.resolved && voiceResolved;
  const canLaunch = serverOnline && systemsResolved && voiceOk;
  const preparing = serverOnline && !canLaunch;

  useEffect(() => {
    const built = buildTerminalLines(healthData, catalogSeed, rosterCrews, canLaunch);
    setLines(built);
    if (introPlayedRef.current) {
      setVisibleLines(built.length);
    } else if (!introStartedRef.current) {
      introStartedRef.current = true;
      setVisibleLines(0);
    }
  }, [healthData, catalogSeed, rosterCrews, canLaunch]);

  const handleLaunch = useCallback(() => {
    navigate('/console/dashboard');
  }, [navigate]);

  useEffect(() => {
    if (lines.length > 0 && visibleLines >= lines.length) {
      introPlayedRef.current = true;
    }
    if (visibleLines >= lines.length) return;
    const delay = lines[visibleLines]?.type === 'blank' ? 200
      : lines[visibleLines]?.type === 'banner' ? 60
      : lines[visibleLines]?.type === 'heading' ? 300
      : 80;
    const timeout = setTimeout(() => setVisibleLines((v) => v + 1), delay);
    return () => clearTimeout(timeout);
  }, [visibleLines, lines]);

  const locationColor =
    location.state === 'granted' ? colors.accent.green
      : location.state === 'ip_approx' ? colors.accent.blue
        : location.state === 'vpn_blocked' ? colors.accent.orange
          : location.state === 'denied' ? colors.accent.red
            : location.state === 'unavailable' ? colors.text.dim
              : colors.accent.orange;

  const voiceColor = !voice || !voiceModuleEnabled
    ? colors.text.dim
    : voice.warmupPhase === 'ready' ? colors.accent.green
      : voice.warmupPhase === 'booting' ? colors.accent.orange
        : voice.warmupPhase === 'failed' ? colors.accent.red
          : colors.text.dim;

  const voiceLabel = !voice || !voiceModuleEnabled
    ? 'Disabled'
    : engineWarmAtLaunch
      ? voice.warmupLabel
      : voice.warmupPhase === 'ready'
        ? 'Ready (on demand)'
        : 'On demand';

  return (
    <MigrationUpgrade>
    <Box sx={{
      height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', bgcolor: colors.bg.primary,
      backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -10%, ${alphaColor(colors.accent.blue, '08')}, transparent)`,
    }}>
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2, overflow: 'hidden' }}>
          <Box sx={{
            flex: 1, px: 3, py: 2.5, overflow: 'auto', minHeight: 0,
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

      <Box sx={{
        width: 248, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderLeft: `1px solid ${colors.border.default}`, p: 2,
        justifyContent: 'space-between',
      }}>
        <Box>
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim, letterSpacing: '2px', mb: 2 }}>
            SYSTEM STATUS
          </Typography>

          <StatusRow label="Worker" value={serverOnline ? 'Online' : 'Offline'} color={serverOnline ? colors.accent.green : colors.accent.red} checking={checking} />
          <StatusRow label="Engine" value={serverOnline && healthData?.agentActive ? 'Active' : serverOnline ? 'Standby' : 'Down'} color={serverOnline && healthData?.agentActive ? colors.accent.green : serverOnline ? colors.accent.orange : colors.accent.red} />
          {serverOnline && (
            <>
              <StatusRow
                label="Location"
                value={location.label}
                color={locationColor}
                checking={location.state === 'checking'}
                onClick={(location.state === 'denied' || location.state === 'vpn_blocked')
                  ? () => { void location.refresh(); }
                  : undefined}
                title={location.state === 'denied'
                  ? 'Click to request location again'
                  : location.state === 'vpn_blocked'
                    ? 'VPN/proxy detected — click to retry'
                    : undefined}
              />
              {voiceModuleEnabled && (
              <StatusRow
                label="Voice Engine"
                value={voiceLabel}
                color={voiceColor}
                checking={voiceNeedsReady && voice?.warmupPhase === 'booting'}
                onClick={voice?.warmupPhase === 'failed' ? voice.retryVoiceWarmup : undefined}
                title={voice?.warmupPhase === 'failed' ? (voice.warmupError ?? 'Click to retry voice setup') : undefined}
              />
              )}
            </>
          )}
          {healthData && (
            <>
              <StatusRow label="Provider" value={healthData.config?.provider || '—'} color={colors.text.primary} />
              <StatusRow label="Model" value={shortModel(healthData.config?.model)} color={colors.text.primary} />
              <StatusRow
                label="Crew catalog"
                value={crewCatalogCount > 0 ? String(crewCatalogCount) : '—'}
                color={crewCatalogCount > 0 ? colors.accent.green : colors.text.dim}
              />
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

        <Box>
          {serverOnline ? (
            <Button
              fullWidth
              variant="contained"
              disabled={!canLaunch}
              startIcon={preparing
                ? <CircularProgress size={14} sx={{ color: colors.text.dim }} />
                : <RocketLaunchIcon sx={{ fontSize: '0.85rem !important' }} />}
              onClick={handleLaunch}
              sx={{
                py: 1.3,
                bgcolor: canLaunch ? colors.text.primary : colors.bg.tertiary,
                color: canLaunch ? colors.bg.primary : colors.text.dim,
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                fontSize: '0.7rem', letterSpacing: '2px', borderRadius: '3px',
                '&:hover': { bgcolor: canLaunch ? alphaColor(colors.text.primary, 0.85) : colors.bg.tertiary },
                '&.Mui-disabled': {
                  bgcolor: colors.bg.tertiary,
                  color: colors.text.dim,
                },
              }}
            >
              {preparing ? 'PREPARING…' : 'LAUNCH'}
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

      <Footer />
    </Box>
    </MigrationUpgrade>
  );
}

function StatusRow({
  label,
  value,
  color,
  checking,
  onClick,
  title,
}: {
  label: string;
  value: string;
  color: string;
  checking?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: 1,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      title={title}
    >
      <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim }}>
        {label}
      </Typography>
      {checking ? (
        <CircularProgress size={8} sx={{ color: colors.text.dim }} />
      ) : (
        <Typography sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.55rem',
          color,
          fontWeight: 500,
          textAlign: 'right',
          maxWidth: '58%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function shortModel(model?: string): string {
  if (!model) return '—';
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
