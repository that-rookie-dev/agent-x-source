import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import { config, providers as provApi, models as modelsApi, crews, type AgentXConfig, type ProviderInfo, type ModelInfo, type Crew, type CrewInput } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

interface ProviderProfile {
  id: string;
  label: string;
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export function SettingsPanel() {
  const { config: appConfig, setConfig } = useApp();
  const [cfg, setCfg] = useState<AgentXConfig | null>(appConfig);
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [crewList, setCrewList] = useState<Crew[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Profile management
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfile, setNewProfile] = useState<{ label: string; providerId: string; apiKey: string; baseUrl: string }>({ label: '', providerId: '', apiKey: '', baseUrl: '' });
  const [profileModels, setProfileModels] = useState<Record<string, ModelInfo[]>>({});
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  // Crew CRUD state
  const [showCrewDialog, setShowCrewDialog] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [crewForm, setCrewForm] = useState<CrewInput>({ name: '', callsign: '', systemPrompt: '', tone: '' });

  useEffect(() => {
    config.get().then(setCfg).catch(() => {});
    provApi.available().then(setAvailableProviders).catch(() => {});
    crews.list().then(setCrewList).catch(() => {});
  }, []);

  // Extract profiles from config
  useEffect(() => {
    if (!cfg) return;
    const extracted: ProviderProfile[] = [];
    const providerConfigs = cfg.provider.providers || {};
    Object.entries(providerConfigs).forEach(([provId, settings]) => {
      if (settings.profiles) {
        Object.entries(settings.profiles).forEach(([profId, prof]) => {
          extracted.push({ id: profId, label: prof.label, providerId: provId, apiKey: prof.apiKey, baseUrl: prof.baseUrl });
        });
      } else if (settings.configured && settings.apiKey) {
        extracted.push({ id: `${provId}-default`, label: `${provId} (default)`, providerId: provId, apiKey: settings.apiKey, baseUrl: settings.baseUrl });
      }
    });
    setProfiles(extracted);
    setActiveProfileId(cfg.provider.providers?.[cfg.provider.activeProvider]?.activeProfile ?? extracted[0]?.id ?? null);
    // Set current model selections
    const models: Record<string, string> = {};
    extracted.forEach((p) => { models[p.id] = p.model ?? cfg.provider.activeModel ?? ''; });
    setSelectedModels(models);
  }, [cfg]);

  // Load models for a provider
  const loadModels = useCallback(async (providerId: string) => {
    if (profileModels[providerId]) return;
    try {
      const m = await provApi.models(providerId);
      setProfileModels((prev) => ({ ...prev, [providerId]: m }));
    } catch { /* ignore */ }
  }, [profileModels]);

  // Load models for all configured providers
  useEffect(() => {
    profiles.forEach((p) => loadModels(p.providerId));
  }, [profiles, loadModels]);

  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true);
    setMessage('');
    try {
      await config.update(cfg);
      setConfig(cfg);
      setMessage('Settings saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddProfile = async () => {
    if (!newProfile.providerId || !newProfile.label || !newProfile.apiKey) return;
    try {
      await provApi.createProfile(newProfile.providerId, newProfile.label, newProfile.apiKey, newProfile.baseUrl || undefined);
      // Refresh config
      const updated = await config.get();
      setCfg(updated);
      setShowAddProfile(false);
      setNewProfile({ label: '', providerId: '', apiKey: '', baseUrl: '' });
      setMessage('Profile added');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to add profile');
    }
  };

  const handleSwitchProfile = async (profile: ProviderProfile) => {
    try {
      await provApi.switchProfile(profile.providerId, profile.id);
      setActiveProfileId(profile.id);
      // Also switch model if set
      const model = selectedModels[profile.id];
      if (model) await modelsApi.switch(model);
      const updated = await config.get();
      setCfg(updated);
      setMessage(`Switched to ${profile.label}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Switch failed');
    }
  };

  const handleDeleteProfile = async (profile: ProviderProfile) => {
    if (!cfg) return;
    // Remove from config locally, save
    const updated = { ...cfg };
    const prov = updated.provider.providers[profile.providerId];
    if (prov?.profiles && prov.profiles[profile.id]) {
      delete prov.profiles[profile.id];
      try {
        await config.update(updated);
        setCfg(updated);
        setMessage('Profile removed');
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Delete failed');
      }
    }
  };

  const handleModelSwitch = async (profileId: string, modelId: string) => {
    setSelectedModels((prev) => ({ ...prev, [profileId]: modelId }));
    // If this is the active profile, actually switch the model
    if (profileId === activeProfileId) {
      try { await modelsApi.switch(modelId); } catch { /* ignore */ }
    }
  };

  const handleSwitchCrew = async (crewId: string) => {
    try { await crews.switch(crewId); } catch { /* ignore */ }
  };

  const handleOpenCrewDialog = (crew?: Crew) => {
    if (crew) {
      setEditingCrew(crew);
      setCrewForm({ name: crew.name, callsign: crew.callsign, systemPrompt: crew.systemPrompt, tone: crew.tone });
    } else {
      setEditingCrew(null);
      setCrewForm({ name: '', callsign: '', systemPrompt: '', tone: '' });
    }
    setShowCrewDialog(true);
  };

  const handleSaveCrew = async () => {
    if (!crewForm.name) return;
    try {
      if (editingCrew) {
        await crews.update(editingCrew.id, crewForm);
      } else {
        await crews.create(crewForm);
      }
      const updated = await crews.list();
      setCrewList(updated);
      setShowCrewDialog(false);
      setMessage(editingCrew ? 'Crew updated' : 'Crew created');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleDeleteCrew = async (id: string) => {
    try {
      await crews.delete(id);
      const updated = await crews.list();
      setCrewList(updated);
      setMessage('Crew deleted');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (!cfg) return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: colors.text.dim }}>Loading settings...</Typography></Box>;

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 600, mb: 0.5 }}>Settings</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>Configure providers, models, and preferences</Typography>
      {message && <Alert severity={message.includes('failed') || message.includes('Failed') ? 'error' : 'success'} sx={{ mb: 2, fontSize: '0.75rem' }} onClose={() => setMessage('')}>{message}</Alert>}

      {/* ─── Provider Profiles ─── */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, flex: 1 }}>Provider Profiles</Typography>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => setShowAddProfile(true)}
            sx={{ fontSize: '0.6rem', textTransform: 'none', color: colors.accent.blue }}>
            Add Profile
          </Button>
        </Box>

        {profiles.length === 0 && (
          <Box sx={{ p: 2, border: `1px dashed ${colors.border.default}`, borderRadius: 1, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>No provider profiles configured. Add one to get started.</Typography>
          </Box>
        )}

        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const provModels = profileModels[profile.providerId] ?? [];
          return (
            <Box key={profile.id} sx={{
              p: 1.5, mb: 1, borderRadius: 1, bgcolor: colors.bg.tertiary,
              border: `1px solid ${isActive ? colors.accent.green + '60' : colors.border.default}`,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{profile.label}</Typography>
                    {isActive && <Chip size="small" icon={<CheckCircleIcon sx={{ fontSize: '12px !important' }} />} label="Active" sx={{ height: 18, fontSize: '0.5rem', color: colors.accent.green, borderColor: colors.accent.green + '40', '& .MuiChip-icon': { color: colors.accent.green } }} variant="outlined" />}
                  </Box>
                  <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                    {profile.providerId} • {'•'.repeat(8)}{profile.apiKey.slice(-4)}
                  </Typography>
                </Box>
                {!isActive && (
                  <Button size="small" onClick={() => handleSwitchProfile(profile)}
                    sx={{ fontSize: '0.55rem', textTransform: 'none', color: colors.accent.blue, minWidth: 'auto' }}>
                    Activate
                  </Button>
                )}
                <IconButton size="small" onClick={() => handleDeleteProfile(profile)} sx={{ color: colors.accent.red, p: 0.5 }}>
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>

              {/* Model selector for this profile */}
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <Select
                    displayEmpty
                    value={selectedModels[profile.id] ?? ''}
                    onChange={(e) => handleModelSwitch(profile.id, e.target.value)}
                    sx={{ fontSize: '0.65rem', height: 30, bgcolor: colors.bg.primary }}
                  >
                    <MenuItem value="" disabled><em>Select model</em></MenuItem>
                    {provModels.map((m) => <MenuItem key={m.id} value={m.id} sx={{ fontSize: '0.7rem' }}>{m.name || m.id}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* ─── Crew Management ─── */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, flex: 1 }}>Crew Management</Typography>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => handleOpenCrewDialog()}
            sx={{ fontSize: '0.6rem', textTransform: 'none', color: colors.accent.blue }}>
            New Crew
          </Button>
        </Box>

        {crewList.length === 0 && (
          <Box sx={{ p: 2, border: `1px dashed ${colors.border.default}`, borderRadius: 1, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>No crews configured.</Typography>
          </Box>
        )}

        {crewList.map((crew) => (
          <Box key={crew.id} sx={{ p: 1.5, mb: 1, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${crew.isDefault ? colors.accent.green + '60' : colors.border.default}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{crew.name}</Typography>
                  {crew.isDefault && <Chip size="small" label="Active" sx={{ height: 18, fontSize: '0.5rem', color: colors.accent.green, borderColor: colors.accent.green + '40' }} variant="outlined" />}
                </Box>
                {crew.tone && <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>Tone: {crew.tone}</Typography>}
                <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                  {crew.systemPrompt.slice(0, 80)}{crew.systemPrompt.length > 80 ? '...' : ''}
                </Typography>
              </Box>
              {!crew.isDefault && (
                <Button size="small" onClick={() => handleSwitchCrew(crew.id)}
                  sx={{ fontSize: '0.55rem', textTransform: 'none', color: colors.accent.blue, minWidth: 'auto' }}>
                  Activate
                </Button>
              )}
              <IconButton size="small" onClick={() => handleOpenCrewDialog(crew)} sx={{ color: colors.text.secondary, p: 0.5 }}>
                <EditIcon sx={{ fontSize: 14 }} />
              </IconButton>
              <IconButton size="small" onClick={() => handleDeleteCrew(crew.id)} sx={{ color: colors.accent.red, p: 0.5 }}>
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          </Box>
        ))}
      </Box>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* ─── User ─── */}
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, mb: 1 }}>User</Typography>
      <TextField size="small" label="Callsign" value={cfg.user?.callsign ?? ''} onChange={(e) => setCfg({ ...cfg, user: { callsign: e.target.value } })} sx={{ mb: 2 }} InputProps={{ sx: { fontSize: '0.75rem' } }} />

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      {/* ─── UI Preferences ─── */}
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.secondary, mb: 1 }}>UI Preferences</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Animation</InputLabel>
          <Select value={cfg.ui?.animationSpeed ?? 'normal'} label="Animation" onChange={(e) => setCfg({ ...cfg, ui: { ...cfg.ui, animationSpeed: e.target.value } })} sx={{ fontSize: '0.75rem' }}>
            <MenuItem value="none" sx={{ fontSize: '0.75rem' }}>None</MenuItem>
            <MenuItem value="reduced" sx={{ fontSize: '0.75rem' }}>Reduced</MenuItem>
            <MenuItem value="normal" sx={{ fontSize: '0.75rem' }}>Normal</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />

      <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.75rem', textTransform: 'none' }}>
        {saving ? 'Saving...' : 'Save Settings'}
      </Button>

      {/* Add Profile Dialog */}
      <Dialog open={showAddProfile} onClose={() => setShowAddProfile(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 380 } }}>
        <DialogTitle sx={{ fontSize: '0.85rem' }}>Add Provider Profile</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField size="small" label="Profile Name" value={newProfile.label} onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })} placeholder="e.g. OpenAI Work, Claude Personal" />
          <FormControl size="small">
            <InputLabel>Provider</InputLabel>
            <Select value={newProfile.providerId} label="Provider" onChange={(e) => setNewProfile({ ...newProfile, providerId: e.target.value })}>
              {availableProviders.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="API Key" type="password" value={newProfile.apiKey} onChange={(e) => setNewProfile({ ...newProfile, apiKey: e.target.value })} />
          <TextField size="small" label="Base URL (optional)" value={newProfile.baseUrl} onChange={(e) => setNewProfile({ ...newProfile, baseUrl: e.target.value })} placeholder="Leave empty for default" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddProfile(false)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleAddProfile} variant="contained" sx={{ bgcolor: colors.accent.blue, textTransform: 'none' }}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* Crew Dialog */}
      <Dialog open={showCrewDialog} onClose={() => setShowCrewDialog(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 380 } }}>
        <DialogTitle sx={{ fontSize: '0.85rem' }}>{editingCrew ? 'Edit Crew' : 'Create Crew'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField size="small" label="Name" value={crewForm.name} onChange={(e) => setCrewForm({ ...crewForm, name: e.target.value })} placeholder="e.g. Code Assistant, Creative Writer" />
          <TextField size="small" label="Callsign" value={crewForm.callsign} onChange={(e) => setCrewForm({ ...crewForm, callsign: e.target.value.replace(/\s/g, '') })} placeholder="e.g. code-wizard" helperText="Unique handle for @mentions — no spaces" />
          <TextField size="small" label="System Prompt" multiline rows={4} value={crewForm.systemPrompt} onChange={(e) => setCrewForm({ ...crewForm, systemPrompt: e.target.value })} placeholder="Define the crew's behavior and personality..." />
          <TextField size="small" label="Tone (optional)" value={crewForm.tone ?? ''} onChange={(e) => setCrewForm({ ...crewForm, tone: e.target.value })} placeholder="e.g. professional, casual, technical" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCrewDialog(false)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleSaveCrew} variant="contained" sx={{ bgcolor: colors.accent.blue, textTransform: 'none' }}>{editingCrew ? 'Update' : 'Create'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
