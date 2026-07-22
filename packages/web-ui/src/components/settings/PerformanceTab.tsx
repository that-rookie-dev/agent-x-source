import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import SpeedIcon from '@mui/icons-material/Speed';
import BoltIcon from '@mui/icons-material/Bolt';
import GroupsIcon from '@mui/icons-material/Groups';
import BuildIcon from '@mui/icons-material/Build';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import type { AgentXConfig } from '../../api';
import { performance as performanceApi, type PerformanceLanesInfo, type PerformancePresetId, type PerformanceShowcaseResponse } from '../../api';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  settingsTheme,
  settingsHelperSx,
  settingsMonoSx,
  settingsOverlineSx,
  settingsScanlineSx,
  settingsStripSx,
} from '../../styles/settings-theme';
import { alphaColor } from '../../theme';
import {
  PERFORMANCE_PRESET_ORDER,
  PERFORMANCE_PRESET_UI,
} from './performance-presets';

interface PerformanceTabProps {
  cfg: AgentXConfig;
  onChange: (cfg: AgentXConfig) => void;
}

const PRESET_ORDER = PERFORMANCE_PRESET_ORDER;
const PRESET_UI = PERFORMANCE_PRESET_UI;

function normalizePresetId(raw: unknown): PerformancePresetId | undefined {
  if (raw === 'performance') return 'moderate';
  if (raw === 'max') return 'ultimate';
  if (raw === 'quiet' || raw === 'balanced' || raw === 'moderate' || raw === 'ultimate') {
    return raw;
  }
  return undefined;
}

function platformLabel(platform: string, arch: string): string {
  const p = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;
  return `${p} · ${arch}`;
}

function LaneMeter({
  label,
  value,
  max,
  accent,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  accent: string;
  hint: string;
}) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <Box sx={{
      p: 1.25,
      borderRadius: '8px',
      border: `1px solid ${alphaColor(accent, '28')}`,
      bgcolor: alphaColor(accent, '06'),
      minHeight: 88,
      display: 'flex',
      flexDirection: 'column',
      gap: 0.75,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ ...settingsOverlineSx, color: alphaColor(accent, 'cc'), letterSpacing: '1.2px' }}>
          {label}
        </Typography>
        <Typography sx={{ ...settingsMonoSx, fontSize: '1.05rem', fontWeight: 700, color: accent, lineHeight: 1 }}>
          {value}
        </Typography>
      </Box>
      <Box sx={{
        height: 4,
        borderRadius: 99,
        bgcolor: alphaColor(settingsTheme.text.dim, '18'),
        overflow: 'hidden',
      }}>
        <Box sx={{
          width: `${pct}%`,
          height: '100%',
          bgcolor: accent,
          transition: 'width 420ms cubic-bezier(0.22, 1, 0.36, 1)',
          boxShadow: `0 0 12px ${alphaColor(accent, '55')}`,
        }} />
      </Box>
      <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.text.dim, lineHeight: 1.35 }}>
        {hint}
      </Typography>
    </Box>
  );
}

function FitnessRing({ score, accent }: { score: number; accent: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <Box sx={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke={alphaColor(settingsTheme.text.dim, '22')} strokeWidth="5" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 500ms ease' }}
        />
      </svg>
      <Box sx={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.95rem', fontWeight: 700, color: accent, lineHeight: 1 }}>
          {score}
        </Typography>
        <Typography sx={{ ...settingsOverlineSx, fontSize: '0.42rem', letterSpacing: '1px', color: settingsTheme.text.dim }}>
          FIT
        </Typography>
      </Box>
    </Box>
  );
}

function ScenarioCard({
  icon,
  title,
  body,
  accent,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  accent: string;
}) {
  return (
    <Box sx={{
      flex: 1,
      minWidth: 160,
      p: 1.35,
      borderRadius: '8px',
      border: `1px solid ${settingsTheme.border.default}`,
      bgcolor: settingsTheme.bg.inset,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <Box sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        bgcolor: accent, opacity: 0.85,
      }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, color: accent }}>
        {icon}
        <Typography sx={{ ...settingsOverlineSx, color: accent }}>{title}</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, lineHeight: 1.45 }}>
        {body}
      </Typography>
    </Box>
  );
}

function scenariosFor(lanes: PerformanceLanesInfo, hostCores: number, memGB: number): Array<{
  icon: ReactNode;
  title: string;
  body: string;
}> {
  const memNote = memGB < 12
    ? 'Memory is tight — prefer lighter profiles.'
    : memGB < 32
      ? 'RAM supports concurrency without local LLM downloads.'
      : 'RAM can host local models alongside wide lanes.';
  return [
    {
      icon: <GroupsIcon sx={{ fontSize: 14 }} />,
      title: 'Crew missions',
      body: `Up to ${lanes.subAgents} sub-agents run at once on this host (${hostCores} cores). Extra workers queue — never stampede.`,
    },
    {
      icon: <BuildIcon sx={{ fontSize: 14 }} />,
      title: 'Tool storms',
      body: `${lanes.toolParallel} tools in parallel · ${lanes.llmGlobal} global LLM slots · ${lanes.llmPerProvider}/provider.`,
    },
    {
      icon: <PictureAsPdfIcon sx={{ fontSize: 14 }} />,
      title: 'Local compute',
      body: `${lanes.attachmentWorkers} extract worker(s) · ONNX ${lanes.onnxIntraOpThreads}/${lanes.onnxInterOpThreads} threads · bg ${lanes.backgroundConcurrency}. ${memNote}`,
    },
  ];
}

export function PerformanceTab({ cfg, onChange }: PerformanceTabProps) {
  const perfCfg = cfg.performance ?? {};
  const selected: PerformancePresetId = normalizePresetId(perfCfg.preset)
    ?? (perfCfg.budgetPercent != null
      ? (perfCfg.budgetPercent <= 30 ? 'quiet'
        : perfCfg.budgetPercent <= 50 ? 'balanced'
          : perfCfg.budgetPercent <= 75 ? 'moderate' : 'ultimate')
      : 'balanced');
  const lazyCache = perfCfg.lazyStorageCache !== false;

  const [status, setStatus] = useState<PerformanceShowcaseResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    performanceApi.status()
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [selected, lazyCache]);

  const showcase = status?.showcase;
  const host = showcase?.host;
  const activeProjection = useMemo(
    () => showcase?.presets.find((p) => p.preset === selected) ?? null,
    [showcase, selected],
  );
  const accent = PRESET_UI[selected].accent;
  const lanes = activeProjection?.lanes;

  const selectPreset = (preset: PerformancePresetId) => {
    setRevealed(true);
    onChange({
      ...cfg,
      performance: {
        ...perfCfg,
        preset,
        budgetPercent: PRESET_UI[preset].budget,
      },
    });
  };

  const scenarioList = lanes && host
    ? scenariosFor(lanes, host.cpuCores, host.totalMemoryGB)
    : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<SpeedIcon sx={{ fontSize: 16 }} />}
        title="Performance"
        subtitle="Host benchmark · resource profiles · soft concurrency"
      />

      {/* Machine showcase strip */}
      <Box sx={{
        ...settingsStripSx,
        mb: 1.75,
        py: 1.5,
        alignItems: 'center',
        gap: 2,
        background: `linear-gradient(135deg, ${alphaColor(settingsTheme.accent.hud, '10')} 0%, ${settingsTheme.bg.panel} 48%, ${alphaColor(settingsTheme.accent.amber, '08')} 100%)`,
      }}>
        <Box sx={settingsScanlineSx} />
        {host ? (
          <>
            <FitnessRing score={host.fitnessScore} accent={accent} />
            <Box sx={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
              <Typography sx={{ ...settingsOverlineSx, color: settingsTheme.accent.hud, mb: 0.35 }}>
                This machine
              </Typography>
              <Typography sx={{
                ...settingsMonoSx,
                fontSize: '0.78rem',
                fontWeight: 700,
                color: settingsTheme.text.primary,
                letterSpacing: '0.3px',
                mb: 0.35,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {host.hostname || 'Agent-X host'}
              </Typography>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
                {platformLabel(host.platform, host.arch)} · {host.cpuCores} cores · {host.totalMemoryGB} GB
              </Typography>
            </Box>
          </>
        ) : (
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, position: 'relative', zIndex: 1 }}>
            {loadError ? 'Could not read host profile — presets still save.' : 'Probing host capabilities…'}
          </Typography>
        )}
      </Box>

      <Typography sx={{ ...settingsOverlineSx, mb: 1, letterSpacing: '2px' }}>
        Resource profile
      </Typography>

      {/* Preset switcher */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
        gap: 1,
        mb: 1.75,
      }}>
        {PRESET_ORDER.map((id) => {
          const meta = PRESET_UI[id];
          const proj = showcase?.presets.find((p) => p.preset === id);
          const active = selected === id;
          return (
            <Box
              key={id}
              component="button"
              type="button"
              onClick={() => selectPreset(id)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '10px',
                p: 1.35,
                minHeight: 108,
                boxSizing: 'border-box',
                border: `1px solid ${active ? alphaColor(meta.accent, '88') : settingsTheme.border.default}`,
                bgcolor: active ? alphaColor(meta.accent, '12') : settingsTheme.bg.inset,
                boxShadow: active
                  ? `0 0 0 1px ${alphaColor(meta.accent, '33')}, 0 12px 28px ${alphaColor(meta.accent, '14')}`
                  : 'none',
                transition: 'border-color 180ms ease, background-color 180ms ease, transform 180ms ease, box-shadow 180ms ease',
                transform: active ? 'translateY(-2px)' : 'none',
                '&:hover': {
                  borderColor: alphaColor(meta.accent, '66'),
                  bgcolor: alphaColor(meta.accent, '10'),
                },
              }}
            >
              <Box sx={settingsScanlineSx} />
              <Box sx={{ position: 'relative', zIndex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
                  <Typography sx={{
                    ...settingsOverlineSx,
                    color: active ? meta.accent : settingsTheme.text.dim,
                    letterSpacing: '1.5px',
                  }}>
                    {meta.tag}
                  </Typography>
                  {proj?.recommended && (
                    <Typography sx={{
                      ...settingsMonoSx,
                      fontSize: '0.48rem',
                      color: settingsTheme.accent.signal,
                      letterSpacing: '0.8px',
                    }}>
                      BEST FIT
                    </Typography>
                  )}
                </Box>
                <Typography sx={{
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  color: active ? meta.accent : settingsTheme.text.primary,
                  mb: 0.35,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {meta.label}
                </Typography>
                <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
                  {meta.budget}% budget
                </Typography>
                {proj && (
                  <Typography sx={{
                    mt: 0.7,
                    fontSize: '0.58rem',
                    color: settingsTheme.text.secondary,
                    lineHeight: 1.35,
                  }}>
                    {proj.lanes.effectiveCores}/{host?.cpuCores ?? '—'} cores · {proj.lanes.subAgents} crew
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Collapse in={revealed && !!lanes} timeout={360}>
        {lanes && (
          <Box sx={{
            position: 'relative',
            borderRadius: '10px',
            border: `1px solid ${alphaColor(accent, '40')}`,
            bgcolor: settingsTheme.bg.panel,
            p: { xs: 1.5, sm: 2 },
            mb: 1.5,
            overflow: 'hidden',
          }}>
            <Box sx={settingsScanlineSx} />
            <Box sx={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse at top right, ${alphaColor(accent, '14')}, transparent 55%)`,
              pointerEvents: 'none',
            }} />

            <Box sx={{ position: 'relative', zIndex: 1 }}>
              <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 1.5,
                mb: 1.75,
              }}>
                <Box>
                  <Typography sx={{ ...settingsOverlineSx, color: accent, mb: 0.4 }}>
                    Active projection · {PRESET_UI[selected].label}
                  </Typography>
                  <Typography sx={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: settingsTheme.text.primary,
                    fontFamily: "'JetBrains Mono', monospace",
                    mb: 0.5,
                  }}>
                    {lanes.effectiveCores} of {host?.cpuCores ?? '—'} cores engaged
                  </Typography>
                  <Typography sx={{ ...settingsHelperSx, maxWidth: 520 }}>
                    {activeProjection?.summary
                      ?? 'Soft concurrency lanes for this host. Caps leave room for the OS and UI.'}
                  </Typography>
                </Box>
                <Box sx={{
                  px: 1.25,
                  py: 0.85,
                  borderRadius: '8px',
                  border: `1px solid ${alphaColor(accent, '44')}`,
                  bgcolor: alphaColor(accent, '10'),
                  textAlign: 'right',
                }}>
                  <Typography sx={{ ...settingsOverlineSx, color: accent }}>Budget</Typography>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '1.35rem', fontWeight: 700, color: accent, lineHeight: 1.1 }}>
                    {PRESET_UI[selected].budget}%
                  </Typography>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.5rem', color: settingsTheme.text.dim }}>
                    HARD CEILING 80%
                  </Typography>
                </Box>
              </Box>

              {/* Core utilization bar */}
              <Box sx={{ mb: 1.75 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ ...settingsOverlineSx }}>Effective core map</Typography>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim }}>
                    {host ? `${Math.round((lanes.effectiveCores / host.cpuCores) * 100)}% of detected CPUs` : ''}
                  </Typography>
                </Box>
                <Box sx={{
                  display: 'flex',
                  gap: '3px',
                  height: 18,
                  p: '3px',
                  borderRadius: '6px',
                  bgcolor: alphaColor(settingsTheme.text.dim, '10'),
                  border: `1px solid ${settingsTheme.border.subtle}`,
                }}>
                  {Array.from({ length: Math.max(1, host?.cpuCores ?? lanes.effectiveCores) }).map((_, i) => {
                    const on = i < lanes.effectiveCores;
                    return (
                      <Box
                        key={i}
                        sx={{
                          flex: 1,
                          borderRadius: '3px',
                          bgcolor: on ? accent : alphaColor(settingsTheme.text.dim, '14'),
                          opacity: on ? 1 : 0.55,
                          transition: 'background-color 320ms ease, opacity 320ms ease',
                          boxShadow: on ? `0 0 8px ${alphaColor(accent, '40')}` : 'none',
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>

              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' },
                gap: 1,
                mb: 1.75,
              }}>
                <LaneMeter label="LLM global" value={lanes.llmGlobal} max={8} accent={accent} hint="Concurrent model calls" />
                <LaneMeter label="Per provider" value={lanes.llmPerProvider} max={4} accent={accent} hint="Same API vendor cap" />
                <LaneMeter label="Tools" value={lanes.toolParallel} max={12} accent={accent} hint="Parallel tool executions" />
                <LaneMeter label="Sub-agents" value={lanes.subAgents} max={16} accent={accent} hint="Crew / spawn slots" />
                <LaneMeter label="Background" value={lanes.backgroundConcurrency} max={6} accent={accent} hint="Ingest · embed jobs" />
                <LaneMeter
                  label="ONNX"
                  value={lanes.onnxIntraOpThreads}
                  max={4}
                  accent={accent}
                  hint={`Intra ${lanes.onnxIntraOpThreads} · Inter ${lanes.onnxInterOpThreads}`}
                />
              </Box>

              <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>How this profile performs</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                {scenarioList.map((s) => (
                  <ScenarioCard
                    key={s.title}
                    icon={s.icon}
                    title={s.title}
                    body={s.body}
                    accent={accent}
                  />
                ))}
              </Box>

              <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1.5,
                pt: 1,
                borderTop: `1px solid ${settingsTheme.border.subtle}`,
              }}>
                <FormControlLabel
                  control={(
                    <Switch
                      size="small"
                      checked={lazyCache}
                      onChange={(e) => onChange({
                        ...cfg,
                        performance: { ...perfCfg, lazyStorageCache: e.target.checked },
                      })}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': { color: accent },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: accent },
                      }}
                    />
                  )}
                  label={(
                    <Box>
                      <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                        Lazy storage cache
                      </Typography>
                      <Typography sx={{ ...settingsHelperSx, mt: 0.15 }}>
                        Faster boot on large archives — applies after restart
                      </Typography>
                    </Box>
                  )}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <BoltIcon sx={{ fontSize: 14, color: accent }} />
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim, maxWidth: 220 }}>
                    Profile saves automatically. Soft lanes retune live; ONNX / storage hydrate need app restart.
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </Collapse>

      <Typography sx={{ ...settingsHelperSx, mt: 0.25 }}>
        Works the same on macOS, Windows, and Linux — Agent-X reads CPU cores and RAM from the OS.
        This is soft concurrency (queues when full), not a hard OS CPU lock. Discrete GPUs do not change
        these lanes; they may still accelerate local ML when a provider supports them.
      </Typography>
    </Box>
  );
}

