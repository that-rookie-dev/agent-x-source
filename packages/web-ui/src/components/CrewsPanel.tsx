import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import HubIcon from '@mui/icons-material/Hub';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { crews as crewsApi, crewChat, type Crew, type CrewInput } from '../api';
import { CrewCard } from './crew/CrewCard';
import { CrewScreenHeader } from './crew/CrewScreenHeader';
import { CrewHubDialog, type PrebuiltCategory, type PrebuiltCrew } from './crew/CrewHubDialog';
import { CrewProfileDialog } from './crew/CrewProfileDialog';
import { crewTheme, getCrewAccent } from '../styles/crew-theme';
import { loadHubCategoryIndex, ensureHubCategoryCrews, prefetchHubCatalog } from '../data/crew-hub/loadHubCatalog';

import { colors, alphaColor } from '../theme';
const EMOTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'sarcastic', 'arrogant', 'flirty', 'happy', 'sad'] as const;

const SYSTEM_PROMPT_PLACEHOLDER = `You are a [role] specializing in [domain].

Your expertise:
- [skill 1]
- [skill 2]

Communication style: [concise/verbose/technical/casual]
Always respond with practical, actionable advice.`;

interface FormState {
  name: string;
  title: string;
  callsign: string;
  description: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
}

const EMPTY_FORM: FormState = { name: '', title: '', callsign: '', description: '', systemPrompt: '', tone: 'professional', expertise: [], traits: [] };

function toCallsign(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function crewToProfile(crew: Crew): PrebuiltCrew {
  return {
    name: crew.name,
    title: crew.title ?? '',
    callsign: crew.callsign,
    description: crew.description,
    systemPrompt: crew.systemPrompt,
    tone: crew.tone ?? 'professional',
    expertise: crew.expertise ?? [],
    traits: crew.traits ?? [],
    catalogId: crew.catalogId ?? (crew.callsign ? `hub-${crew.callsign}` : undefined),
    categoryId: crew.categoryId,
    requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
    honorsDoctorate: crew.honorsDoctorate,
  };
}

export function CrewsPanel() {
  const navigate = useNavigate();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [detailCrew, setDetailCrew] = useState<Crew | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generatingMeta, setGeneratingMeta] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCategory, setImportCategory] = useState(0);
  const [hubCategories, setHubCategories] = useState<PrebuiltCategory[]>([]);
  const [hubCategoriesLoading, setHubCategoriesLoading] = useState(false);
  const [hubSectorLoading, setHubSectorLoading] = useState(false);
  const [hubCategoriesError, setHubCategoriesError] = useState('');
  const [importLoading, setImportLoading] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [traitInput, setTraitInput] = useState('');
  const [privateChatLoading, setPrivateChatLoading] = useState(false);
  const importGuardRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await crewsApi.list();
      const seen = new Set<string>();
      setCrews(list.filter((c) => {
        const key = c.callsign.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crews');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!importDialogOpen || hubCategories.length > 0) return;

    let cancelled = false;
    setHubCategoriesLoading(true);
    setHubCategoriesError('');

    loadHubCategoryIndex()
      .then((categories) => {
        if (!cancelled) {
          setHubCategories(categories);
          const firstId = categories[importCategory]?.id ?? categories[0]?.id;
          prefetchHubCatalog(firstId);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setHubCategoriesError(e instanceof Error ? e.message : 'Failed to load Crew Hub');
        }
      })
      .finally(() => {
        if (!cancelled) setHubCategoriesLoading(false);
      });

    return () => { cancelled = true; };
  }, [importDialogOpen, hubCategories.length]);

  const activeSectorCrewCount = hubCategories[importCategory]?.crews.length ?? 0;

  useEffect(() => {
    if (!importDialogOpen || hubCategories.length === 0) return;
    if (activeSectorCrewCount > 0) return;

    let cancelled = false;
    setHubSectorLoading(true);

    ensureHubCategoryCrews(hubCategories, importCategory)
      .then((categories) => {
        if (!cancelled) setHubCategories(categories);
      })
      .catch((e) => {
        if (!cancelled) {
          setHubCategoriesError(e instanceof Error ? e.message : 'Failed to load sector crews');
        }
      })
      .finally(() => {
        if (!cancelled) setHubSectorLoading(false);
      });

    return () => { cancelled = true; };
  }, [importDialogOpen, importCategory, hubCategories, activeSectorCrewCount]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try { await crewsApi.toggle(id, enabled); await load(); setDetailCrew(prev => prev?.id === id ? { ...prev, enabled } : prev); }
    catch (e) { setError(e instanceof Error ? e.message : 'Toggle failed'); }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try { await crewsApi.delete(id); setDetailCrew(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); setDeleteConfirmId(null); }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setDialogOpen(true);
    setExpertiseInput('');
    setTraitInput('');
  };

  const openEdit = (c: Crew) => {
    setForm({ name: c.name, title: c.title ?? '', callsign: c.callsign, description: c.description ?? '', systemPrompt: c.systemPrompt, tone: c.tone ?? 'professional', expertise: c.expertise ?? [], traits: c.traits ?? [] });
    setIsEditing(true);
    setDialogOpen(true);
    setExpertiseInput('');
    setTraitInput('');
  };

  const handleGenerateMetadata = async () => {
    const hasInput = form.name.trim() && form.title.trim();
    if (!hasInput) { setError('Name and title are required to auto-generate.'); return; }
    setGeneratingMeta(true);
    try {
      const meta = await crewsApi.generateMetadata(
        form.systemPrompt || undefined,
        form.title || undefined,
        form.name,
        form.description
      );
      setForm((prev) => ({
        ...prev,
        expertise: meta.expertise,
        traits: meta.traits,
        systemPrompt: meta.revisedPrompt || prev.systemPrompt,
      }));
    } catch {
      setError('Failed to generate skills. You can add them manually.');
    } finally {
      setGeneratingMeta(false);
    }
  };

  const handleRegenerateCrew = async (c: Crew, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRegenerating(c.id);
    try {
      const meta = await crewsApi.generateMetadata(c.systemPrompt, c.title || undefined, c.name, c.description);
      await crewsApi.update(c.id, { expertise: meta.expertise, traits: meta.traits, systemPrompt: meta.revisedPrompt || c.systemPrompt });
      await load();
      if (detailCrew?.id === c.id) {
        setDetailCrew({ ...c, expertise: meta.expertise, traits: meta.traits, systemPrompt: meta.revisedPrompt || c.systemPrompt });
      }
    } catch {
      setError('Regeneration failed. Check your model quota or API key.');
    } finally {
      setRegenerating(null);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.systemPrompt.trim()) { setError('System prompt is required'); return; }
    setBusy(true);
    setError('');
    try {
      const callsign = form.callsign.trim() || toCallsign(form.name);
      const payload: CrewInput = { name: form.name.trim(), title: form.title.trim() || undefined, callsign, systemPrompt: form.systemPrompt.trim(), description: form.description.trim() || undefined, tone: form.tone, expertise: form.expertise, traits: form.traits };
      if (isEditing && detailCrew?.id) {
        await crewsApi.update(detailCrew.id, payload);
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

  const handleNameChange = (name: string) => {
    const callsign = form.callsign.trim() ? form.callsign : toCallsign(name);
    setForm({ ...form, name, callsign: form.callsign.trim() ? form.callsign : callsign });
  };

  const handleImportCrew = async (crew: PrebuiltCrew) => {
    if (importGuardRef.current.has(crew.callsign)) return;
    if (crews.some((c) => c.callsign.toLowerCase() === crew.callsign.toLowerCase())) return;

    importGuardRef.current.add(crew.callsign);
    setImportLoading(crew.callsign);
    try {
      await crewsApi.create({
        id: `hub-${crew.callsign}`,
        name: crew.name,
        title: crew.title,
        callsign: crew.callsign,
        systemPrompt: crew.systemPrompt,
        description: crew.description || undefined,
        tone: crew.tone,
        source: 'hub',
        catalogId: `hub-${crew.callsign}`,
        expertise: crew.expertise,
        traits: crew.traits,
        tools: crew.tools,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      importGuardRef.current.delete(crew.callsign);
      setImportLoading(null);
    }
  };

  const startPrivateChat = async (opts: { crewId?: string; recruit?: PrebuiltCrew }) => {
    setPrivateChatLoading(true);
    setError('');
    try {
      const body = opts.recruit
        ? {
            crewId: opts.crewId,
            recruit: {
              id: `hub-${opts.recruit.callsign}`,
              name: opts.recruit.name,
              title: opts.recruit.title,
              callsign: opts.recruit.callsign,
              systemPrompt: opts.recruit.systemPrompt,
              description: opts.recruit.description || undefined,
              tone: opts.recruit.tone,
              source: 'hub',
              catalogId: opts.recruit.catalogId ?? `hub-${opts.recruit.callsign}`,
              categoryId: opts.recruit.categoryId,
              expertise: opts.recruit.expertise,
              traits: opts.recruit.traits,
              tools: opts.recruit.tools,
            },
          }
        : { crewId: opts.crewId! };
      const result = await crewChat.startSession(body);
      await load();
      setDetailCrew(null);
      navigate(`/console/chat/${result.sessionId}`, { state: { fromCrews: true } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start private chat');
    } finally {
      setPrivateChatLoading(false);
    }
  };

  const filtered = crews.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.callsign.toLowerCase().includes(search.toLowerCase()));
  const activeCount = crews.filter((c) => c.enabled !== false).length;

  return (
    <Box sx={{
      height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      bgcolor: crewTheme.bg.void,
    }}>
      <CrewScreenHeader
        crewCount={crews.length}
        activeCount={activeCount}
        onOpenHub={() => { setImportDialogOpen(true); setImportCategory(0); }}
        onCreate={openCreate}
      />

      {error && (
        <Box sx={{ px: 2.5, pb: 0.5 }}>
          <Alert severity="error" sx={{ bgcolor: crewTheme.bg.card, fontSize: '0.7rem', border: `1px solid ${crewTheme.border.danger}` }} onClose={() => setError('')}>{error}</Alert>
        </Box>
      )}

      <Box sx={{ flexShrink: 0, px: 2.5, pt: 1.5, pb: 1 }}>
        <TextField
          size="small" placeholder="SCAN ROSTER — name or callsign..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 15, color: crewTheme.text.dim }} /></InputAdornment>,
            sx: {
              fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
              bgcolor: crewTheme.bg.card, borderRadius: '4px',
            },
          }}
          sx={{
            width: '100%', maxWidth: 340,
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: crewTheme.border.default },
              '&:hover fieldset': { borderColor: crewTheme.border.strong },
              '&.Mui-focused fieldset': { borderColor: crewTheme.accent.tactical },
            },
          }}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, pb: 2.5 }}>
        {crews.length === 0 ? (
          <Box sx={{
            p: 5, textAlign: 'center', mt: 2,
            border: `1px dashed ${crewTheme.border.default}`,
            borderRadius: '8px', bgcolor: crewTheme.bg.panel,
            position: 'relative', overflow: 'hidden',
          }}>
            <Box sx={{
              position: 'absolute', inset: 0, opacity: 0.03,
              backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, ${alphaColor(colors.ink, 0.2)} 3px, ${alphaColor(colors.ink, 0.2)} 4px)`,
            }} />
            <GroupsIcon sx={{ fontSize: 40, color: crewTheme.text.dim, mb: 1.5 }} />
            <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: crewTheme.text.secondary, mb: 0.5, letterSpacing: '1px' }}>
              ROSTER EMPTY
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.dim, mb: 2 }}>
              Recruit personnel from Crew Hub or create a custom operative
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button size="small" variant="outlined" startIcon={<HubIcon sx={{ fontSize: 5.4 }} />}
                onClick={() => { setImportDialogOpen(true); setImportCategory(0); }}
                sx={{ borderColor: crewTheme.border.strong, color: crewTheme.accent.hud, fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace" }}>
                CREW HUB
              </Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />}
                onClick={openCreate}
                sx={{ bgcolor: crewTheme.accent.tactical, color: crewTheme.bg.void, fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                RECRUIT
              </Button>
            </Box>
          </Box>
        ) : filtered.length === 0 && search ? (
          <Box sx={{ p: 4, textAlign: 'center', mt: 2 }}>
            <Typography sx={{ fontSize: '0.7rem', color: crewTheme.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              NO MATCH — "{search}"
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${crewTheme.grid.minCard}px, 1fr))`,
            gap: `${crewTheme.grid.gap}px`,
            mt: 0.5,
          }}>
            {filtered.map((c) => (
              <CrewCard
                key={c.id}
                crew={c}
                regenerating={regenerating === c.id}
                onOpen={setDetailCrew}
                onPrivateChat={(crew) => startPrivateChat({ crewId: crew.id })}
                privateChatLoading={privateChatLoading}
                onToggle={handleToggle}
                onEdit={openEdit}
                onDelete={setDeleteConfirmId}
                onRegenerate={(e, crew) => handleRegenerateCrew(crew, e)}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Classified personnel file — roster detail */}
      <CrewProfileDialog
        open={!!detailCrew}
        crew={detailCrew ? crewToProfile(detailCrew) : null}
        imported
        importLoading={false}
        onClose={() => setDetailCrew(null)}
        onImport={() => {}}
        onRemove={() => {}}
        accentColor={detailCrew ? getCrewAccent(detailCrew.color, detailCrew.callsign) : undefined}
        rosterActions={detailCrew ? {
          enabled: detailCrew.enabled !== false,
          onToggle: (enabled) => handleToggle(detailCrew.id, enabled),
          onEdit: () => { const c = detailCrew; setDetailCrew(null); openEdit(c); },
          onDelete: () => setDeleteConfirmId(detailCrew.id),
          onRegenerate: () => handleRegenerateCrew(detailCrew),
          regenerating: regenerating === detailCrew.id,
        } : undefined}
        onPrivateChat={detailCrew ? () => startPrivateChat({ crewId: detailCrew.id }) : undefined}
        privateChatLoading={privateChatLoading}
      />

      {/* Create / Edit Modal */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}
        PaperProps={{ sx: {
          bgcolor: crewTheme.bg.panel,
          border: `1px solid ${crewTheme.border.default}`,
          borderRadius: '8px', maxWidth: 580, width: '100%',
        } }}>
        <DialogTitle sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.48rem',
          letterSpacing: '2px', textTransform: 'uppercase', color: crewTheme.text.dim, pb: 0, pt: 2,
        }}>
          {isEditing ? 'Modify Personnel' : 'New Recruitment'}
        </DialogTitle>
        <DialogTitle sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem',
          fontWeight: 700, letterSpacing: '1px', pt: 0.5, color: crewTheme.text.primary,
        }}>
          {isEditing ? 'EDIT CREW' : 'CREATE CREW'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <Box>
            <TextField size="small" label="Name" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              fullWidth placeholder="e.g. Raj Patel" />
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
              The crew member's full name. This is a person, not a job title.
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Title" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              fullWidth placeholder="e.g. Backend Architect" />
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
              Their role or specialization. Shown as "Name - Title" in @mentions.
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Callsign" value={form.callsign}
              onChange={(e) => setForm({ ...form, callsign: e.target.value.replace(/\s/g, '').toLowerCase() })}
              fullWidth placeholder="e.g. backend_architect" />
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
              Auto-generated from name. Unique handle for <Typography component="span" sx={{ fontSize: '0.55rem', color: crewTheme.accent.hud, fontFamily: "'JetBrains Mono', monospace" }}>@mentions</Typography> — no spaces.
            </Typography>
          </Box>

          <Box>
            <TextField size="small" label="Description" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth multiline rows={2}
              placeholder="A short description of this crew member's character and purpose"
              slotProps={{ input: { sx: { fontSize: '0.75rem', lineHeight: 1.5 } } }} />
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
              Optional. Concise identity summary for the crew member.
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, mb: 1, textTransform: 'uppercase', letterSpacing: '1px' }}>Tone / Emotion</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {EMOTIONS.map((t) => (
                <Chip key={t} size="small" label={t} onClick={() => setForm({ ...form, tone: t })}
                  sx={{ fontSize: '0.6rem', cursor: 'pointer', bgcolor: form.tone === t ? alphaColor(crewTheme.accent.purple, '30') : 'transparent', border: `1px solid ${form.tone === t ? crewTheme.accent.purple : crewTheme.border.default}`, color: form.tone === t ? crewTheme.accent.purple : crewTheme.text.secondary, '&:hover': { borderColor: alphaColor(crewTheme.accent.purple, '60'), bgcolor: alphaColor(crewTheme.accent.purple, '15') } }} />
              ))}
            </Box>
          </Box>

          <Box>
            <TextField size="small" label="System Prompt" value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              fullWidth multiline rows={8} placeholder={SYSTEM_PROMPT_PLACEHOLDER}
              sx={{ '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', lineHeight: 1.6 } }} />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim }}>
                Defines personality and behavior. Be specific about domain and skills.
              </Typography>
              <Button size="small" onClick={handleGenerateMetadata} disabled={generatingMeta || (!form.name.trim() || !form.title.trim())}
                startIcon={generatingMeta ? <CircularProgress size={12} /> : <AutoAwesomeIcon sx={{ fontSize: 13 }} />}
                sx={{ fontSize: '0.55rem', textTransform: 'none', color: crewTheme.accent.purple, minWidth: 'auto' }}>
                {generatingMeta ? 'Analyzing...' : 'Auto-generate'}
              </Button>
            </Box>
          </Box>

          {/* Expertise chips — always editable */}
          <Box>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: crewTheme.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>Skills & Expertise</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              {form.expertise.map((exp) => (
                <Chip key={exp} size="small" label={exp} onDelete={() => setForm({ ...form, expertise: form.expertise.filter((e) => e !== exp) })}
                  sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.hud, '15'), color: crewTheme.accent.hud }} />
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <TextField size="small" placeholder="Add skill..." value={expertiseInput}
                onChange={(e) => setExpertiseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && expertiseInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, expertise: [...form.expertise, expertiseInput.trim()] });
                    setExpertiseInput('');
                  }
                }}
                sx={{ flex: 1, '& .MuiInputBase-root': { height: 28, fontSize: '0.65rem' } }} />
              <Button size="small" variant="outlined" disabled={!expertiseInput.trim()}
                onClick={() => { setForm({ ...form, expertise: [...form.expertise, expertiseInput.trim()] }); setExpertiseInput(''); }}
                sx={{ minWidth: 'auto', px: 1, fontSize: '0.6rem', textTransform: 'none', borderColor: alphaColor(crewTheme.accent.hud, '50'), color: crewTheme.accent.hud, height: 28 }}>
                Add
              </Button>
            </Box>
          </Box>

          {/* Traits chips — always editable */}
          <Box>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: crewTheme.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>Traits</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              {form.traits.map((t) => (
                <Chip key={t} size="small" label={t} onDelete={() => setForm({ ...form, traits: form.traits.filter((tr) => tr !== t) })}
                  sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.purple, '10'), color: crewTheme.accent.purple }} />
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <TextField size="small" placeholder="Add trait..." value={traitInput}
                onChange={(e) => setTraitInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && traitInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, traits: [...form.traits, traitInput.trim()] });
                    setTraitInput('');
                  }
                }}
                sx={{ flex: 1, '& .MuiInputBase-root': { height: 28, fontSize: '0.65rem' } }} />
              <Button size="small" variant="outlined" disabled={!traitInput.trim()}
                onClick={() => { setForm({ ...form, traits: [...form.traits, traitInput.trim()] }); setTraitInput(''); }}
                sx={{ minWidth: 'auto', px: 1, fontSize: '0.6rem', textTransform: 'none', borderColor: alphaColor(crewTheme.accent.purple, '50'), color: crewTheme.accent.purple, height: 28 }}>
                Add
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, borderTop: `1px solid ${crewTheme.border.subtle}` }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: crewTheme.text.dim, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>CANCEL</Button>
          <Button onClick={handleSave} disabled={busy} variant="contained"
            sx={{ bgcolor: crewTheme.accent.tactical, color: crewTheme.bg.void, fontSize: '0.7rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", px: 2.5, '&:hover': { bgcolor: alphaColor(crewTheme.accent.tactical, 0.85) } }}>
            {busy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            {isEditing ? 'SAVE' : 'DEPLOY'}
          </Button>
        </DialogActions>
      </Dialog>

      <CrewHubDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        categories={hubCategories}
        categoriesLoading={hubCategoriesLoading}
        sectorCrewsLoading={hubSectorLoading}
        categoriesError={hubCategoriesError}
        categoryIndex={importCategory}
        onCategoryChange={setImportCategory}
        crews={crews}
        importLoading={importLoading}
        onImport={handleImportCrew}
        onRemove={(id) => handleDelete(id)}
        onPrivateChat={(crew, rosterCrewId) => {
          startPrivateChat({ crewId: rosterCrewId, recruit: crew });
        }}
        privateChatLoading={privateChatLoading}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}
        PaperProps={{ sx: {
          bgcolor: crewTheme.bg.panel,
          border: `1px solid ${crewTheme.border.danger}`,
          borderRadius: '8px', maxWidth: 400, width: '100%',
        } }}>
        <DialogTitle sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.48rem',
          letterSpacing: '2px', textTransform: 'uppercase', color: crewTheme.accent.alert, pb: 0, pt: 2,
        }}>
          Warning
        </DialogTitle>
        <DialogTitle sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem',
          fontWeight: 700, letterSpacing: '1px', pt: 0.5, color: crewTheme.text.primary,
        }}>
          DEACTIVATE CREW
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ fontSize: '0.75rem', color: crewTheme.text.secondary, lineHeight: 1.6 }}>
            {(() => {
              const c = crews.find((x) => x.id === deleteConfirmId);
              return c ? <>Are you sure you want to delete <strong>{c.name}</strong>{c.title ? ` (${c.title})` : ''}? This action cannot be undone.</> : 'Are you sure you want to delete this crew?';
            })()}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmId(null)} sx={{ color: crewTheme.text.dim, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>CANCEL</Button>
          <Button onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)} variant="contained" disabled={busy}
            sx={{ bgcolor: crewTheme.accent.alert, color: colors.text.primary, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", px: 2.5, '&:hover': { bgcolor: alphaColor(crewTheme.accent.alert, 0.85) } }}>
            {busy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            CONFIRM
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
