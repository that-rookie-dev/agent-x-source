import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import { CapabilityIcon } from './CapabilityIcon';
import { DownloadIndicator, type ActiveDownload } from './DownloadIndicator';
import { localModel } from '../api';
import { colors, alphaColor } from '../theme';

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

interface LocalModelStepProps {
  selectedModel: string | null;
  onSelectModel: (modelId: string | null) => void;
  skipLocalModel: boolean;
  onSkipChange: (skipped: boolean) => void;
  onStartDownload: (download: ActiveDownload) => void;
  onUpdateDownload: (modelId: string, updates: Partial<ActiveDownload>) => void;
  onClearDownload: (modelId: string) => void;
  onInstalledModelsChange?: (models: InstalledModel[]) => void;
  activeDownloads: ActiveDownload[];
}

interface CapabilitiesResponse {
  capabilities: SystemCapabilities;
}

interface InstalledModel {
  modelId: string;
  modelName: string;
  displayName?: string;
  downloadedAt: string;
  dtype?: string;
  isActive: boolean;
}

const baseStyles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: 700,
    marginBottom: 2,
    letterSpacing: '-0.2px',
  },
  subtitle: {
    fontSize: '0.72rem',
    color: colors.text.tertiary,
    lineHeight: 1.4,
    maxWidth: 520,
  },
  sectionTitle: {
    fontSize: '0.6rem',
    fontWeight: 700,
    fontFamily: '"JetBrains Mono", monospace',
    color: colors.text.secondary,
    letterSpacing: '0.5px',
    lineHeight: 1,
  },
  systemCard: {
    padding: '10px 0',
    borderRadius: 8,
    border: `1px solid ${colors.border.default}`,
    backgroundColor: alphaColor(colors.ink, 0.02),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemSpecSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '0 8px',
  },
  systemSpecDivider: {
    width: 1,
    height: 24,
    backgroundColor: alphaColor(colors.ink, 0.1),
  },
  specLabel: {
    fontSize: '0.55rem',
    color: colors.text.tertiary,
    fontFamily: '"JetBrains Mono", monospace',
  },
  specValue: {
    fontSize: '0.75rem',
    fontWeight: 700,
    fontFamily: '"JetBrains Mono", monospace',
  },
  divider: {
    height: 1,
    backgroundColor: alphaColor(colors.ink, 0.08),
    margin: '4px 0',
  },
  modelRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  },
  skipCard: {
    padding: 8,
    borderRadius: 6,
    border: `1px solid ${colors.border.default}`,
    backgroundColor: alphaColor(colors.ink, 0.02),
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: '3px',
    border: `1.5px solid ${colors.border.accent}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  skipText: {
    fontSize: '0.68rem',
    fontWeight: 500,
    color: colors.text.secondary,
  },
  skipSub: {
    fontSize: '0.58rem',
    color: colors.text.dim,
  },
  loadingBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '24px 0',
  },
};

function getModelCardStyle(isSelected: boolean, canRun: boolean): React.CSSProperties {
  return {
    padding: 10,
    borderRadius: 8,
    cursor: canRun ? 'pointer' : 'not-allowed',
    opacity: canRun ? 1 : 0.55,
    transition: 'all 0.15s ease',
    border: isSelected ? `1.5px solid ${colors.accent.blue}` : `1px solid ${colors.border.default}`,
    backgroundColor: isSelected ? alphaColor(colors.accent.blue, 0.08) : alphaColor(colors.ink, 0.02),
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
}

function getProgressFillStyle(progress: number): React.CSSProperties {
  return { height: '100%', backgroundColor: colors.accent.blue, width: `${progress}%`, transition: 'width 0.3s' };
}

function getCheckboxStyle(checked: boolean): React.CSSProperties {
  return {
    backgroundColor: checked ? colors.accent.blue : 'transparent',
  };
}

export function LocalModelStep({
  selectedModel,
  onSelectModel,
  skipLocalModel,
  onSkipChange,
  onStartDownload,
  onUpdateDownload,
  onClearDownload,
  onInstalledModelsChange,
  activeDownloads,
}: LocalModelStepProps) {
  const [systemCapabilities, setSystemCapabilities] = useState<SystemCapabilities | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogResponse | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    try {
      const res = await localModel.installed();
      setInstalledModels(res.models);
      onInstalledModelsChange?.(res.models);
    } catch {
      // Non-fatal: installed check is optional for the wizard
    }
  }, [onInstalledModelsChange]);

  useEffect(() => {
    let cancelled = false;
    localModel.capabilities().then((res: CapabilitiesResponse) => {
      if (!cancelled) setSystemCapabilities(res.capabilities);
    }).catch(() => setError('Failed to detect system capabilities.'));
    localModel.catalog().then((res: ModelCatalogResponse) => {
      if (!cancelled) {
        setModelCatalog(res);
        if (res.recommended && !selectedModel) {
          onSelectModel(res.recommended);
        }
      }
    }).catch(() => setError('Failed to load model catalog.'));
    void loadInstalled();
    return () => { cancelled = true; };
  }, []);

  const downloadModel = async (model: ModelOption) => {
    onStartDownload({
      modelId: model.id,
      displayName: model.displayName,
      sizeGB: model.sizeGB,
      progress: 0,
      status: 'downloading',
      startTime: Date.now(),
    });

    const pollInterval = setInterval(async () => {
      try {
        const status = await localModel.downloadStatus(model.id);
        onUpdateDownload(model.id, { progress: status.progress || 0 });
        if (status.status === 'complete') {
          clearInterval(pollInterval);
          onUpdateDownload(model.id, { status: 'complete', progress: 100 });
        } else if (status.status === 'error') {
          clearInterval(pollInterval);
          onUpdateDownload(model.id, { status: 'error', error: status.error || 'Download failed' });
        }
      } catch {
        clearInterval(pollInterval);
        onUpdateDownload(model.id, { status: 'error', error: 'Failed to check download status' });
      }
    }, 1000);

    try {
      await localModel.download(model.id);
      await loadInstalled();
    } catch (e) {
      clearInterval(pollInterval);
      onUpdateDownload(model.id, { status: 'error', error: e instanceof Error ? e.message : 'Download failed' });
    }
  };

  const deleteModel = async (modelId: string) => {
    setDeleting(modelId);
    try {
      await localModel.delete(modelId);
      await loadInstalled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  if (!systemCapabilities || !modelCatalog) {
    return (
      <Box style={baseStyles.loadingBox}>
        <CircularProgress size={16} />
        <Typography variant="body2" sx={{ color: colors.text.dim, fontSize: '0.75rem' }}>
          {!systemCapabilities ? 'Detecting system capabilities...' : 'Loading model catalog...'}
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2, borderRadius: 1, border: `1px solid ${alphaColor(colors.accent.red, 0.3)}`, bgcolor: alphaColor(colors.accent.red, 0.1) }}>
        <Typography sx={{ color: colors.accent.red, fontSize: '0.75rem' }}>{error}</Typography>
      </Box>
    );
  }

  return (
    <Box style={baseStyles.root}>
      <Box style={baseStyles.header}>
        <Box>
          <Typography variant="h6" style={baseStyles.title}>Local Model Setup</Typography>
          <Typography variant="body2" style={baseStyles.subtitle}>
            Download a small local model for offline memory, embeddings, and distillation. Main chat still uses your cloud provider.
          </Typography>
        </Box>
        <DownloadIndicator downloads={activeDownloads} onClear={onClearDownload} />
      </Box>

      <Typography style={baseStyles.sectionTitle}>YOUR SYSTEM</Typography>

      <Box style={baseStyles.systemCard}>
        <Box style={baseStyles.systemSpecSection}>
          <Typography style={baseStyles.specLabel}>RAM</Typography>
          <Typography style={baseStyles.specValue}>{systemCapabilities.totalMemoryGB} GB</Typography>
        </Box>
        <Box style={baseStyles.systemSpecDivider} />
        <Box style={baseStyles.systemSpecSection}>
          <Typography style={baseStyles.specLabel}>CPU</Typography>
          <Typography style={baseStyles.specValue}>{systemCapabilities.cpuCores} cores</Typography>
        </Box>
        <Box style={baseStyles.systemSpecDivider} />
        <Box style={baseStyles.systemSpecSection}>
          <Typography style={baseStyles.specLabel}>DISK</Typography>
          <Typography style={baseStyles.specValue}>{systemCapabilities.availableDiskGB} GB</Typography>
        </Box>
        <Box style={baseStyles.systemSpecDivider} />
        <Box style={baseStyles.systemSpecSection}>
          <Typography style={baseStyles.specLabel}>ARCH</Typography>
          <Typography style={baseStyles.specValue}>{systemCapabilities.cpuArchitecture}</Typography>
        </Box>
      </Box>

      <Box style={baseStyles.divider} />

      <Typography style={baseStyles.sectionTitle}>SELECT MODEL</Typography>

      <Box style={baseStyles.modelRow}>
            {modelCatalog.catalog.map(model => {
              const canRun = (
                (model.tier === 'basic' && systemCapabilities.canRunBasic) ||
                (model.tier === 'standard' && systemCapabilities.canRunStandard) ||
                (model.tier === 'advanced' && systemCapabilities.canRunAdvanced)
              );
              const isRecommended = model.id === modelCatalog.recommended;
              const isSelected = selectedModel === model.id;
              const installed = installedModels.find(m => m.modelId === model.id);
              const isInstalled = Boolean(installed);
              const activeDownload = activeDownloads.find(d => d.modelId === model.id);
              const status = activeDownload ? activeDownload.status : 'idle';
              const progress = activeDownload ? activeDownload.progress : 0;

              return (
                <Box
                  key={model.id}
                  onClick={() => {
                    if (!canRun) return;
                    onSelectModel(model.id);
                    onSkipChange(false);
                  }}
                  style={getModelCardStyle(isSelected, canRun)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.2 }}>
                      {model.displayName}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {isInstalled && (
                        <Typography sx={{
                          fontSize: '0.5rem',
                          fontWeight: 700,
                          px: 0.6,
                          py: 0.2,
                          bgcolor: colors.accent.green,
                          color: colors.bg.primary,
                          borderRadius: '3px',
                        }}>
                          INSTALLED
                        </Typography>
                      )}
                      {isRecommended && !isInstalled && (
                        <Typography sx={{
                          fontSize: '0.5rem',
                          fontWeight: 700,
                          px: 0.6,
                          py: 0.2,
                          bgcolor: colors.accent.blue,
                          color: colors.bg.primary,
                          borderRadius: '3px',
                        }}>
                          BEST
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                    {model.capabilities.embedding && (
                      <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.4,
                        px: 0.6, py: 0.2, bgcolor: alphaColor(colors.ink, 0.05), borderRadius: '3px',
                      }}>
                        <CapabilityIcon capability={model.capabilities.quality} size={10} />
                        <Typography sx={{ fontSize: '0.52rem', fontFamily: '"JetBrains Mono", monospace' }}>Embed</Typography>
                      </Box>
                    )}
                    {model.capabilities.generation && (
                      <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.4,
                        px: 0.6, py: 0.2, bgcolor: alphaColor(colors.ink, 0.05), borderRadius: '3px',
                      }}>
                        <CapabilityIcon capability={model.capabilities.quality} size={10} />
                        <Typography sx={{ fontSize: '0.52rem', fontFamily: '"JetBrains Mono", monospace' }}>Gen</Typography>
                      </Box>
                    )}
                    {model.capabilities.multilingual && (
                      <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.4,
                        px: 0.6, py: 0.2, bgcolor: alphaColor(colors.ink, 0.05), borderRadius: '3px',
                      }}>
                        <Typography sx={{ fontSize: '0.6rem' }}>🌍</Typography>
                        <Typography sx={{ fontSize: '0.52rem', fontFamily: '"JetBrains Mono", monospace' }}>Multi</Typography>
                      </Box>
                    )}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, fontSize: '0.58rem', color: colors.text.tertiary, fontFamily: '"JetBrains Mono", monospace' }}>
                    <span>{model.sizeGB} GB</span>
                    <span>·</span>
                    <span>{model.ramRequirementGB} GB RAM</span>
                    <span>·</span>
                    <span>{model.capabilities.speed}</span>
                  </Box>

                  <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, lineHeight: 1.35, flex: 1 }}>
                    {model.description}
                  </Typography>

                  {!canRun && (
                    <Box sx={{
                      p: 0.6, borderRadius: '3px', bgcolor: alphaColor(colors.accent.red, 0.08), border: `1px solid ${alphaColor(colors.accent.red, 0.2)}`,
                    }}>
                      <Typography sx={{ fontSize: '0.55rem', color: colors.accent.red, fontFamily: '"JetBrains Mono", monospace' }}>
                        Needs {model.ramRequirementGB}GB RAM / {model.minCpuCores} cores
                      </Typography>
                    </Box>
                  )}

                  {isSelected && canRun && (
                    <Box sx={{ mt: 'auto' }}>
                      {status === 'downloading' && (
                        <Box>
                          <Box sx={{ height: 3, bgcolor: alphaColor(colors.ink, 0.1), borderRadius: 1, mb: 0.5, overflow: 'hidden' }}>
                            <Box style={getProgressFillStyle(progress)} />
                          </Box>
                          <Typography sx={{ fontSize: '0.55rem', color: colors.text.tertiary, textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}>
                            {progress}%
                          </Typography>
                        </Box>
                      )}
                      {status === 'complete' && (
                        <Typography sx={{ fontSize: '0.62rem', color: colors.accent.green, textAlign: 'center', fontWeight: 600 }}>
                          ✓ Downloaded
                        </Typography>
                      )}
                      {status === 'error' && (
                        <Box>
                          <Typography sx={{ fontSize: '0.58rem', color: colors.accent.red, mb: 0.3, textAlign: 'center' }}>
                            Failed
                          </Typography>
                          <Button
                            size="small"
                            fullWidth
                            onClick={() => downloadModel(model)}
                            sx={{
                              fontSize: '0.55rem',
                              fontFamily: '"JetBrains Mono", monospace',
                              textTransform: 'none',
                              color: colors.accent.red,
                              border: `1px solid ${colors.accent.red}`,
                              borderRadius: '3px',
                              py: 0.3,
                              minHeight: 24,
                            }}
                          >
                            Retry
                          </Button>
                        </Box>
                      )}
                      {status === 'idle' && (
                        <>
                          {isInstalled ? (
                            <Button
                              variant="outlined"
                              size="small"
                              fullWidth
                              startIcon={<DeleteIcon />}
                              onClick={() => deleteModel(model.id)}
                              disabled={deleting === model.id}
                              sx={{
                                fontSize: '0.6rem',
                                fontFamily: '"JetBrains Mono", monospace',
                                textTransform: 'none',
                                color: colors.accent.red,
                                border: `1px solid ${colors.accent.red}`,
                                py: 0.5,
                                minHeight: 28,
                              }}
                            >
                              {deleting === model.id ? 'Deleting…' : 'Delete'}
                            </Button>
                          ) : (
                            <Button
                              variant="contained"
                              size="small"
                              fullWidth
                              onClick={() => downloadModel(model)}
                              sx={{
                                fontSize: '0.6rem',
                                fontFamily: '"JetBrains Mono", monospace',
                                textTransform: 'none',
                                bgcolor: colors.accent.blue,
                                color: colors.bg.primary,
                                py: 0.5,
                                minHeight: 28,
                              }}
                            >
                              Download
                            </Button>
                          )}
                        </>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>

      <Box
        style={baseStyles.skipCard}
        onClick={() => {
          onSelectModel(null);
          onSkipChange(true);
        }}
      >
        <Box style={{ ...baseStyles.checkbox, ...getCheckboxStyle(skipLocalModel) }}>
          {skipLocalModel && <Typography sx={{ fontSize: '0.45rem', color: colors.bg.primary, fontWeight: 900 }}>✓</Typography>}
        </Box>
        <Box>
          <Typography style={baseStyles.skipText}>Skip local model</Typography>
          <Typography style={baseStyles.skipSub}>Use cloud provider for all features</Typography>
        </Box>
      </Box>
    </Box>
  );
}
