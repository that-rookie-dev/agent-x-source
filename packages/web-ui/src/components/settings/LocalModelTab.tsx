import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import CloudIcon from '@mui/icons-material/Cloud';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { localModel } from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsBtnPrimarySx,
  settingsBtnGhostSx,
  settingsBtnSignalSx,
  settingsBtnDangerSx,
  settingsStatusBadgeSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { DownloadIndicator, type ActiveDownload } from '../DownloadIndicator';

import { colors, alphaColor } from '../../theme';
interface ModelOption {
  id: string;
  name: string;
  displayName: string;
  description: string;
  sizeGB: number;
  ramRequirementGB: number;
  minCpuCores: number;
  capabilities: {
    embedding: boolean;
    generation: boolean;
    speed: 'fast' | 'medium' | 'slow';
    quality: 'basic' | 'standard' | 'advanced';
    multilingual: boolean;
  };
  tier: 'basic' | 'standard' | 'advanced';
  huggingFaceId: string;
  embeddingDimension: number;
  contextWindow: number;
  rank: number;
  bestFor: string;
  recommendation: string;
}

interface ModelCatalogResponse {
  catalog: ModelOption[];
  compatible: string[];
  recommended: string | null;
}

interface SystemCapabilities {
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCores: number;
  cpuArchitecture: 'x64' | 'arm64' | 'unknown';
  hasGPU: boolean;
  availableDiskGB: number;
  platform: 'darwin' | 'win32' | 'linux';
  recommendedModelTier: 'basic' | 'standard' | 'advanced';
  canRunAdvanced: boolean;
  canRunStandard: boolean;
  canRunBasic: boolean;
}

interface LocalModelStatus {
  installed: string | null;
  activeModelId: string | null;
  enabled: boolean;
  model: {
    id: string;
    displayName: string;
    huggingFaceId: string;
    sizeGB: number;
    downloadedAt: string | null;
  } | null;
}

interface InstalledModel {
  modelId: string;
  modelName: string;
  displayName?: string;
  downloadedAt: string;
  dtype?: string;
  isActive: boolean;
}

export function LocalModelTab() {
  const [status, setStatus] = useState<LocalModelStatus | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localModelSupported, setLocalModelSupported] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, catalogRes, capRes, installedRes] = await Promise.all([
        localModel.status(),
        localModel.catalog(),
        localModel.capabilities(),
        localModel.installed(),
      ]);
      setStatus(statusRes);
      setCatalog(catalogRes);
      setCapabilities(capRes.capabilities);
      setLocalModelSupported(capRes.localModelSupported !== false);
      setInstalledModels(installedRes.models);
      setSelectedModelId(statusRes.activeModelId ?? statusRes.installed ?? catalogRes.recommended ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load local model info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startDownload = (model: ModelOption) => {
    const download: ActiveDownload = {
      modelId: model.id,
      displayName: model.displayName,
      sizeGB: model.sizeGB,
      progress: 0,
      status: 'downloading',
      startTime: Date.now(),
    };
    setActiveDownloads((prev) => [...prev, download]);

    const pollInterval = setInterval(async () => {
      try {
        const s = await localModel.downloadStatus(model.id);
        setActiveDownloads((prev) =>
          prev.map((d) => (d.modelId === model.id ? { ...d, progress: s.progress || 0 } : d)),
        );
        if (s.status === 'complete') {
          clearInterval(pollInterval);
          setActiveDownloads((prev) =>
            prev.map((d) => (d.modelId === model.id ? { ...d, status: 'complete', progress: 100 } : d)),
          );
          void load();
        } else if (s.status === 'error') {
          clearInterval(pollInterval);
          setActiveDownloads((prev) =>
            prev.map((d) => (d.modelId === model.id ? { ...d, status: 'error', error: s.error || 'Download failed' } : d)),
          );
        }
      } catch {
        clearInterval(pollInterval);
        setActiveDownloads((prev) =>
          prev.map((d) => (d.modelId === model.id ? { ...d, status: 'error', error: 'Failed to check status' } : d)),
        );
      }
    }, 1000);

    localModel.download(model.id).catch((e) => {
      clearInterval(pollInterval);
      setActiveDownloads((prev) =>
        prev.map((d) => (d.modelId === model.id ? { ...d, status: 'error', error: e instanceof Error ? e.message : 'Download failed' } : d)),
      );
    });
  };

  const handleDelete = async (modelId: string) => {
    setDeleting(modelId);
    try {
      await localModel.delete(modelId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const handleActivate = async (modelId: string) => {
    setSaving(true);
    try {
      await localModel.activate(modelId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate model');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchToPrimary = async () => {
    setSwitching(true);
    try {
      await localModel.switchToPrimary();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Switch failed');
    } finally {
      setSwitching(false);
    }
  };

  const clearDownload = (modelId: string) => {
    setActiveDownloads((prev) => prev.filter((d) => d.modelId !== modelId));
  };

  const canRunModel = (model: ModelOption) => {
    if (!capabilities) return false;
    return (
      (model.tier === 'basic' && capabilities.canRunBasic) ||
      (model.tier === 'standard' && capabilities.canRunStandard) ||
      (model.tier === 'advanced' && capabilities.canRunAdvanced)
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 6 }}>
        <CircularProgress size={16} sx={{ color: settingsTheme.text.dim }} />
        <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          ◈ LOADING LOCAL MATRIX…
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <SettingsCard title="Error">
        <Alert severity="error" sx={{ bgcolor: `${alphaColor(settingsTheme.accent.alert, '12')}`, fontSize: '0.75rem', ...settingsMonoSx }}>
          {error}
        </Alert>
      </SettingsCard>
    );
  }

  const activeModelId = status?.activeModelId ?? status?.installed ?? null;
  const isLocalEnabled = status?.enabled && activeModelId;

  if (!localModelSupported) {
    return (
      <SettingsCard>
        <Alert
          severity="info"
          sx={{
            bgcolor: `${alphaColor(settingsTheme.accent.hud, '12')}`,
            border: `1px solid ${alphaColor(settingsTheme.accent.hud, '30')}`,
            color: settingsTheme.text.secondary,
            fontSize: '0.7rem',
            ...settingsMonoSx,
            '& .MuiAlert-icon': { color: settingsTheme.accent.hud },
          }}
        >
          Local model unavailable — machine has less than 32 GB RAM. Primary cloud model will be used.
        </Alert>
      </SettingsCard>
    );
  }

  return (
    <Box>
      {!isLocalEnabled && (
        <Alert
          severity="warning"
          sx={{
            mb: 2,
            bgcolor: `${alphaColor(settingsTheme.accent.amber, '12')}`,
            border: `1px solid ${alphaColor(settingsTheme.accent.amber, '30')}`,
            color: settingsTheme.text.secondary,
            fontSize: '0.7rem',
            ...settingsMonoSx,
            '& .MuiAlert-icon': { color: settingsTheme.accent.amber },
          }}
        >
          No local model enabled. Background memory tasks will use your primary cloud provider.
        </Alert>
      )}

      <SettingsCard title="Active Unit" subtitle="Currently deployed local inference engine">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1, mt: -1 }}>
          <DownloadIndicator downloads={activeDownloads} onClear={clearDownload} />
        </Box>

        {activeModelId && status?.model ? (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Box sx={settingsStatusBadgeSx('active')}>ONLINE</Box>
              <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.text.secondary, ...settingsMonoSx }}>
                {status.model.displayName} · {status.model.sizeGB} GB
              </Typography>
            </Box>
            <Typography sx={settingsHelperSx}>ID: {status.model.huggingFaceId}</Typography>
            {status.model.downloadedAt && (
              <Typography sx={settingsHelperSx}>Deployed: {new Date(status.model.downloadedAt).toLocaleString()}</Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
              <Button variant="outlined" size="small" startIcon={<CloudIcon />}
                onClick={handleSwitchToPrimary} disabled={switching} sx={settingsBtnGhostSx}>
                {switching ? 'Switching…' : 'Use Primary'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
            No local unit active. Select and deploy from the arsenal below.
          </Typography>
        )}
      </SettingsCard>

      <SettingsCard title="Model Arsenal" subtitle="Available local inference units">
        {catalog?.catalog && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {catalog.catalog.slice().sort((a, b) => a.rank - b.rank).map((model) => {
              const canRun = canRunModel(model);
              const installed = installedModels.find((m) => m.modelId === model.id);
              const isInstalled = Boolean(installed);
              const isActive = activeModelId === model.id;
              const isSelected = selectedModelId === model.id;
              const activeDownload = activeDownloads.find((d) => d.modelId === model.id);
              const isRecommended = model.id === catalog.recommended;

              return (
                <Box
                  key={model.id}
                  sx={{
                    p: 1.75,
                    borderRadius: '4px',
                    border: isSelected ? `1px solid ${settingsTheme.accent.hud}` : `1px solid ${settingsTheme.border.default}`,
                    bgcolor: isSelected ? settingsTheme.bg.hud : settingsTheme.bg.inset,
                    opacity: canRun ? 1 : 0.5,
                    cursor: canRun ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s ease',
                    '&:hover': canRun ? { borderColor: settingsTheme.border.hud } : {},
                  }}
                  onClick={() => canRun && setSelectedModelId(model.id)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', fontWeight: 700, color: settingsTheme.text.dim }}>
                        #{model.rank}
                      </Typography>
                      <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', fontWeight: 700, color: settingsTheme.text.primary }}>
                        {model.displayName}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      {isActive && <Box sx={settingsStatusBadgeSx('active')}>ACTIVE</Box>}
                      {isInstalled && !isActive && <Box sx={settingsStatusBadgeSx('idle')}>READY</Box>}
                      {isRecommended && !isInstalled && (
                        <Box sx={{ ...settingsStatusBadgeSx('active'), bgcolor: `${alphaColor(settingsTheme.accent.hud, '22')}`, color: settingsTheme.accent.hud, borderColor: `${alphaColor(settingsTheme.accent.hud, '44')}` }}>
                          PICK
                        </Box>
                      )}
                    </Box>
                  </Box>

                  <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.secondary, lineHeight: 1.35, mb: 0.75 }}>
                    {model.description}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 1, ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim, mb: 0.75 }}>
                    <span>{model.sizeGB} GB</span><span>·</span>
                    <span>{model.ramRequirementGB} GB RAM</span><span>·</span>
                    <span>{model.minCpuCores} cores</span><span>·</span>
                    <span>{model.capabilities.speed}</span>
                  </Box>

                  {!canRun && (
                    <Typography sx={{ fontSize: '0.52rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
                      REQUIRES {model.ramRequirementGB} GB RAM / {model.minCpuCores} cores
                    </Typography>
                  )}

                  {isSelected && canRun && (
                    <Box sx={{ display: 'flex', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
                      {activeDownload ? (
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ height: 3, bgcolor: alphaColor(colors.ink, 0.08), borderRadius: 1, mb: 0.5, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', bgcolor: settingsTheme.accent.hud, width: `${activeDownload.progress}%`, transition: 'width 0.3s' }} />
                          </Box>
                          <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.text.dim, textAlign: 'center' }}>
                            {activeDownload.status === 'complete' ? 'Complete' : `${activeDownload.progress}%`}
                          </Typography>
                        </Box>
                      ) : isInstalled ? (
                        <>
                          <Button variant="outlined" size="small" startIcon={<DeleteIcon />}
                            onClick={() => handleDelete(model.id)} disabled={deleting === model.id}
                            sx={settingsBtnDangerSx}>
                            {deleting === model.id ? 'Purging…' : 'Purge'}
                          </Button>
                          {!isActive && (
                            <Button variant="contained" size="small"
                              startIcon={saving ? <CircularProgress size={12} sx={{ color: colors.bg.primary }} /> : <SaveIcon />}
                              onClick={() => handleActivate(model.id)} disabled={saving}
                              sx={settingsBtnSignalSx}>
                              {saving ? 'Deploying…' : 'Deploy'}
                            </Button>
                          )}
                          {isActive && (
                            <Button variant="outlined" size="small" startIcon={<CheckCircleIcon />} disabled
                              sx={{ ...settingsBtnGhostSx, borderColor: `${alphaColor(settingsTheme.accent.signal, '55')}`, color: settingsTheme.accent.signal }}>
                              Active
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button variant="contained" size="small" startIcon={<DownloadIcon />}
                          onClick={() => startDownload(model)} sx={settingsBtnPrimarySx}>
                          Download
                        </Button>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </SettingsCard>
    </Box>
  );
}
