/**
 * Neural Brain settings tab.
 *
 * Always visible (regardless of system RAM). Provides:
 * - Status overview of embedding models (downloaded, size, active state)
 * - Opt-in flow for low-RAM systems (warning + confirmation, same as wizard)
 * - Download progress via EmbeddingModelDownload component
 * - Opt-out / purge flow (deletes model files + disables neural brain in config)
 */
import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
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
import { config, embeddingModels, type AgentXConfig } from '../../api';
import { useSystemCapabilities } from '../../hooks/useSystemCapabilities';
import { EmbeddingModelDownload } from '../EmbeddingModelDownload';
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

export function NeuralTab() {
  const caps = useSystemCapabilities();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [cfg, setCfg] = useState<AgentXConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'overview' | 'downloading'>('overview');
  const [optInChecked, setOptInChecked] = useState(false);
  const [optInConfirmOpen, setOptInConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const neuralBrainEnabled = cfg?.neuralBrain === true;
  const totalMemoryGB = caps?.totalMemoryGB ?? 0;
  const isLowRam = !status?.neuralBrainSupported;
  const allDownloaded = status?.allDownloaded === true;
  const totalSizeMB = status?.models.reduce((sum, m) => sum + m.sizeOnDiskMB, 0) ?? 0;

  const handleOptInConfirm = () => {
    setOptInConfirmOpen(false);
    setOptInChecked(true);
    setMode('downloading');
  };

  const handleDownloadComplete = async () => {
    // Enable neural brain in config after successful download.
    try {
      const updated = { ...cfg, neuralBrain: true } as AgentXConfig;
      await config.update(updated);
      setCfg(updated);
    } catch { /* best effort */ }
    setMode('overview');
    await load();
    setInfo('Neural brain enabled. Embedding models are ready.');
  };

  const handlePurge = async () => {
    setPurgeConfirmOpen(false);
    setPurging(true);
    setError(null);
    try {
      const result = await embeddingModels.purge();
      // Disable neural brain in config.
      const updated = { ...cfg, neuralBrain: false } as AgentXConfig;
      await config.update(updated);
      setCfg(updated);
      setInfo(`Neural brain disabled. ${result.freedMB.toFixed(1)} MB freed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to purge models');
    } finally {
      setPurging(false);
    }
  };

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

  // Download mode — render the EmbeddingModelDownload component.
  if (mode === 'downloading') {
    return (
      <Box>
        <SettingsSectionHeader
          icon={<HubIcon sx={{ fontSize: 16 }} />}
          title="Neural Core"
          subtitle="Downloading embedding models"
        />
        <EmbeddingModelDownload
          onComplete={handleDownloadComplete}
          forceEnabled={isLowRam}
        />
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            onClick={() => { setMode('overview'); setOptInChecked(false); }}
            sx={settingsBtnGhostSx}
          >
            ← Back to Neural Settings
          </Button>
        </Box>
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
          <Box sx={settingsStatusBadgeSx(neuralBrainEnabled ? 'active' : 'idle')}>
            {neuralBrainEnabled ? 'ENABLED' : 'DISABLED'}
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

      {/* Low-RAM warning — same design language as WizardNeuralStep */}
      {isLowRam && !neuralBrainEnabled && (
        <SettingsCard accent={settingsTheme.accent.amber}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <WarningAmberIcon sx={{ fontSize: 18, color: settingsTheme.accent.amber }} />
            <Typography sx={{
              ...settingsMonoSx,
              fontSize: '0.52rem',
              letterSpacing: '2px',
              color: settingsTheme.accent.amber,
              textTransform: 'uppercase',
              fontWeight: 700,
            }}>
              Performance Warning · Low-RAM System
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, lineHeight: 1.6, mb: 1.5, ...settingsMonoSx }}>
            Your system has {totalMemoryGB.toFixed(1)} GB of RAM. The neural brain requires at least 16 GB
            for stable operation. Running it on this machine may cause slow response times, high memory
            pressure, application freezes, or crashes during embedding model inference.
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
            Agent-X works fully without the neural brain. You can opt in anyway, or skip this entirely.
          </Typography>
        </SettingsCard>
      )}

      {/* Model status cards */}
      <SettingsCard title="Embedding Models">
        {status?.models.map((m) => (
          <Box
            key={m.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              py: 1,
              borderBottom: `1px solid ${settingsTheme.border.subtle}`,
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {m.downloaded ? (
                <CheckCircleIcon sx={{ fontSize: 16, color: settingsTheme.accent.signal }} />
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
            <Box sx={settingsStatusBadgeSx(m.downloaded ? 'active' : 'idle')}>
              {m.downloaded ? `${m.sizeOnDiskMB.toFixed(1)} MB` : 'NOT DOWNLOADED'}
            </Box>
          </Box>
        )) ?? (
          <Typography sx={{ ...settingsHelperSx }}>No model status available.</Typography>
        )}
        {allDownloaded && (
          <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
            Total disk usage: {totalSizeMB.toFixed(1)} MB
          </Typography>
        )}
      </SettingsCard>

      {/* Action buttons */}
      <SettingsCard title="Actions">
        {/* Opt-in / Enable: shown when neural brain is not yet enabled */}
        {!neuralBrainEnabled && (
          <Box>
            {isLowRam && !optInChecked ? (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={optInChecked}
                      onChange={(_, checked) => {
                        if (checked) setOptInConfirmOpen(true);
                        else setOptInChecked(false);
                      }}
                      size="small"
                      sx={{ color: settingsTheme.accent.amber, '&.Mui-checked': { color: settingsTheme.accent.amber } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, ...settingsMonoSx }}>
                      I understand the risks — enable neural brain on this system
                    </Typography>
                  }
                  sx={{ mb: 1.5 }}
                />
                <Button
                  disabled={!optInChecked}
                  onClick={() => setMode('downloading')}
                  sx={settingsBtnPrimarySx}
                  startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                >
                  Download Models
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setMode('downloading')}
                sx={settingsBtnPrimarySx}
                startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
              >
                {allDownloaded ? 'Enable Neural Brain' : 'Download & Enable'}
              </Button>
            )}
          </Box>
        )}

        {/* Opt-out / Purge: shown when neural brain is enabled or models are downloaded */}
        {(neuralBrainEnabled || allDownloaded) && (
          <Box sx={{ mt: neuralBrainEnabled ? 0 : 2 }}>
            <Typography sx={{ ...settingsHelperSx, mb: 1 }}>
              Disabling the neural brain will delete all downloaded embedding model files from disk
              and disable neural features. Chat, crews, and all other features remain available.
            </Typography>
            <Button
              onClick={() => setPurgeConfirmOpen(true)}
              disabled={purging}
              sx={settingsBtnDangerSx}
              startIcon={purging ? <CircularProgress size={14} /> : <DeleteIcon sx={{ fontSize: 14 }} />}
            >
              {purging ? 'Purging…' : 'Disable & Purge Models'}
            </Button>
          </Box>
        )}
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
            You can disable the neural brain later in this same Settings → Neural tab.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOptInConfirmOpen(false)} sx={settingsBtnGhostSx}>
            Cancel
          </Button>
          <Button onClick={handleOptInConfirm} sx={settingsBtnPrimarySx}>
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
            onClick={handlePurge}
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
