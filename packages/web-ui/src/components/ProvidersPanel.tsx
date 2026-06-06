import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
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
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
  const [profileModels, setProfileModels] = useState<Record<string, ModelInfo[]>>({});
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [loadingModels, setLoadingModels] = useState<Set<string>>(new Set());
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newProfile, setNewProfile] = useState({ label: '', providerId: '', apiKey: '', baseUrl: '' });
  const [saving, setSaving] = useState(false);

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
    setActiveProfileId(cfg.provider.providers?.[cfg.provider.activeProvider]?.activeProfile ?? extracted[0]?.id ?? null);
    const models: Record<string, string> = {};
    extracted.forEach((p) => { models[p.id] = cfg.provider.activeModel ?? ''; });
    setSelectedModels(models);
  }, [cfg, providerName]);

  const loadModels = useCallback(async (providerId: string) => {
    if (profileModels[providerId] || loadingModels.has(providerId)) return;
    setLoadingModels((prev) => new Set(prev).add(providerId));
    try {
      const m = await provApi.models(providerId);
      setProfileModels((prev) => ({ ...prev, [providerId]: m }));
    } catch { /* ignore */ }
    setLoadingModels((prev) => { const next = new Set(prev); next.delete(providerId); return next; });
  }, [profileModels, loadingModels]);

  useEffect(() => {
    profiles.forEach((p) => loadModels(p.providerId));
  }, [profiles, loadModels]);

  const handleAddProfile = async () => {
    if (!newProfile.providerId || !newProfile.label || !newProfile.apiKey) return;
    setSaving(true);
    try {
      await provApi.createProfile(newProfile.providerId, newProfile.label, newProfile.apiKey, newProfile.baseUrl || undefined);
      const updated = await config.get();
      setCfg(updated);
      setShowAddDialog(false);
      setNewProfile({ label: '', providerId: '', apiKey: '', baseUrl: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchProfile = async (profile: ProfileEntry) => {
    setSwitching(profile.id);
    setError('');
    try {
      await provApi.switchProfile(profile.providerId, profile.id);
      const model = selectedModels[profile.id];
      if (model) await modelsApi.switch(model);
      const updated = await config.get();
      setCfg(updated);
      setActiveProfileId(profile.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Switch failed');
    } finally {
      setSwitching(null);
    }
  };

  const handleModelChange = async (profileId: string, modelId: string) => {
    setSelectedModels((prev) => ({ ...prev, [profileId]: modelId }));
    if (profileId === activeProfileId) {
      try { await modelsApi.switch(modelId); } catch { /* ignore */ }
    }
  };

  const handleDeleteProfile = async (profile: ProfileEntry) => {
    if (!cfg) return;
    const updated = { ...cfg, provider: { ...cfg.provider } };
    updated.provider.providers = { ...updated.provider.providers };
    const prov = { ...updated.provider.providers[profile.providerId] };
    if (prov?.profiles) {
      prov.profiles = { ...prov.profiles };
      delete prov.profiles[profile.id];
      updated.provider.providers[profile.providerId] = prov;
      try {
        await config.update(updated);
        setCfg(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed');
      }
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5, pb: 1.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600 }}>Providers</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mt: 0.25 }}>
            Manage AI provider profiles and switch between them
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}
          sx={{ bgcolor: colors.accent.blue, fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5, '&:hover': { bgcolor: '#3b8ad9' } }}>
          Add Profile
        </Button>
      </Box>

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
              const provModels = profileModels[profile.providerId] ?? [];
              const loading = loadingModels.has(profile.providerId);
              const isSwitching = switching === profile.id;

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
                          <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', color: colors.text.primary }}>
                            {profile.label}
                          </Typography>
                          {isActive && (
                            <Chip size="small" icon={<CheckCircleIcon sx={{ fontSize: '12px !important', color: `${colors.accent.green} !important` }} />}
                              label="Active" sx={{ height: 22, fontSize: '0.55rem', color: colors.accent.green, borderColor: colors.accent.green + '40' }} variant="outlined" />
                          )}
                        </Box>
                        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.5 }}>
                          {profile.providerName}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={() => handleDeleteProfile(profile)}
                        sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.red } }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>

                    <Box sx={{ mb: 1 }}>
                      <FormControl size="small" fullWidth>
                        {loading && provModels.length === 0 ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 34, px: 1 }}>
                            <CircularProgress size={12} />
                            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>Loading models...</Typography>
                          </Box>
                        ) : (
                          <Select
                            displayEmpty
                            value={selectedModels[profile.id] ?? ''}
                            onChange={(e) => handleModelChange(profile.id, e.target.value)}
                            sx={{ fontSize: '0.7rem', height: 34, bgcolor: colors.bg.tertiary }}
                          >
                            <MenuItem value="" disabled><em style={{ fontSize: '0.65rem' }}>Select model</em></MenuItem>
                            {provModels.map((m) => (
                              <MenuItem key={m.id} value={m.id} sx={{ fontSize: '0.7rem' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', overflow: 'hidden' }}>
                                  <Typography sx={{ fontSize: '0.7rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {m.name || m.id}
                                  </Typography>
                                  {m.contextWindow != null && m.contextWindow > 0 && (
                                    <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                                      {m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`}
                                    </Typography>
                                  )}
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        )}
                      </FormControl>
                    </Box>

                    {isActive ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green }} />
                        <Typography sx={{ fontSize: '0.6rem', color: colors.accent.green, fontFamily: "'JetBrains Mono', monospace" }}>
                          Currently active
                        </Typography>
                      </Box>
                    ) : (
                      <Button
                        fullWidth size="small" variant="outlined"
                        onClick={() => handleSwitchProfile(profile)}
                        disabled={isSwitching}
                        sx={{
                          fontSize: '0.65rem', textTransform: 'none',
                          borderColor: colors.accent.blue + '50', color: colors.accent.blue,
                          '&:hover': { borderColor: colors.accent.blue, bgcolor: colors.accent.blue + '10' },
                        }}
                      >
                        {isSwitching ? <CircularProgress size={12} sx={{ mr: 1 }} /> : null}
                        Switch to this profile
                      </Button>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 440, width: '100%' } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          Add Provider Profile
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <FormControl size="small">
            <InputLabel>Provider</InputLabel>
            <Select value={newProfile.providerId} label="Provider"
              onChange={(e) => setNewProfile({ ...newProfile, providerId: e.target.value })}>
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
          <TextField size="small" label="API Key" type="password" value={newProfile.apiKey}
            onChange={(e) => setNewProfile({ ...newProfile, apiKey: e.target.value })}
            placeholder="sk-..." />
          <TextField size="small" label="Base URL (optional)" value={newProfile.baseUrl}
            onChange={(e) => setNewProfile({ ...newProfile, baseUrl: e.target.value })}
            placeholder="Leave empty for default" />
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
    </Box>
  );
}
