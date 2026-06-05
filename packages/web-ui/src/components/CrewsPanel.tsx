import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BoltIcon from '@mui/icons-material/Bolt';
import StarIcon from '@mui/icons-material/Star';
import { crews as crewsApi, type Crew, type CrewInput } from '../api';
import { colors } from '../theme';

const EMOTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'sarcastic', 'arrogant', 'flirty', 'happy', 'sad'] as const;

const SYSTEM_PROMPT_PLACEHOLDER = `You are a [role] specializing in [domain].

Your expertise:
- [skill 1]
- [skill 2]

Communication style: [concise/verbose/technical/casual]
Always respond with practical, actionable advice.`;

interface FormState {
  name: string;
  callsign: string;
  systemPrompt: string;
  tone: string;
}

const EMPTY_FORM: FormState = { name: '', callsign: '', systemPrompt: '', tone: 'professional' };

export function CrewsPanel() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailCrew, setDetailCrew] = useState<Crew | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await crewsApi.list();
      setCrews(list);
      try {
        const current = await crewsApi.current();
        setActiveId(current?.id ?? null);
      } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crews');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try { await crewsApi.toggle(id, enabled); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Toggle failed'); }
    finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this crew?')) return;
    setBusy(true);
    try {
      await crewsApi.delete(id);
      setDetailCrew(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEdit = (c: Crew) => {
    setForm({ name: c.name, callsign: c.callsign, systemPrompt: c.systemPrompt, tone: c.tone ?? 'professional' });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.systemPrompt.trim()) { setError('System prompt is required'); return; }
    setBusy(true);
    setError('');
    try {
      const payload: CrewInput = { name: form.name.trim(), callsign: form.callsign.trim() || form.name.trim().replace(/\s+/g, '').toLowerCase(), systemPrompt: form.systemPrompt.trim(), tone: form.tone };
      if (isEditing && form.name) {
        const existing = crews.find(c => c.name === form.name || c.callsign === form.callsign);
        if (existing) {
          await crewsApi.update(existing.id, payload);
        }
      } else {
        await crewsApi.create(payload);
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleEditFromDetail = (c: Crew) => {
    setDetailCrew(null);
    openEdit(c);
  };

  const handleCardClick = (c: Crew) => {
    setDetailCrew(c);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5, pb: 1.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <GroupsIcon sx={{ color: colors.accent.purple, fontSize: 24 }} />
          <Box>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 600 }}>Crews</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mt: 0.25 }}>
              Custom agent personas — each crew defines a unique AI personality
            </Typography>
          </Box>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreate}
          sx={{ bgcolor: colors.accent.purple, fontSize: '0.7rem', textTransform: 'none', px: 1.5, py: 0.5, '&:hover': { bgcolor: '#9b4fd1' } }}>
          New Crew
        </Button>
      </Box>

      {error && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" sx={{ bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        {crews.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1.5, mt: 2 }}>
            <GroupsIcon sx={{ fontSize: 48, color: colors.text.dim, mb: 2 }} />
            <Typography sx={{ fontSize: '0.85rem', color: colors.text.secondary, mb: 1 }}>No crews yet</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>
              Create your first crew member to give Agent-X a specialized personality
            </Typography>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openCreate}
              sx={{ borderColor: colors.accent.purple, color: colors.accent.purple, textTransform: 'none', fontSize: '0.7rem' }}>
              Create Crew
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2, mt: 1.5 }}>
            {crews.map((c) => {
              const isActive = c.id === activeId;
              const isEnabled = c.enabled !== false;
              return (
                <Box
                  key={c.id}
                  onClick={() => handleCardClick(c)}
                  sx={{
                    border: `1px solid ${isActive ? colors.accent.purple : isEnabled ? colors.accent.green + '40' : colors.border.default}`,
                    borderRadius: 2,
                    bgcolor: colors.bg.secondary,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                    '&:hover': {
                      borderColor: isActive ? colors.accent.purple : isEnabled ? colors.accent.green : colors.border.strong,
                      transform: 'translateY(-2px)',
                      boxShadow: isActive ? `0 4px 20px ${colors.accent.purple}20` : isEnabled ? `0 4px 20px ${colors.accent.green}15` : 'none',
                    },
                  }}
                >
                  <Box sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: colors.text.primary }}>{c.name}</Typography>
                          {isActive && (
                            <Tooltip title="Currently active crew">
                              <StarIcon sx={{ fontSize: 14, color: colors.accent.purple }} />
                            </Tooltip>
                          )}
                        </Box>
                        <Typography sx={{ fontSize: '0.65rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
                          @{c.callsign}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        {c.tone && (
                          <Chip size="small" label={c.tone}
                            sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.accent.purple + '20', border: `1px solid ${colors.accent.purple}40`, color: colors.accent.purple }} />
                        )}
                      </Box>
                    </Box>

                    <Typography sx={{
                      fontSize: '0.7rem', color: colors.text.tertiary, lineHeight: 1.5, mb: 1.5,
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {c.systemPrompt}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <Typography sx={{ fontSize: '0.55rem', color: isEnabled ? colors.accent.green : colors.text.dim, fontFamily: "'JetBrains Mono', monospace", display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <BoltIcon sx={{ fontSize: 12 }} />
                        {isEnabled ? 'ENABLED' : 'DISABLED'}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Tooltip title={isEnabled ? 'Disable' : 'Enable'}>
                        <Switch size="small" checked={isEnabled} disabled={busy}
                          onChange={(e) => { e.stopPropagation(); handleToggle(c.id, !isEnabled); }}
                          onClick={(e) => e.stopPropagation()}
                          sx={{ '& .MuiSwitch-thumb': { bgcolor: isEnabled ? colors.accent.green : colors.text.dim } }} />
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton size="small" disabled={busy}
                          onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                          sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.blue } }}>
                          <EditIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" disabled={busy}
                          onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                          sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Detail Modal */}
      <Dialog
        open={!!detailCrew}
        onClose={() => setDetailCrew(null)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 560, width: '100%' } }}
      >
        {detailCrew && (() => {
          const isEnabled = detailCrew.enabled !== false;
          const isActive = detailCrew.id === activeId;
          return (
            <>
              <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <GroupsIcon sx={{ color: colors.accent.purple, fontSize: 20 }} />
                {detailCrew.name}
                {isActive && <StarIcon sx={{ fontSize: 14, color: colors.accent.purple, ml: 0.5 }} />}
              </DialogTitle>
              <DialogContent sx={{ pt: '8px !important' }}>
                <Typography sx={{ fontSize: '0.7rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", mb: 2 }}>
                  @{detailCrew.callsign}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
                  {detailCrew.tone && (
                    <Chip size="small" label={detailCrew.tone}
                      sx={{ height: 22, fontSize: '0.55rem', bgcolor: colors.accent.purple + '20', border: `1px solid ${colors.accent.purple}40`, color: colors.accent.purple }} />
                  )}
                  <Chip size="small" label={isEnabled ? 'Enabled' : 'Disabled'}
                    sx={{ height: 22, fontSize: '0.55rem',
                      color: isEnabled ? colors.accent.green : colors.text.dim,
                      border: `1px solid ${isEnabled ? colors.accent.green + '60' : colors.border.default}`,
                    }} variant="outlined" />
                  {isActive && (
                    <Chip size="small" label="Active Crew" icon={<StarIcon sx={{ fontSize: 12 }} />}
                      sx={{ height: 22, fontSize: '0.55rem', color: colors.accent.purple, border: `1px solid ${colors.accent.purple}60` }} variant="outlined" />
                  )}
                </Box>

                {detailCrew.expertise && detailCrew.expertise.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>Expertise</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {detailCrew.expertise.map((exp) => (
                        <Chip key={exp} size="small" label={exp} sx={{ height: 20, fontSize: '0.55rem', bgcolor: colors.bg.tertiary }} />
                      ))}
                    </Box>
                  </Box>
                )}

                <Box sx={{ mb: 0 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: colors.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>System Prompt</Typography>
                  <Box sx={{ p: 2, bgcolor: colors.bg.tertiary, borderRadius: 1, border: `1px solid ${colors.border.default}`, maxHeight: 200, overflow: 'auto' }}>
                    <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap' }}>
                      {detailCrew.systemPrompt}
                    </Typography>
                  </Box>
                </Box>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Tooltip title={isEnabled ? 'Disable' : 'Enable'}>
                    <Switch size="small" checked={isEnabled} disabled={busy}
                      onChange={() => handleToggle(detailCrew.id, !isEnabled)}
                      sx={{ '& .MuiSwitch-thumb': { bgcolor: isEnabled ? colors.accent.green : colors.text.dim } }} />
                  </Tooltip>
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>{isEnabled ? 'Enabled' : 'Disabled'}</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleEditFromDetail(detailCrew)}
                    sx={{ borderColor: colors.border.strong, color: colors.text.secondary, textTransform: 'none', fontSize: '0.7rem' }}>
                    Edit
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleDelete(detailCrew.id)}
                    sx={{ borderColor: colors.accent.red + '50', color: colors.accent.red, textTransform: 'none', fontSize: '0.7rem' }}>
                    Delete
                  </Button>
                </Box>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      {/* Create / Edit Modal */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2, maxWidth: 560, width: '100%' } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px' }}>
          {isEditing ? 'Edit Crew' : 'Create New Crew'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <Box>
            <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth placeholder="e.g. Backend Architect" />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              A descriptive name for this crew member. Examples: Backend Architect, Security Auditor, Frontend Ninja, DevOps Wizard
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Callsign" value={form.callsign}
              onChange={(e) => setForm({ ...form, callsign: e.target.value.replace(/\s/g, '').toLowerCase() })}
              fullWidth placeholder="e.g. backend_ranger" />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              Unique handle for <Typography component="span" sx={{ fontSize: '0.55rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace" }}>@mentions</Typography>. No spaces. Used to invoke this crew in chat.
              Auto-generated from name if left empty.
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 1, textTransform: 'uppercase', letterSpacing: '1px' }}>Tone / Emotion</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {EMOTIONS.map((t) => (
                <Chip
                  key={t}
                  size="small"
                  label={t}
                  onClick={() => setForm({ ...form, tone: t })}
                  sx={{
                    fontSize: '0.6rem', cursor: 'pointer',
                    bgcolor: form.tone === t ? colors.accent.purple + '30' : 'transparent',
                    border: `1px solid ${form.tone === t ? colors.accent.purple : colors.border.default}`,
                    color: form.tone === t ? colors.accent.purple : colors.text.secondary,
                    '&:hover': { borderColor: colors.accent.purple + '60', bgcolor: colors.accent.purple + '15' },
                  }}
                />
              ))}
            </Box>
          </Box>

          <Box>
            <TextField
              size="small" label="System Prompt" value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              fullWidth multiline rows={10} placeholder={SYSTEM_PROMPT_PLACEHOLDER}
              sx={{
                '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', lineHeight: 1.6 },
              }}
            />
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.5 }}>
              Defines the personality, expertise, and behavior of this crew member. Be specific about their domain, skills, and communication style.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.75rem' }}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy} variant="contained"
            sx={{ bgcolor: colors.accent.purple, textTransform: 'none', fontSize: '0.75rem', px: 2.5, '&:hover': { bgcolor: '#9b4fd1' } }}>
            {busy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            {isEditing ? 'Save Changes' : 'Create Crew'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
