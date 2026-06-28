import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import CloudIcon from '@mui/icons-material/Cloud';
import { localModel } from '../../api';
import { colors } from '../../theme';
import { DownloadIndicator, type ActiveDownload } from '../DownloadIndicator';

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
  enabled: boolean;
  model: {
    id: string;
    displayName: string;
    huggingFaceId: string;
    sizeGB: number;
    downloadedAt: string | null;
  } | null;
}

const cardSx = {
  bgcolor: colors.bg.secondary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: '8px',
  p: 3,
  mb: 2,
};

const helperSx = {
  fontSize: '0.65rem',
  color: colors.text.dim,
  mt: 0.5,
  lineHeight: 1.5,
};

export function LocalModelTab() {
  const [status, setStatus] = useState<LocalModelStatus | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, catalogRes, capRes] = await Promise.all([
        localModel.status(),
        localModel.catalog(),
        localModel.capabilities(),
      ]);
      setStatus(statusRes);
      setCatalog(catalogRes);
      setCapabilities(capRes.capabilities);
      setSelectedModelId(statusRes.installed ?? catalogRes.recommended ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load local model info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
          load();
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

  const handleDelete = async () => {
    if (!status?.installed) return;
    setDeleting(true);
    try {
      await localModel.delete(status.installed);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
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
        <CircularProgress size={16} sx={{ color: colors.text.dim }} />
        <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          Loading local model info…
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={cardSx}>
        <Alert severity="error" sx={{ bgcolor: 'rgba(255,77,77,0.1)', fontSize: '0.75rem' }}>
          {error}
        </Alert>
      </Box>
    );
  }

  const isLocalEnabled = status?.enabled && status?.installed;

  return (
    <Box>
      {!isLocalEnabled && (
        <Alert
          severity="warning"
          sx={{
            mb: 2,
            bgcolor: colors.accent.orange + '12',
            border: `1px solid ${colors.accent.orange}30`,
            color: colors.text.secondary,
            fontSize: '0.7rem',
            '& .MuiAlert-icon': { color: colors.accent.orange },
          }}
        >
          No local model is enabled. Memory extraction, consolidation, and distillation will run against your primary cloud provider, which can add latency and cost. Download a local model below to keep these background tasks offline.
        </Alert>
      )}

      <Box sx={cardSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
            Current Local Model
          </Typography>
          <DownloadIndicator downloads={activeDownloads} onClear={clearDownload} />
        </Box>

        {status?.installed && status.model ? (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography sx={{ fontSize: '0.75rem', color: colors.accent.green, fontWeight: 600 }}>● Installed</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>
                {status.model.displayName} · {status.model.sizeGB} GB
              </Typography>
            </Box>
            <Typography sx={helperSx}>ID: {status.model.huggingFaceId}</Typography>
            {status.model.downloadedAt && (
              <Typography sx={helperSx}>Downloaded: {new Date(status.model.downloadedAt).toLocaleString()}</Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
                disabled={deleting}
                sx={{
                  fontSize: '0.7rem',
                  textTransform: 'none',
                  borderColor: colors.accent.red + '50',
                  color: colors.accent.red,
                  '&:hover': { borderColor: colors.accent.red, bgcolor: colors.accent.red + '10' },
                }}
              >
                {deleting ? 'Deleting…' : 'Delete Model'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CloudIcon />}
                onClick={handleSwitchToPrimary}
                disabled={switching}
                sx={{
                  fontSize: '0.7rem',
                  textTransform: 'none',
                  borderColor: colors.accent.blue + '50',
                  color: colors.accent.blue,
                  '&:hover': { borderColor: colors.accent.blue, bgcolor: colors.accent.blue + '10' },
                }}
              >
                {switching ? 'Switching…' : 'Use Primary Provider'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>
            No local model is currently installed. Select a model below to download.
          </Typography>
        )}
      </Box>

      <Box sx={cardSx}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary, mb: 2 }}>
          Download a Different Model
        </Typography>

        {catalog?.catalog && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {catalog.catalog
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((model) => {
                const canRun = canRunModel(model);
                const isInstalled = status?.installed === model.id;
                const isSelected = selectedModelId === model.id;
                const activeDownload = activeDownloads.find((d) => d.modelId === model.id);
                const isRecommended = model.id === catalog.recommended;

                return (
                  <Box
                    key={model.id}
                    sx={{
                      p: 2,
                      borderRadius: '8px',
                      border: isSelected ? `1.5px solid ${colors.accent.blue}` : `1px solid ${colors.border.default}`,
                      bgcolor: isSelected ? colors.accent.blue + '08' : colors.bg.secondary,
                      opacity: canRun ? 1 : 0.55,
                      cursor: canRun ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s ease',
                      '&:hover': canRun ? { borderColor: colors.accent.blue } : {},
                    }}
                    onClick={() => canRun && setSelectedModelId(model.id)}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.text.primary, minWidth: 24 }}>
                          #{model.rank}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: colors.text.primary }}>
                          {model.displayName}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                        {isInstalled && (
                          <Typography sx={{ fontSize: '0.55rem', color: colors.accent.green, fontWeight: 600 }}>INSTALLED</Typography>
                        )}
                        {isRecommended && !isInstalled && (
                          <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, px: 0.6, py: 0.2, bgcolor: colors.accent.blue, color: '#000', borderRadius: '3px' }}>
                            RECOMMENDED
                          </Typography>
                        )}
                        <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, px: 0.6, py: 0.2, bgcolor: colors.bg.tertiary, color: colors.text.secondary, borderRadius: '3px' }}>
                          {model.bestFor}
                        </Typography>
                      </Box>
                    </Box>

                    <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, lineHeight: 1.35, mb: 1 }}>
                      {model.description}
                    </Typography>

                    <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, lineHeight: 1.4, mb: 1, fontStyle: 'italic' }}>
                      {model.recommendation}
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 1, fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mb: 1 }}>
                      <span>{model.sizeGB} GB</span>
                      <span>·</span>
                      <span>{model.ramRequirementGB} GB RAM</span>
                      <span>·</span>
                      <span>{model.minCpuCores} cores</span>
                      <span>·</span>
                      <span>{model.capabilities.speed}</span>
                      {model.capabilities.multilingual && <span>· multilingual</span>}
                    </Box>

                    {!canRun && (
                      <Typography sx={{ fontSize: '0.55rem', color: colors.accent.red, fontFamily: "'JetBrains Mono', monospace" }}>
                        Needs {model.ramRequirementGB} GB RAM / {model.minCpuCores} cores
                      </Typography>
                    )}

                    {isSelected && canRun && !isInstalled && (
                      <Box sx={{ mt: 1.5 }}>
                        {activeDownload ? (
                          <Box>
                            <Box sx={{ height: 3, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1, mb: 0.5, overflow: 'hidden' }}>
                              <Box sx={{ height: '100%', bgcolor: colors.accent.blue, width: `${activeDownload.progress}%`, transition: 'width 0.3s' }} />
                            </Box>
                            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
                              {activeDownload.status === 'complete' ? 'Complete' : `${activeDownload.progress}%`}
                            </Typography>
                          </Box>
                        ) : (
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={() => startDownload(model)}
                            sx={{
                              fontSize: '0.65rem',
                              textTransform: 'none',
                              bgcolor: colors.accent.blue,
                              color: '#000',
                              py: 0.5,
                              minHeight: 28,
                            }}
                          >
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
      </Box>
    </Box>
  );
}
