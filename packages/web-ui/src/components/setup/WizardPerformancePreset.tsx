import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { config, type AgentXConfig, type PerformancePresetId } from '../../api';
import { wizardTheme, WIZARD_MONO } from './wizard-theme';
import { alphaColor } from '../../theme';
import {
  PERFORMANCE_PRESET_ORDER,
  PERFORMANCE_PRESET_UI,
  normalizePerformancePreset,
} from '../settings/performance-presets';
import { PerformanceMatrixMini } from '../settings/PerformanceMatrixMini';

export function WizardPerformancePreset({
  compact = false,
  onReadyChange,
}: {
  compact?: boolean;
  onReadyChange?: (ready: boolean) => void;
} = {}) {
  const [cfg, setCfg] = useState<AgentXConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = normalizePerformancePreset(cfg?.performance?.preset);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await config.get();
        if (cancelled) return;
        const preset = normalizePerformancePreset(c.performance?.preset);
        const budget = PERFORMANCE_PRESET_UI[preset].budget;
        // Ensure Balanced (or existing preset) is persisted so Complete can proceed.
        if (c.performance?.preset !== preset || c.performance?.budgetPercent !== budget) {
          const next: AgentXConfig = {
            ...c,
            performance: {
              ...(c.performance ?? {}),
              preset,
              budgetPercent: budget,
            },
          };
          await config.update(next);
          if (cancelled) return;
          setCfg(next);
        } else {
          setCfg(c);
        }
        onReadyChange?.(true);
      } catch {
        if (!cancelled) setError('Could not load performance settings');
      }
    })();
    return () => { cancelled = true; };
  }, [onReadyChange]);

  const select = async (preset: PerformancePresetId) => {
    if (!cfg || saving) return;
    setSaving(true);
    setError(null);
    const next: AgentXConfig = {
      ...cfg,
      performance: {
        ...(cfg.performance ?? {}),
        preset,
        budgetPercent: PERFORMANCE_PRESET_UI[preset].budget,
      },
    };
    try {
      await config.update(next);
      setCfg(next);
      onReadyChange?.(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save preset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
        gap: 1,
      }}>
        {PERFORMANCE_PRESET_ORDER.map((id) => {
          const p = PERFORMANCE_PRESET_UI[id];
          const active = selected === id;
          return (
            <Box
              key={id}
              component="button"
              type="button"
              disabled={saving || !cfg}
              onClick={() => { void select(id); }}
              sx={{
                all: 'unset',
                cursor: saving || !cfg ? 'default' : 'pointer',
                boxSizing: 'border-box',
                borderRadius: 1,
                p: compact ? 1 : 1.25,
                minHeight: compact ? 0 : 96,
                border: `1px solid ${active ? alphaColor(p.accent, 0.7) : wizardTheme.panelBorder}`,
                bgcolor: active ? alphaColor(p.accent, 0.12) : alphaColor(p.accent, 0.04),
                opacity: saving && !active ? 0.7 : 1,
                transition: 'border-color 160ms ease, background-color 160ms ease',
                '&:hover': cfg && !saving ? {
                  borderColor: alphaColor(p.accent, 0.55),
                  bgcolor: alphaColor(p.accent, 0.1),
                } : undefined,
              }}
            >
              {!compact && (
                <Typography sx={{
                  fontFamily: WIZARD_MONO,
                  fontSize: '0.5rem',
                  letterSpacing: '1px',
                  color: active ? p.accent : wizardTheme.textDim,
                  mb: 0.5,
                }}>
                  {p.tag}
                </Typography>
              )}
              <Typography sx={{
                fontFamily: WIZARD_MONO,
                fontSize: compact ? '0.72rem' : '0.8rem',
                fontWeight: 700,
                color: active ? p.accent : wizardTheme.text,
                mb: compact ? 0.2 : 0.35,
              }}>
                {p.label}
              </Typography>
              <Typography sx={{
                fontSize: compact ? '0.58rem' : '0.62rem',
                color: wizardTheme.textSecondary,
                lineHeight: 1.35,
              }}>
                {compact ? p.tag : p.blurb}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <PerformanceMatrixMini preset={selected} />

      {error && (
        <Typography sx={{ mt: 1, fontSize: '0.65rem', color: wizardTheme.accentErr, fontFamily: WIZARD_MONO }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
