import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import GroupsIcon from '@mui/icons-material/Groups';
import StarIcon from '@mui/icons-material/Star';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { crews as crewsApi, type Crew } from '../api';
import { colors } from '../theme';

interface FormState {
  id?: string;
  name: string;
  systemPrompt: string;
  tone: string;
}

const EMPTY_FORM: FormState = { name: '', systemPrompt: '', tone: 'professional' };

const TONE_OPTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'sarcastic', 'flirty', 'happy', 'sad', 'arrogant'];

export function CrewsPanel() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
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
  };

  useEffect(() => { load(); }, []);

  const handleSwitch = async (id: string) => {
    setBusy(true);
    try { await crewsApi.switch(id); setActiveId(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Switch failed'); }
    finally { setBusy(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (form.id) {
        await crewsApi.update(form.id, { name: form.name, systemPrompt: form.systemPrompt, tone: form.tone });
      } else {
        await crewsApi.create({ name: form.name, systemPrompt: form.systemPrompt, tone: form.tone });
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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this crew?')) return;
    setBusy(true);
    try { await crewsApi.delete(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  };

  const openEdit = (c: Crew) => {
    setForm({ id: c.id, name: c.name, systemPrompt: c.systemPrompt, tone: c.tone ?? 'professional' });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GroupsIcon sx={{ color: colors.accent.purple }} />
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 600 }}>Crew Mesh</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>Switch agent personalities — tone, system prompt, identity</Typography>
          </Box>
        </Box>
        <Button size="small" startIcon={<AddIcon />} onClick={openCreate} sx={{ color: colors.accent.blue, textTransform: 'none' }}>
          New Crew
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
        {crews.map((c) => {
          const isActive = c.id === activeId;
          return (
            <Box key={c.id} sx={{
              p: 1.75, borderRadius: 1,
              bgcolor: isActive ? colors.accent.purple + '15' : colors.bg.tertiary,
              border: `1px solid ${isActive ? colors.accent.purple : colors.border.default}`,
              position: 'relative',
            }}>
              {isActive && (
                <Chip size="small" icon={<StarIcon sx={{ fontSize: 12 }} />} label="ACTIVE" sx={{
                  position: 'absolute', top: 8, right: 8, height: 18, fontSize: '0.5rem',
                  color: colors.accent.purple, borderColor: colors.accent.purple + '60', bgcolor: colors.bg.primary,
                }} variant="outlined" />
              )}
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, mb: 0.25 }}>{c.name}</Typography>
              {c.tone && <Chip size="small" label={c.tone} sx={{ height: 16, fontSize: '0.5rem', mb: 0.75 }} />}
              <Typography sx={{
                fontSize: '0.65rem', color: colors.text.tertiary, mb: 1.25,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {c.systemPrompt}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {!isActive && (
                  <Button size="small" disabled={busy} onClick={() => handleSwitch(c.id)} sx={{
                    fontSize: '0.6rem', textTransform: 'none',
                    bgcolor: colors.accent.purple, color: '#fff', '&:hover': { bgcolor: colors.accent.purple },
                  }}>
                    Activate
                  </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => openEdit(c)} sx={{ color: colors.text.dim }}>
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                {!c.isDefault && (
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => handleDelete(c.id)} sx={{ color: colors.accent.red }}>
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {crews.length === 0 && (
        <Box sx={{ p: 4, textAlign: 'center', border: `1px dashed ${colors.border.default}`, borderRadius: 1 }}>
          <Typography sx={{ fontSize: '0.8rem', color: colors.text.dim }}>No custom crews yet. Click "New Crew" to create one.</Typography>
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, minWidth: 480 } }}>
        <DialogTitle sx={{ fontSize: '0.9rem' }}>{form.id ? 'Edit Crew' : 'New Crew'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 0.75 }}>TONE</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {TONE_OPTIONS.map((t) => (
                <Chip
                  key={t}
                  size="small"
                  label={t}
                  onClick={() => setForm({ ...form, tone: t })}
                  sx={{
                    fontSize: '0.6rem', cursor: 'pointer',
                    bgcolor: form.tone === t ? colors.accent.purple + '30' : 'transparent',
                    border: `1px solid ${form.tone === t ? colors.accent.purple : colors.border.default}`,
                  }}
                />
              ))}
            </Box>
          </Box>
          <TextField size="small" label="System Prompt" value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            fullWidth multiline rows={8} placeholder="You are a senior software architect who..." />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy} variant="contained" sx={{ bgcolor: colors.accent.purple, textTransform: 'none' }}>
            {form.id ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
