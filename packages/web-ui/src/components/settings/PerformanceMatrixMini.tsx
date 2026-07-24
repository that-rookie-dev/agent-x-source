/**
 * Compact host + lane projection for the selected performance preset.
 * Used in setup wizard; mirrors the settings Performance tab matrix at a glance.
 */
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  performance as performanceApi,
  type PerformanceLanesInfo,
  type PerformancePresetId,
  type PerformanceShowcaseResponse,
} from '../../api';
import { alphaColor, colors } from '../../theme';
import { PERFORMANCE_PRESET_UI } from './performance-presets';
import { settingsMonoSx, settingsOverlineSx } from '../../styles/settings-theme';

const LANE_ROWS: Array<{ key: keyof PerformanceLanesInfo; label: string; max: number }> = [
  { key: 'llmGlobal', label: 'LLM', max: 8 },
  { key: 'toolParallel', label: 'Tools', max: 12 },
  { key: 'subAgents', label: 'Crew', max: 16 },
  { key: 'backgroundConcurrency', label: 'BG', max: 6 },
  { key: 'attachmentWorkers', label: 'Extract', max: 4 },
  { key: 'onnxIntraOpThreads', label: 'ONNX', max: 4 },
];

function MiniMeter({
  label,
  value,
  max,
  accent,
}: {
  label: string;
  value: number;
  max: number;
  accent: string;
}) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 0.5, mb: 0.3 }}>
        <Typography sx={{ ...settingsOverlineSx, fontSize: '0.42rem', color: alphaColor(accent, 0.85) }}>
          {label}
        </Typography>
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', fontWeight: 700, color: accent, lineHeight: 1 }}>
          {value}
        </Typography>
      </Box>
      <Box sx={{
        height: 3,
        borderRadius: 99,
        bgcolor: alphaColor(colors.ink, 0.08),
        overflow: 'hidden',
      }}>
        <Box sx={{
          width: `${pct}%`,
          height: '100%',
          bgcolor: accent,
          transition: 'width 360ms ease',
        }} />
      </Box>
    </Box>
  );
}

export function PerformanceMatrixMini({
  preset,
}: {
  preset: PerformancePresetId;
}) {
  const [status, setStatus] = useState<PerformanceShowcaseResponse | null>(null);
  const accent = PERFORMANCE_PRESET_UI[preset].accent;

  useEffect(() => {
    let cancelled = false;
    void performanceApi.status()
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [preset]);

  const host = status?.showcase?.host;
  const projection = useMemo(
    () => status?.showcase?.presets.find((p) => p.preset === preset) ?? null,
    [status, preset],
  );
  const lanes = projection?.lanes;

  if (!lanes) {
    return (
      <Box sx={{
        mt: 1.25,
        px: 1.25,
        py: 1,
        borderRadius: 1,
        border: `1px solid ${alphaColor(accent, 0.25)}`,
        bgcolor: alphaColor(accent, 0.04),
      }}>
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: colors.text.dim }}>
          Reading host profile…
        </Typography>
      </Box>
    );
  }

  const cores = host?.cpuCores ?? lanes.effectiveCores;
  const corePct = cores > 0 ? Math.round((lanes.effectiveCores / cores) * 100) : 0;

  return (
    <Box sx={{
      mt: 1.25,
      p: 1.25,
      borderRadius: 1,
      border: `1px solid ${alphaColor(accent, 0.35)}`,
      bgcolor: alphaColor(accent, 0.06),
      transition: 'border-color 180ms ease, background-color 180ms ease',
    }}>
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 1,
        mb: 1,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...settingsOverlineSx, fontSize: '0.42rem', color: accent, mb: 0.25 }}>
            This machine · {PERFORMANCE_PRESET_UI[preset].label}
          </Typography>
          <Typography sx={{
            ...settingsMonoSx,
            fontSize: '0.62rem',
            color: colors.text.primary,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {host
              ? `${host.cpuCores} cores · ${host.totalMemoryGB} GB · fit ${host.fitnessScore}`
              : `${lanes.effectiveCores} effective cores`}
          </Typography>
        </Box>
        <Typography sx={{
          ...settingsMonoSx,
          fontSize: '0.7rem',
          fontWeight: 700,
          color: accent,
          flexShrink: 0,
        }}>
          {PERFORMANCE_PRESET_UI[preset].budget}%
        </Typography>
      </Box>

      <Box sx={{ mb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.35 }}>
          <Typography sx={{ ...settingsOverlineSx, fontSize: '0.4rem', color: colors.text.dim }}>
            Core map
          </Typography>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: colors.text.dim }}>
            {lanes.effectiveCores}/{cores} · {corePct}%
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex',
          gap: '2px',
          height: 10,
          p: '2px',
          borderRadius: '4px',
          bgcolor: alphaColor(colors.ink, 0.06),
        }}>
          {Array.from({ length: Math.max(1, cores) }).map((_, i) => {
            const on = i < lanes.effectiveCores;
            return (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  borderRadius: '2px',
                  bgcolor: on ? accent : alphaColor(colors.ink, 0.1),
                  transition: 'background-color 280ms ease',
                }}
              />
            );
          })}
        </Box>
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 0.85,
        mb: projection?.summary ? 0.85 : 0,
      }}>
        {LANE_ROWS.map((row) => (
          <MiniMeter
            key={row.key}
            label={row.label}
            value={Number(lanes[row.key] ?? 0)}
            max={row.max}
            accent={accent}
          />
        ))}
      </Box>

      {projection?.summary && (
        <Typography sx={{
          fontSize: '0.58rem',
          color: colors.text.secondary,
          lineHeight: 1.4,
        }}>
          {projection.summary}
        </Typography>
      )}
    </Box>
  );
}
