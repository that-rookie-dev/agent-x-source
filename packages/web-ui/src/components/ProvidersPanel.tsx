import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import { PanelHeader } from './PanelHeader';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
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
import { config, providers as provApi, models as modelsApi, type AgentXConfig, type ProviderInfo, type ModelInfo } from '../api';
import { colors } from '../theme';

interface ProfileEntry {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl?: string;
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

  // Edit profile name state
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Model picker dialog state
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickingProfile, setPickingProfile] = useState<ProfileEntry | null>(null);
  const [pickerModels, setPickerModels] = useState<ModelInfo[]>([]);
  const [pickerSelectedModel, setPickerSelectedModel] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');

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
      // Prompt for model selection on the new profile
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
      // The backend returns a structured error for blocked deletions
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

  // Load models on demand when opening the picker
  const openModelPicker = async (profile: ProfileEntry) => {
    setPickingProfile(profile);
    setPickerModels([]);
    setPickerSelectedModel(selectedModels[profile.id] || '');
    setPickerError('');
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

  const confirmModelPicker = async () => {
    if (!pickingProfile || !pickerSelectedModel) return;

    setSwitching(pickingProfile.id);
    setError('');
    try {
      // First switch profile if not already active, then set the model
      if (pickingProfile.id !== activeProfileId) {
        await provApi.switchProfile(pickingProfile.providerId, pickingProfile.id);
      }
      await modelsApi.switch(pickerSelectedModel);
      // Track the last model for this profile
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

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Models"
        subtitle="Manage AI provider profiles and switch between them"
        action={
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}
            sx={{ bgcolor: colors.accent.blue, fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5, '&:hover': { bgcolor: '#3b8ad9' } }}>
            Add Profile
          </Button>
        }
      />

      {error && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" sx={{ bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {profiles.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1.5, mt: 2 }}>
            <Typography sx={{ fontSize: '0.85rem', color: colors.text.secondary, mb: 1 }}>No profiles configured</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2.5 }}>
              Add a provider profile to start using AI models
            </Typography>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}
              sx={{ borderColor: colors.accent.blue, color: colors.accent.blue, textTransform: 'none', fontSize: '0.7rem' }}>
              Add Profile
            </Button>
          </Box>
        ) : (
          <Box sx={{
            display: 'grid',
            gap: 2,
            mt: 1.5,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
              lg: 'repeat(4, 1fr)',
            },
          }}>
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              const isEditing = editingLabel === profile.id;
              // Guard: can't delete the last profile overall, or the last profile
              // for the active provider
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
                <Box
                  key={profile.id}
                  sx={{
                    border: `1px solid ${isActive ? colors.accent.green + '50' : colors.border.default}`,
                    borderRadius: 2,
                    bgcolor: colors.bg.secondary,
                    transition: 'all 0.2s ease',
                    '&:hover': { borderColor: isActive ? colors.accent.green : colors.border.strong },
                  }}
                >
                  <Box sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {isEditing ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1 }}>
                              <TextField
                                inputRef={editInputRef}
                                size="small"
                                value={editLabelValue}
                                onChange={(e) => setEditLabelValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveLabelEdit(profile.id); if (e.key === 'Escape') cancelLabelEdit(); }}
                                sx={{ flex: 1 }}
                              />
                              <IconButton size="small" onClick={() => saveLabelEdit(profile.id)} sx={{ p: 0.25, color: colors.accent.green }}>
                                <CheckIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                              <IconButton size="small" onClick={cancelLabelEdit} sx={{ p: 0.25, color: colors.accent.red }}>
                                <CloseIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Box>
                          ) : (
                            <>
                              <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', color: colors.text.primary }}>
                                {profile.label}
                              </Typography>
                              {isActive && (
                                <Chip size="small"
                                  label="Active" sx={{ height: 22, fontSize: '0.55rem', color: colors.accent.green, borderColor: colors.accent.green + '40' }} variant="outlined" />
                              )}
                              <IconButton size="small" onClick={() => startLabelEdit(profile)}
                                sx={{ color: colors.text.dim, p: 0.25, opacity: 0, transition: 'opacity 0.15s', '.MuiBox-root:hover &': { opacity: 1 } }}>
                                <EditIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </>
                          )}
                        </Box>
                        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.5 }}>
                          {profile.providerName}
                        </Typography>
                      </Box>
                      <Tooltip title={deleteTooltip} placement="left" arrow>
                        <span>
                          <IconButton size="small" onClick={() => canDelete && handleDeleteProfile(profile)}
                            disabled={!canDelete}
                            sx={{ color: colors.text.dim, p: 0.5, '&:hover': canDelete ? { color: colors.accent.red } : {}, opacity: canDelete ? 1 : 0.3 }}>
                            <DeleteIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>

                    <Box sx={{ mt: 1 }}>
                      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mb: 1 }}>
                        {isActive
                          ? `Model: ${selectedModels[profile.id] || '—'}`
                          : selectedModels[profile.id]
                            ? `Last Model: ${selectedModels[profile.id]}`
                            : 'Model: NA'}
                      </Typography>
                      <Button
                        fullWidth size="small" variant="outlined"
                        onClick={() => openModelPicker(profile)}
                        disabled={!isActive && switching === profile.id}
                        sx={{
                          fontSize: '0.65rem', textTransform: 'none',
                          borderColor: colors.accent.blue + '50', color: colors.accent.blue,
                          '&:hover': { borderColor: colors.accent.blue, bgcolor: colors.accent.blue + '10' },
                        }}
                      >
                        {!isActive && switching === profile.id ? <CircularProgress size={12} sx={{ mr: 1 }} /> : null}
                        {isActive ? 'Switch Model' : 'Switch to this profile'}
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Add Profile Dialog */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 440, width: '100%' } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          Add Provider Profile
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <FormControl size="small">
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
                <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.75rem' }}>
                  {p.name} {p.type === 'local' ? '(Local)' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField size="small" label="Profile Name" value={newProfile.label}
            onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })}
            placeholder="e.g. OpenAI Work, Claude Personal" />
          {(() => {
            const sel = availableProviders.find(p => p.id === newProfile.providerId);
            const isLocal = sel?.type === 'local';
            return (
              <>
                {!isLocal && (
                  <TextField size="small" label="API Key" type="password" value={newProfile.apiKey}
                    onChange={(e) => setNewProfile({ ...newProfile, apiKey: e.target.value })}
                    placeholder="sk-..." />
                )}
              </>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setShowAddDialog(false)} sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.75rem' }}>Cancel</Button>
          <Button onClick={handleAddProfile} variant="contained" disabled={saving}
            sx={{ bgcolor: colors.accent.blue, textTransform: 'none', fontSize: '0.75rem', px: 2.5, '&:hover': { bgcolor: '#3b8ad9' } }}>
            {saving ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Model Picker Dialog */}
      <Dialog open={modelPickerOpen} onClose={() => setModelPickerOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 640, width: '100%' } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          {pickingProfile?.id === activeProfileId ? 'Switch Model' : `Switch to ${pickingProfile?.label ?? ''}`}
        </DialogTitle>
        <DialogContent sx={{ pt: '12px !important', minHeight: 200 }}>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>
            {pickingProfile?.providerName} — select a model
          </Typography>

          {pickerLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, ml: 1.5 }}>Loading models...</Typography>
            </Box>
          ) : pickerError ? (
            <Alert severity="error" sx={{ bgcolor: '#1a0000', fontSize: '0.7rem' }}>{pickerError}</Alert>
          ) : pickerModels.length === 0 ? (
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, py: 2 }}>No models available for this provider.</Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1, maxHeight: 360, overflow: 'auto' }}>
              {pickerModels.map((m) => (
                <Box
                  key={m.id}
                  onClick={() => setPickerSelectedModel(m.id)}
                  sx={{
                    p: 1.5,
                    border: `1px solid ${pickerSelectedModel === m.id ? colors.accent.blue : colors.border.default}`,
                    borderRadius: 1,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    bgcolor: pickerSelectedModel === m.id ? colors.accent.blue : 'transparent',
                    boxShadow: pickerSelectedModel === m.id ? `0 0 12px ${colors.accent.blue}40` : 'none',
                    '&:hover': pickerSelectedModel === m.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary },
                  }}
                >
                  <Typography sx={{ fontWeight: 600, fontSize: '0.78rem', color: pickerSelectedModel === m.id ? '#000' : colors.text.primary, mb: 0.5, wordBreak: 'break-word' }}>
                    {m.name || m.id}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                    {m.contextWindow != null && m.contextWindow > 0 && (
                      <Typography sx={{ fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", color: pickerSelectedModel === m.id ? '#000000aa' : colors.text.dim }}>
                        {m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`} ctx
                      </Typography>
                    )}
                    {m.capabilities && m.capabilities.length > 0 && m.capabilities.filter(c => c !== 'text' && c !== 'streaming').map((cap) => (
                      <Typography key={cap} sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: pickerSelectedModel === m.id ? '#000000aa' : colors.accent.cyan, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {cap}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setModelPickerOpen(false)} sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.75rem' }}>Cancel</Button>
          <Button
            onClick={confirmModelPicker}
            variant="contained"
            disabled={!pickerSelectedModel || pickerLoading || switching !== null}
            sx={{ bgcolor: colors.accent.blue, textTransform: 'none', fontSize: '0.75rem', px: 2.5, '&:hover': { bgcolor: '#3b8ad9' } }}
          >
            {switching ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
