import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RadarIcon from '@mui/icons-material/Radar';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { config, providers as provApi, models as modelsApi, type AgentXConfig, type ProviderInfo, type ModelInfo, type BenchmarkRunResult } from '../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsOverlineSx,
  settingsScanlineSx,
  settingsHelperSx,
  settingsDialogPaperSx,
  settingsDialogTitleSx,
  settingsBtnPrimarySx,
  settingsBtnGhostSx,
  settingsStatusBadgeSx,
  settingsTextFieldSx,
} from '../styles/settings-theme';
import { SettingsSectionHeader } from './settings/SettingsSectionHeader';
import { ModelBenchmarkRunner, ModelBenchmarkScanner, gradeAllowsAgentX } from './settings/ModelBenchmarkRunner';

import { colors, alphaColor } from '../theme';
interface ProfileEntry {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl?: string;
}

function ProfileDossier({
  profile,
  isActive,
  isEditing,
  editLabelValue,
  editInputRef,
  selectedModel,
  switching,
  canDelete,
  deleteTooltip,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditLabelChange,
  onDelete,
  onOpenPicker,
}: {
  profile: ProfileEntry;
  isActive: boolean;
  isEditing: boolean;
  editLabelValue: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  selectedModel: string;
  switching: boolean;
  canDelete: boolean;
  deleteTooltip: string;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditLabelChange: (v: string) => void;
  onDelete: () => void;
  onOpenPicker: () => void;
}) {
  const accent = isActive ? settingsTheme.accent.signal : settingsTheme.accent.hud;

  return (
    <Box sx={{
      position: 'relative',
      borderRadius: '6px',
      bgcolor: settingsTheme.bg.inset,
      border: `1px solid ${isActive ? settingsTheme.border.signal : settingsTheme.border.default}`,
      overflow: 'hidden',
      boxShadow: isActive ? `0 0 24px ${alphaColor(settingsTheme.accent.signal, '15')}, inset 0 1px 0 ${alphaColor(settingsTheme.accent.signal, '22')}` : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:hover': { borderColor: isActive ? settingsTheme.border.signal : settingsTheme.border.hud },
    }}>
      <Box sx={settingsScanlineSx} />
      {/* Corner brackets */}
      <Box sx={{ position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderTop: `1px solid ${alphaColor(accent, '66')}`, borderLeft: `1px solid ${alphaColor(accent, '66')}`, zIndex: 2 }} />
      <Box sx={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderTop: `1px solid ${alphaColor(accent, '66')}`, borderRight: `1px solid ${alphaColor(accent, '66')}`, zIndex: 2 }} />
      <Box sx={{ position: 'absolute', bottom: 6, left: 6, width: 8, height: 8, borderBottom: `1px solid ${alphaColor(accent, '44')}`, borderLeft: `1px solid ${alphaColor(accent, '44')}`, zIndex: 2 }} />
      <Box sx={{ position: 'absolute', bottom: 6, right: 6, width: 8, height: 8, borderBottom: `1px solid ${alphaColor(accent, '44')}`, borderRight: `1px solid ${alphaColor(accent, '44')}`, zIndex: 2 }} />

      <Box sx={{ p: 2, position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.25, gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TextField
                  inputRef={editInputRef}
                  size="small"
                  value={editLabelValue}
                  onChange={(e) => onEditLabelChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }}
                  sx={{ ...settingsTextFieldSx, flex: 1 }}
                />
                <IconButton size="small" onClick={onSaveEdit} sx={{ p: 0.25, color: settingsTheme.accent.signal }}>
                  <CheckIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton size="small" onClick={onCancelEdit} sx={{ p: 0.25, color: settingsTheme.accent.alert }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                <Typography sx={{ ...settingsMonoSx, fontSize: '0.78rem', fontWeight: 700, color: settingsTheme.text.primary }}>
                  {profile.label}
                </Typography>
                {isActive && (
                  <Box sx={settingsStatusBadgeSx('active')}>ACTIVE</Box>
                )}
                <IconButton size="small" onClick={onStartEdit}
                  sx={{ color: settingsTheme.text.dim, p: 0.2, opacity: 0.5, '&:hover': { opacity: 1, color: settingsTheme.accent.hud } }}>
                  <EditIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            )}
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.52rem', color: settingsTheme.text.dim, mt: 0.4, letterSpacing: '0.5px' }}>
              Provider · {profile.providerName}
            </Typography>
          </Box>
          <Tooltip title={deleteTooltip} placement="left" arrow>
            <span>
              <IconButton size="small" onClick={() => canDelete && onDelete()}
                disabled={!canDelete}
                sx={{ color: settingsTheme.text.dim, p: 0.4, opacity: canDelete ? 0.7 : 0.25, '&:hover': canDelete ? { color: settingsTheme.accent.alert } : {} }}>
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{
          px: 1.25, py: 0.75, mb: 1.25, borderRadius: '4px',
          bgcolor: settingsTheme.bg.hud,
          border: `1px solid ${settingsTheme.border.subtle}`,
        }}>
          <Typography sx={{ ...settingsOverlineSx, fontSize: '0.45rem', mb: 0.3 }}>Model</Typography>
          <Typography sx={{
            ...settingsMonoSx, fontSize: '0.62rem', color: isActive ? settingsTheme.accent.signal : settingsTheme.text.secondary,
            wordBreak: 'break-all', lineHeight: 1.4,
          }}>
            {isActive
              ? (selectedModel || '—')
              : selectedModel
                ? selectedModel
                : 'None'}
          </Typography>
        </Box>

        <Button
          fullWidth size="small" variant="outlined"
          onClick={onOpenPicker}
          disabled={!isActive && switching}
          sx={{
            ...settingsBtnGhostSx,
            width: '100%',
            ...(isActive ? {} : { borderColor: `${alphaColor(settingsTheme.accent.signal, '44')}`, color: settingsTheme.accent.signal }),
          }}
        >
          {!isActive && switching ? <CircularProgress size={11} sx={{ mr: 0.75, color: settingsTheme.accent.signal }} /> : null}
          {isActive ? 'Switch Model' : 'Switch Profile'}
        </Button>
      </Box>
    </Box>
  );
}

export function ProvidersPanel() {
  const [cfg, setCfg] = useState<AgentXConfig | null>(null);
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newProfile, setNewProfile] = useState({ label: '', providerId: '', apiKey: '', baseUrl: '' });
  const [saving, setSaving] = useState(false);

  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickingProfile, setPickingProfile] = useState<ProfileEntry | null>(null);
  const [pickerModels, setPickerModels] = useState<ModelInfo[]>([]);
  const [pickerSelectedModel, setPickerSelectedModel] = useState('');
  const [pickerReasoningEffort, setPickerReasoningEffort] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [pickerStep, setPickerStep] = useState<'select' | 'benchmark'>('select');
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkRunResult | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [limitedOverride, setLimitedOverride] = useState(false);
  const [scanRequested, setScanRequested] = useState(false);
  const [modelsTab, setModelsTab] = useState(0);

  const providerName = useCallback((id: string) => {
    return availableProviders.find(p => p.id === id)?.name ?? id;
  }, [availableProviders]);

  const loadAll = useCallback(async () => {
    try {
      const [loaded, providers] = await Promise.all([
        config.get(),
        provApi.available(),
      ]);
      setCfg(loaded);
      setAvailableProviders(providers);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!cfg) return;
    const extracted: ProfileEntry[] = [];
    const providerConfigs = cfg.provider.providers || {};
    Object.entries(providerConfigs).forEach(([provId, settings]) => {
      if (settings.profiles) {
        Object.entries(settings.profiles).forEach(([profId, prof]) => {
          extracted.push({ id: profId, label: prof.label, providerId: provId, providerName: providerName(provId), apiKey: prof.apiKey ?? '', baseUrl: prof.baseUrl });
        });
      } else if (settings.configured && settings.apiKey) {
        extracted.push({ id: `${provId}-default`, label: providerName(provId), providerId: provId, providerName: providerName(provId), apiKey: settings.apiKey, baseUrl: settings.baseUrl });
      }
    });
    setProfiles(extracted);
    const newActiveId = cfg.provider.providers?.[cfg.provider.activeProvider]?.activeProfile ?? extracted[0]?.id ?? null;
    setActiveProfileId(newActiveId);
    setSelectedModels((prev) => {
      const models: Record<string, string> = {};
      extracted.forEach((p) => {
        models[p.id] = prev[p.id] || (p.id === newActiveId ? (cfg.provider.activeModel ?? '') : '');
      });
      return models;
    });
  }, [cfg, providerName]);

  const handleAddProfile = async () => {
    if (!newProfile.providerId || !newProfile.label) return;
    const sel = availableProviders.find(p => p.id === newProfile.providerId);
    if (sel?.type !== 'local' && !newProfile.apiKey) return;
    setSaving(true);
    try {
      const result = await provApi.createProfile(newProfile.providerId, newProfile.label, newProfile.apiKey, newProfile.baseUrl || undefined, false);
      const updated = await config.get();
      setCfg(updated);
      setShowAddDialog(false);
      setNewProfile({ label: '', providerId: '', apiKey: '', baseUrl: '' });
      openModelPicker({
        id: result.profileId,
        label: newProfile.label,
        providerId: result.provider,
        providerName: providerName(result.provider),
        apiKey: newProfile.apiKey,
        baseUrl: newProfile.baseUrl || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async (profile: ProfileEntry) => {
    try {
      await provApi.deleteProfile(profile.providerId, profile.id);
      const updated = await config.get();
      setCfg(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      setError(msg);
    }
  };

  const startLabelEdit = (profile: ProfileEntry) => {
    setEditingLabel(profile.id);
    setEditLabelValue(profile.label);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const saveLabelEdit = async (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || !editLabelValue.trim()) return;
    const newLabel = editLabelValue.trim();
    if (newLabel === profile.label) { setEditingLabel(null); return; }
    try {
      const res = await fetch('/api/provider/profile/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ provider: profile.providerId, profileId, label: newLabel }) });
      if (!res.ok) throw new Error('Rename failed');
      const updated = await config.get();
      setCfg(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
    setEditingLabel(null);
  };

  const cancelLabelEdit = () => { setEditingLabel(null); };

  const openModelPicker = async (profile: ProfileEntry) => {
    setPickingProfile(profile);
    setPickerModels([]);
    setPickerSelectedModel(selectedModels[profile.id] || '');
    setPickerError('');
    setPickerStep('select');
    setBenchmarkResult(null);
    setLimitedOverride(false);
    setScanRequested(false);
    setPickerLoading(true);
    setModelPickerOpen(true);

    try {
      const models = await provApi.models(profile.providerId);
      setPickerModels(models);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setPickerLoading(false);
    }
  };

  const handleModelSelect = (modelId: string) => {
    setPickerSelectedModel(modelId);
    const model = pickerModels.find((m) => m.id === modelId);
    const levels = model?.reasoning?.effortLevels ?? [];
    const defaultEffort = model?.reasoning?.defaultEffort ?? levels[0] ?? '';
    setPickerReasoningEffort(levels.includes(cfg?.provider.activeReasoningEffort ?? '')
      ? (cfg?.provider.activeReasoningEffort ?? defaultEffort)
      : defaultEffort);
    setBenchmarkResult(null);
    setLimitedOverride(false);
    setScanRequested(false);
    setPickerStep('select');
  };

  const handleStartScan = () => {
    if (!pickerSelectedModel) return;
    setBenchmarkResult(null);
    setLimitedOverride(false);
    setScanRequested(true);
    setPickerStep('benchmark');
  };

  const handleBackToModelSelect = () => {
    setPickerStep('select');
    setScanRequested(false);
    setBenchmarkResult(null);
    setLimitedOverride(false);
  };

  const canConfirmModel = Boolean(
    pickerSelectedModel &&
    benchmarkResult &&
    !benchmarkRunning &&
    (gradeAllowsAgentX(benchmarkResult.grade) ||
      (benchmarkResult.grade === 'LIMITED' && limitedOverride)),
  );

  const confirmModelPicker = async () => {
    if (!pickingProfile || !pickerSelectedModel || !canConfirmModel) return;

    setSwitching(pickingProfile.id);
    setError('');
    try {
      if (pickingProfile.id !== activeProfileId) {
        await provApi.switchProfile(pickingProfile.providerId, pickingProfile.id);
      }
      await modelsApi.switch(pickerSelectedModel, {
        providerId: pickingProfile.providerId,
        reasoningEffort: pickerReasoningEffort || undefined,
      });
      setSelectedModels(prev => ({ ...prev, [pickingProfile.id]: pickerSelectedModel }));
      const updated = await config.get();
      setCfg(updated);
      setActiveProfileId(pickingProfile.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Switch failed');
    } finally {
      setSwitching(null);
      setModelPickerOpen(false);
    }
  };

  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const selectedPickerModel = pickerModels.find((m) => m.id === pickerSelectedModel);

  return (
    <Box>
      <Tabs
        value={modelsTab}
        onChange={(_, v) => setModelsTab(v)}
        sx={{
          minHeight: 36, mb: 2,
          '& .MuiTab-root': {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.62rem',
            minHeight: 36,
            textTransform: 'uppercase',
            letterSpacing: '1px',
          },
          '& .Mui-selected': { color: `${settingsTheme.accent.hud} !important` },
          '& .MuiTabs-indicator': { bgcolor: settingsTheme.accent.hud, height: 2 },
        }}
      >
        <Tab icon={<PsychologyIcon sx={{ fontSize: 14 }} />} iconPosition="start" label="Profiles" />
        <Tab icon={<RadarIcon sx={{ fontSize: 14 }} />} iconPosition="start" label="Capability Scanner" />
      </Tabs>

      {modelsTab === 1 ? (
        <Box>
          <SettingsSectionHeader
            icon={<RadarIcon sx={{ fontSize: 16 }} />}
            title="Capability Scanner"
            subtitle="Run agentic clearance probes on any provider model"
          />
          <ModelBenchmarkScanner profiles={profiles} availableProviders={availableProviders} />
        </Box>
      ) : (
      <>
      <SettingsSectionHeader
        icon={<PsychologyIcon sx={{ fontSize: 16 }} />}
        title="Provider Profiles"
        subtitle={`${profiles.length} profile${profiles.length !== 1 ? 's' : ''}${activeProfile ? ` · active: ${activeProfile.label}` : ''}`}
        action={
          <Button size="small" variant="contained" startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={() => setShowAddDialog(true)}
            sx={settingsBtnPrimarySx}>
            Add Profile
          </Button>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError('')}
          sx={{ mb: 1.5, bgcolor: `${alphaColor(settingsTheme.accent.alert, '12')}`, border: `1px solid ${alphaColor(settingsTheme.accent.alert, '33')}`, fontSize: '0.7rem', ...settingsMonoSx }}>
          {error}
        </Alert>
      )}

      {profiles.length === 0 ? (
        <Box sx={{
          position: 'relative',
          p: 5,
          textAlign: 'center',
          border: `1px dashed ${settingsTheme.border.hud}`,
          borderRadius: '6px',
          bgcolor: settingsTheme.bg.inset,
          overflow: 'hidden',
        }}>
          <Box sx={settingsScanlineSx} />
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.text.secondary, mb: 0.5, position: 'relative' }}>
            No profiles configured
          </Typography>
          <Typography sx={{ ...settingsHelperSx, mb: 2, position: 'relative' }}>
            Add a provider profile to start using AI models
          </Typography>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}
            sx={{ ...settingsBtnGhostSx, position: 'relative' }}>
            Add Profile
          </Button>
        </Box>
      ) : (
        <Box sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
        }}>
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const isEditing = editingLabel === profile.id;
            const isLastProfileOverall = profiles.length <= 1;
            const profilesForSameProvider = profiles.filter(p => p.providerId === profile.providerId);
            const isLastProfileForActiveProvider = isActive && profilesForSameProvider.length <= 1;
            const canDelete = !isLastProfileOverall && !isLastProfileForActiveProvider;
            const deleteTooltip = isLastProfileOverall
              ? 'Cannot delete the last remaining provider profile'
              : isLastProfileForActiveProvider
                ? 'Cannot delete the last profile for the active provider. Switch to another provider first.'
                : 'Delete this provider profile';

            return (
              <ProfileDossier
                key={profile.id}
                profile={profile}
                isActive={isActive}
                isEditing={isEditing}
                editLabelValue={editLabelValue}
                editInputRef={editInputRef}
                selectedModel={selectedModels[profile.id] || ''}
                switching={switching === profile.id}
                canDelete={canDelete}
                deleteTooltip={deleteTooltip}
                onStartEdit={() => startLabelEdit(profile)}
                onSaveEdit={() => saveLabelEdit(profile.id)}
                onCancelEdit={cancelLabelEdit}
                onEditLabelChange={setEditLabelValue}
                onDelete={() => handleDeleteProfile(profile)}
                onOpenPicker={() => openModelPicker(profile)}
              />
            );
          })}
        </Box>
      )}

      </>
      )}

      {/* Add Profile Dialog */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}
        PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 440, width: '100%' } }}>
        <DialogTitle sx={settingsDialogTitleSx}>Add Provider Profile</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <FormControl size="small" sx={settingsTextFieldSx}>
            <InputLabel>Provider</InputLabel>
            <Select value={newProfile.providerId} label="Provider"
              onChange={(e) => {
                const provId = e.target.value;
                const sel = availableProviders.find(p => p.id === provId);
                setNewProfile({
                  ...newProfile,
                  providerId: provId,
                  apiKey: sel?.type === 'local' ? 'no-api-key-required' : newProfile.apiKey,
                  baseUrl: sel?.type === 'cloud' ? (sel.defaultBaseUrl ?? '') : newProfile.baseUrl,
                });
              }}>
              {availableProviders.map((p) => (
                <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.75rem', ...settingsMonoSx }}>
                  {p.name} {p.type === 'local' ? '[LOCAL]' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField size="small" label="Profile Name" value={newProfile.label}
            onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })}
            placeholder="e.g. OpenAI Work, Claude Personal"
            sx={settingsTextFieldSx} />
          {(() => {
            const sel = availableProviders.find(p => p.id === newProfile.providerId);
            const isLocal = sel?.type === 'local';
            return !isLocal ? (
              <TextField size="small" label="API Key" type="password" value={newProfile.apiKey}
                onChange={(e) => setNewProfile({ ...newProfile, apiKey: e.target.value })}
                placeholder="sk-…"
                sx={settingsTextFieldSx} />
            ) : null;
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button onClick={() => setShowAddDialog(false)} sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, textTransform: 'uppercase' }}>
            Cancel
          </Button>
          <Button onClick={handleAddProfile} variant="contained" disabled={saving} sx={settingsBtnPrimarySx}>
            {saving ? <CircularProgress size={12} sx={{ mr: 0.75, color: colors.bg.primary }} /> : null}
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Model Picker Dialog */}
      <Dialog open={modelPickerOpen} onClose={() => setModelPickerOpen(false)}
        PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: pickerStep === 'benchmark' ? 720 : 640, width: '100%' } }}>
        <DialogTitle sx={settingsDialogTitleSx}>
          {pickerStep === 'benchmark'
            ? 'Agentic Clearance Scan'
            : pickingProfile?.id === activeProfileId
              ? 'Switch Model'
              : `Switch to ${pickingProfile?.label ?? ''}`}
        </DialogTitle>
        <DialogContent sx={{ pt: '12px !important', minHeight: pickerStep === 'benchmark' ? 320 : 200 }}>
          {pickerStep === 'select' ? (
            <>
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            {pickingProfile?.providerName} — select a model, then run a clearance scan before saving
          </Typography>

          {pickerLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={20} sx={{ color: settingsTheme.accent.hud }} />
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, ml: 1.5 }}>
                Loading models…
              </Typography>
            </Box>
          ) : pickerError ? (
            <Alert severity="error" sx={{ bgcolor: `${alphaColor(settingsTheme.accent.alert, '12')}`, fontSize: '0.7rem', ...settingsMonoSx }}>{pickerError}</Alert>
          ) : pickerModels.length === 0 ? (
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, py: 2 }}>
              No models available for this provider.
            </Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1, maxHeight: 360, overflow: 'auto' }}>
              {pickerModels.map((m) => {
                const selected = pickerSelectedModel === m.id;
                return (
                  <Box
                    key={m.id}
                    onClick={() => handleModelSelect(m.id)}
                    sx={{
                      position: 'relative',
                      p: 1.25,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      border: `1px solid ${selected ? settingsTheme.accent.hud : settingsTheme.border.default}`,
                      bgcolor: selected ? `${alphaColor(settingsTheme.accent.hud, '18')}` : settingsTheme.bg.inset,
                      boxShadow: selected ? `0 0 16px ${alphaColor(settingsTheme.accent.hud, '25')}` : 'none',
                      transition: 'all 0.15s ease',
                      '&:hover': selected ? {} : { borderColor: settingsTheme.border.hud, bgcolor: settingsTheme.bg.hud },
                    }}
                  >
                    {selected && <Box sx={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', bgcolor: settingsTheme.accent.hud }} />}
                    <Typography sx={{ ...settingsMonoSx, fontWeight: 700, fontSize: '0.68rem', color: selected ? settingsTheme.accent.hud : settingsTheme.text.primary, mb: 0.5, wordBreak: 'break-word' }}>
                      {m.name || m.id}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {m.contextWindow != null && m.contextWindow > 0 && (
                        <Typography sx={{ ...settingsMonoSx, fontSize: '0.5rem', color: settingsTheme.text.dim }}>
                          {m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`}
                        </Typography>
                      )}
                      {m.capabilities && m.capabilities.filter(c => c !== 'text' && c !== 'streaming' && c !== 'reasoning').map((cap) => (
                        <Typography key={cap} sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.accent.cyan, textTransform: 'uppercase' }}>
                          {cap}
                        </Typography>
                      ))}
                      {m.reasoning?.supported && m.reasoning.defaultEffort && (
                        <Typography sx={{ ...settingsMonoSx, fontSize: '0.48rem', color: settingsTheme.accent.hud, textTransform: 'uppercase' }}>
                          think:{m.reasoning.defaultEffort}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}

          {pickerSelectedModel && !pickerLoading && !pickerError && (
            <Box sx={{
              mt: 2, p: 1.5, borderRadius: '4px',
              bgcolor: settingsTheme.bg.hud,
              border: `1px solid ${settingsTheme.border.hud}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ ...settingsOverlineSx, fontSize: '0.45rem', mb: 0.3 }}>Selected model</Typography>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.accent.hud, fontWeight: 700 }}>
                    {selectedPickerModel?.name || pickerSelectedModel}
                  </Typography>
                </Box>
                {(selectedPickerModel?.reasoning?.effortLevels?.length ?? 0) > 0 && (
                  <FormControl size="small" sx={{ minWidth: 140, maxWidth: 200, flexShrink: 0 }}>
                    <InputLabel sx={{ ...settingsMonoSx, fontSize: '0.55rem' }}>Reasoning effort</InputLabel>
                    <Select
                      value={pickerReasoningEffort}
                      label="Reasoning effort"
                      onChange={(e) => setPickerReasoningEffort(e.target.value)}
                      sx={{ ...settingsMonoSx, fontSize: '0.62rem', height: 32 }}
                    >
                      {(selectedPickerModel?.reasoning?.effortLevels ?? []).map((level) => (
                        <MenuItem key={level} value={level} sx={{ ...settingsMonoSx, fontSize: '0.62rem' }}>
                          {level}{level === selectedPickerModel?.reasoning?.defaultEffort ? ' (default)' : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={<RadarIcon sx={{ fontSize: 14 }} />}
                onClick={handleStartScan}
                sx={settingsBtnPrimarySx}
              >
                Run Clearance Scan
              </Button>
            </Box>
          )}
            </>
          ) : (
            <Box>
              <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
                Mandatory clearance scan for <strong>{selectedPickerModel?.name || pickerSelectedModel}</strong>
              </Typography>
              {pickingProfile && (
                <ModelBenchmarkRunner
                  embedded
                  autoStart={scanRequested}
                  providerId={pickingProfile.providerId}
                  modelId={pickerSelectedModel}
                  modelName={selectedPickerModel?.name}
                  profileId={pickingProfile.id}
                  modelCapabilities={selectedPickerModel?.capabilities}
                  onComplete={setBenchmarkResult}
                  onRunningChange={setBenchmarkRunning}
                />
              )}
              {benchmarkResult?.grade === 'LIMITED' && !benchmarkRunning && (
                <FormControlLabel
                  sx={{ mt: 1.5, ml: 0 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={limitedOverride}
                      onChange={(e) => setLimitedOverride(e.target.checked)}
                      sx={{ color: settingsTheme.accent.amber, '&.Mui-checked': { color: settingsTheme.accent.amber } }}
                    />
                  }
                  label={
                    <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.secondary }}>
                      Acknowledge LIMITED clearance — proceed with constraints
                    </Typography>
                  }
                />
              )}
              {benchmarkResult?.grade === 'STANDBY' && !benchmarkRunning && (
                <Alert severity="error" sx={{ mt: 1.5, bgcolor: `${alphaColor(settingsTheme.accent.alert, '12')}`, fontSize: '0.65rem', ...settingsMonoSx }}>
                  Model not cleared for agentic workloads. Select a different model or re-scan after switching providers.
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          {pickerStep === 'select' ? (
          <Button onClick={() => setModelPickerOpen(false)} sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, textTransform: 'uppercase' }}>
            Cancel
          </Button>
          ) : null}
          {pickerStep === 'benchmark' && (
          <Button onClick={handleBackToModelSelect} sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim, textTransform: 'uppercase', mr: 'auto' }}>
            Back
          </Button>
          )}
          {pickerStep === 'benchmark' && (
          <Button
            onClick={confirmModelPicker}
            variant="contained"
            disabled={!canConfirmModel || switching !== null}
            sx={settingsBtnPrimarySx}
          >
            {switching ? <CircularProgress size={12} sx={{ mr: 0.75, color: colors.bg.primary }} /> : null}
            Save Model
          </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
