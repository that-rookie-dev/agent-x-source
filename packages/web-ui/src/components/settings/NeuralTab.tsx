/**
 * Neural Brain settings tab.
 *
 * Always visible (regardless of system RAM). The state machine is:
 *   - neuralBrain = true  AND models present -> ENABLED -> Disable & Purge
 *   - neuralBrain = true  AND models missing -> MODELS MISSING -> Enable Neural Brain (re-download)
 *   - neuralBrain = false -> DISABLED -> Enable Neural Brain
 *
 * On <16GB systems the warning card is always shown and an opt-in checkbox
 * is required before the enable button can be used.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import HubIcon from '@mui/icons-material/Hub';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { config, embeddingModels, type AgentXConfig, type EmbeddingModelProgress } from '../../api';
import { useSystemCapabilities } from '../../hooks/useSystemCapabilities';
import { invalidateApiCache } from '../../perf/api-cache';
import { useApp } from '../../store/AppContext';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsBtnPrimarySx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsStatusBadgeSx,
} from '../../styles/settings-theme';
import { alphaColor } from '../../theme';

interface ModelStatus {
  id: string;
  displayName: string;
  huggingfaceId: string;
  approxSizeMB: number;
  downloaded: boolean;
  sizeOnDiskMB: number;
  downloadStatus: string;
  percentage: number;
}

interface StatusResponse {
  models: ModelStatus[];
  allDownloaded: boolean;
  neuralBrainSupported: boolean;
}

/** Per-model live progress during download (from SSE stream). */
interface DownloadProgress {
  percentage: number;
  downloadedMB: number;
  totalMB: number;
  status: 'not_started' | 'pending' | 'downloading' | 'complete' | 'error';
  error?: string;
}

const HAZARD_STRIPE_BG = `repeating-linear-gradient(
  -45deg,
  #111 0px,
  #111 6px,
  #f4c430 6px,
  #f4c430 12px
)`;
const LOW_RAM_YELLOW = '#f4c430';

export function NeuralTab() {
  const caps = useSystemCapabilities();
  const { setConfig: setAppConfig } = useApp();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [cfg, setCfg] = useState<AgentXConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [optInChecked, setOptInChecked] = useState(false);
  const [optInConfirmOpen, setOptInConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sseCleanupRef = useRef<(() => void) | undefined>();

  const load = useCallback(async () => {
    try {
      const [statusRes, configRes] = await Promise.all([
        embeddingModels.status(),
        config.get(),
      ]);
      setStatus(statusRes);
      setCfg(configRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load neural brain status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Clean up SSE on unmount.
  useEffect(() => () => { sseCleanupRef.current?.(); }, []);

  const neuralBrainEnabled = cfg?.neuralBrain === true;
  const totalMemoryGB = caps?.totalMemoryGB ?? 0;
  const isLowRam = !status?.neuralBrainSupported;
  const allDownloaded = status?.allDownloaded === true;
  const totalSizeMB = status?.models.reduce((sum, m) => sum + m.sizeOnDiskMB, 0) ?? 0;

  // Health state combines the config flag with the actual model files on disk.
  const isHealthy = neuralBrainEnabled && allDownloaded;
  const isEnabledButMissing = neuralBrainEnabled && !allDownloaded;

  /** Persist the neuralBrain flag and propagate it to the rest of the app. */
  const persistNeuralBrainFlag = useCallback(async (enabled: boolean) => {
    const updated = { ...cfg, neuralBrain: enabled } as AgentXConfig;
    await config.update(updated);
    setCfg(updated);
    invalidateApiCache('config');
    setAppConfig(updated);
  }, [cfg, setAppConfig]);

  /** Start download + open SSE progress stream, updating inline progress bars. */
  const startDownload = useCallback(async (force: boolean) => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    setProgress({});

    try {
      await embeddingModels.download({ force });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start download');
      setDownloading(false);
      return;
    }

    // Open SSE stream for live progress.
    sseCleanupRef.current?.();
    sseCleanupRef.current = embeddingModels.progressStream((data) => {
      if (data.type === 'progress' && data.models) {
        const next: Record<string, DownloadProgress> = {};
        for (const m of data.models as EmbeddingModelProgress[]) {
          next[m.id] = {
            percentage: m.percentage,
            downloadedMB: m.downloadedMB,
            totalMB: m.totalMB,
            status: m.status,
            error: m.error,
          };
        }
        setProgress(next);
      }
      if (data.type === 'done') {
        sseCleanupRef.current?.();
        sseCleanupRef.current = undefined;
        setDownloading(false);
        if (data.allComplete) {
          // Enable neural brain in config and refresh status.
          void (async () => {
            try {
              await persistNeuralBrainFlag(true);
            } catch { /* best effort */ }
            await load();
            setInfo('Neural brain enabled. Embedding models are ready.');
          })();
        } else if (data.hasError) {
          // Keep the page as-is so the user can read the error.
          void load();
        }
      }
    });
  }, [cfg, downloading, load, persistNeuralBrainFlag]);

  /** Enable the neural brain flag. If models are missing, download them first. */
  const handleEnable = useCallback(async () => {
    if (allDownloaded) {
      // Models already on disk — just flip the flag.
      try {
        await persistNeuralBrainFlag(true);
        setInfo('Neural brain enabled. Embedding models are ready.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to enable neural brain');
      }
    } else {
      // Need to download models. Pass force=true on low-RAM systems.
      void startDownload(isLowRam);
    }
  }, [allDownloaded, isLowRam, persistNeuralBrainFlag, startDownload]);

  const handlePurge = useCallback(async () => {
    setPurgeConfirmOpen(false);
    setPurging(true);
    setError(null);
    try {
      const result = await embeddingModels.purge();
      await persistNeuralBrainFlag(false);
      setInfo(`Neural brain disabled. ${result.freedMB.toFixed(1)} MB freed.`);
      setProgress({});
      setOptInChecked(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to purge models');
    } finally {
      setPurging(false);
    }
  }, [load, persistNeuralBrainFlag]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 6 }}>
        <CircularProgress size={16} sx={{ color: settingsTheme.text.dim }} />
        <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          ◈ SCANNING NEURAL CORE…
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <SettingsSectionHeader
        icon={<HubIcon sx={{ fontSize: 16 }} />}
        title="Neural Core"
        subtitle="Local embedding models for offline semantic search and GraphRAG"
        action={
          <Box sx={settingsStatusBadgeSx(isHealthy ? 'active' : isEnabledButMissing ? 'warn' : 'idle')}>
            {isHealthy ? 'ENABLED' : isEnabledButMissing ? 'MODELS MISSING' : 'DISABLED'}
          </Box>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: `${alphaColor(settingsTheme.accent.alert, '12')}`, fontSize: '0.72rem', ...settingsMonoSx }}>
          {error}
        </Alert>
      )}

      {info && (
        <Alert
          severity="success"
          sx={{ mb: 2, bgcolor: `${alphaColor(settingsTheme.accent.signal, '12')}`, fontSize: '0.72rem', ...settingsMonoSx }}
          onClose={() => setInfo(null)}
        >
          {info}
        </Alert>
      )}

      {/* Low-RAM warning — always shown on <16GB systems. */}
      {isLowRam && (
        <Box sx={{ borderRadius: '6px', overflow: 'hidden', mb: 2, border: '1px solid rgba(17, 17, 17, 0.85)' }}>
          <Box sx={{ height: 5, width: '100%', background: HAZARD_STRIPE_BG }} />
          <Box sx={{ px: 1.5, py: 1.1, bgcolor: LOW_RAM_YELLOW, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 18, color: '#1a1200', mt: 0.1, flexShrink: 0 }} />
            <Box>
              <Typography sx={{
                fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
                fontWeight: 800,
                fontSize: '0.62rem',
                letterSpacing: '0.02em',
                lineHeight: 1.5,
                color: '#1a1200',
              }}>
                Performance Warning · Low-RAM System
              </Typography>
              <Typography sx={{
                fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
                fontWeight: 600,
                fontSize: '0.55rem',
                letterSpacing: '0.015em',
                lineHeight: 1.5,
                color: '#1a1200',
                mt: 0.35,
                opacity: 0.9,
              }}>
                Your system has {totalMemoryGB.toFixed(1)} GB of RAM. The neural brain requires at least 16 GB
                for stable operation. Running it may cause slow response times, high memory pressure, freezes, or crashes.
                Agent-X works fully without the neural brain.
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {/* Embedding Models card with inline progress bars */}
      <SettingsCard title="Embedding Models" subtitle={isHealthy ? `${totalSizeMB.toFixed(1)} MB cached locally` : undefined}>
        {status?.models.map((m) => {
          const prog = progress[m.id];
          const isDownloading = downloading && prog?.status === 'downloading';
          const isPending = downloading && prog?.status === 'pending';
          const isError = prog?.status === 'error';
          const isComplete = m.downloaded || prog?.status === 'complete';

          return (
            <Box
              key={m.id}
              sx={{
                py: 1.25,
                borderBottom: `1px solid ${settingsTheme.border.subtle}`,
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: isDownloading || isPending ? 0.75 : 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {isComplete ? (
                    <CheckCircleIcon sx={{ fontSize: 16, color: settingsTheme.accent.signal }} />
                  ) : isError ? (
                    <WarningAmberIcon sx={{ fontSize: 16, color: settingsTheme.accent.alert }} />
                  ) : isDownloading || isPending ? (
                    <CircularProgress size={14} sx={{ color: settingsTheme.accent.hud }} />
                  ) : (
                    <HubIcon sx={{ fontSize: 16, color: settingsTheme.text.dim }} />
                  )}
                  <Box>
                    <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                      {m.displayName}
                    </Typography>
                    <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                      {m.huggingfaceId} · {m.approxSizeMB} MB
                    </Typography>
                  </Box>
                </Box>
                <Box sx={settingsStatusBadgeSx(isComplete ? 'active' : isError ? 'warn' : 'idle')}>
                  {isComplete
                    ? `${m.sizeOnDiskMB.toFixed(1)} MB`
                    : isDownloading
                      ? `${prog!.percentage}%`
                      : isPending
                        ? 'PENDING'
                        : isError
                          ? 'ERROR'
                          : 'NOT DOWNLOADED'}
                </Box>
              </Box>

              {(isDownloading || isPending) && (
                <LinearProgress
                  variant={isDownloading ? 'determinate' : 'indeterminate'}
                  value={isDownloading ? prog!.percentage : 0}
                  sx={{
                    height: 3,
                    borderRadius: 1.5,
                    bgcolor: `${alphaColor(settingsTheme.accent.hud, '15')}`,
                    '& .MuiLinearProgress-bar': {
                      bgcolor: settingsTheme.accent.hud,
                      borderRadius: 1.5,
                    },
                  }}
                />
              )}

              {isError && prog?.error && (
                <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.accent.alert, mt: 0.5, ...settingsMonoSx, wordBreak: 'break-word' }}>
                  {prog.error}
                </Typography>
              )}
            </Box>
          );
        }) ?? (
          <Typography sx={{ ...settingsHelperSx }}>No model status available.</Typography>
        )}
      </SettingsCard>

      {/* Action card — compact, single-row layout */}
      <SettingsCard title="Actions">
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
            {isHealthy ? (
              <CheckCircleIcon sx={{ fontSize: 18, color: settingsTheme.accent.signal, flexShrink: 0 }} />
            ) : isEnabledButMissing ? (
              <WarningAmberIcon sx={{ fontSize: 18, color: settingsTheme.accent.amber, flexShrink: 0 }} />
            ) : (
              <HubIcon sx={{ fontSize: 18, color: settingsTheme.text.dim, flexShrink: 0 }} />
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                {isHealthy ? 'Neural brain is active' : isEnabledButMissing ? 'Models missing — re-download required' : 'Neural brain is disabled'}
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                {isHealthy ? 'Both embedding models are cached and ready' : 'Local embedding models are required for neural features'}
              </Typography>
            </Box>
          </Box>

          {isHealthy ? (
            <Button
              onClick={() => setPurgeConfirmOpen(true)}
              disabled={purging || downloading}
              sx={settingsBtnDangerSx}
              startIcon={purging ? <CircularProgress size={14} /> : <DeleteIcon sx={{ fontSize: 14 }} />}
            >
              {purging ? 'Purging…' : 'Disable & Purge'}
            </Button>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              {isLowRam && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={optInChecked}
                      onChange={(_, checked) => setOptInChecked(checked)}
                      size="small"
                      sx={{ color: settingsTheme.accent.amber, '&.Mui-checked': { color: settingsTheme.accent.amber }, p: 0.5 }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.secondary, ...settingsMonoSx, whiteSpace: 'nowrap' }}>
                      I understand the risks
                    </Typography>
                  }
                  sx={{ m: 0, mr: 0.5, alignItems: 'center' }}
                />
              )}
              <Button
                disabled={downloading || (isLowRam && !optInChecked)}
                onClick={() => isLowRam ? setOptInConfirmOpen(true) : void handleEnable()}
                sx={settingsBtnPrimarySx}
                startIcon={downloading ? <CircularProgress size={14} /> : <DownloadIcon sx={{ fontSize: 14 }} />}
              >
                {downloading ? 'Downloading…' : 'Enable Neural Brain'}
              </Button>
            </Box>
          )}
        </Box>
      </SettingsCard>

      {/* Opt-in confirmation modal (low-RAM) */}
      <Dialog
        open={optInConfirmOpen}
        onClose={() => setOptInConfirmOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: settingsTheme.bg.panel,
            border: `1px solid ${settingsTheme.border.default}`,
            borderRadius: 1,
            maxWidth: 440,
          },
        }}
      >
        <DialogTitle sx={{
          ...settingsMonoSx,
          fontSize: '0.85rem',
          fontWeight: 700,
          color: settingsTheme.text.primary,
          pb: 1,
        }}>
          CONFIRM NEURAL BRAIN ENABLEMENT
        </DialogTitle>
        <DialogContent>
          <Box sx={{
            p: 1.5,
            mb: 2,
            border: `1px solid ${settingsTheme.border.subtle}`,
            borderLeft: `3px solid ${settingsTheme.accent.amber}`,
            borderRadius: 1,
            bgcolor: settingsTheme.bg.inset,
          }}>
            <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, lineHeight: 1.6, mb: 1, ...settingsMonoSx }}>
              You are about to enable the neural brain on a system with {totalMemoryGB.toFixed(1)} GB of RAM.
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, lineHeight: 1.6, ...settingsMonoSx }}>
              This may severely affect system performance. The application may become unresponsive,
              freeze, or crash during embedding model operations.
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, lineHeight: 1.5, ...settingsMonoSx }}>
            You can disable the neural brain later in Settings → Neural.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOptInConfirmOpen(false)} sx={settingsBtnGhostSx}>
            Cancel
          </Button>
          <Button onClick={() => { setOptInConfirmOpen(false); void handleEnable(); }} sx={settingsBtnPrimarySx}>
            Enable Neural Brain
          </Button>
        </DialogActions>
      </Dialog>

      {/* Purge confirmation modal */}
      <Dialog
        open={purgeConfirmOpen}
        onClose={() => setPurgeConfirmOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: settingsTheme.bg.panel,
            border: `1px solid ${settingsTheme.border.default}`,
            borderRadius: 1,
            maxWidth: 440,
          },
        }}
      >
        <DialogTitle sx={{
          ...settingsMonoSx,
          fontSize: '0.85rem',
          fontWeight: 700,
          color: settingsTheme.accent.alert,
          pb: 1,
        }}>
          DISABLE & PURGE NEURAL BRAIN
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, lineHeight: 1.6, mb: 1.5, ...settingsMonoSx }}>
            This will delete all downloaded embedding model files ({totalSizeMB.toFixed(1)} MB) from disk
            and disable the neural brain. Any in-progress downloads will be cancelled.
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, lineHeight: 1.5, ...settingsMonoSx }}>
            This action cannot be undone. You can re-enable the neural brain later by downloading
            the models again.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPurgeConfirmOpen(false)} sx={settingsBtnGhostSx}>
            Cancel
          </Button>
          <Button
            onClick={() => void handlePurge()}
            sx={{
              ...settingsBtnDangerSx,
              bgcolor: `${alphaColor(settingsTheme.accent.alert, '15')}`,
            }}
          >
            Disable & Purge
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
