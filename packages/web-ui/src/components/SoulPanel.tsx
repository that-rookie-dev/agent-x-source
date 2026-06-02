import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { secretSauce, type SecretSauceFile } from '../api';
import { colors } from '../theme';

const FILES: { key: SecretSauceFile; label: string; description: string }[] = [
  { key: 'SOUL', label: 'Soul', description: 'Core personality, values, and behavioral DNA of the agent.' },
  { key: 'IDENTITY', label: 'Identity', description: 'Who the agent is — name, role, mission, self-concept.' },
  { key: 'DIARY', label: 'Diary', description: 'Long-form journaled reflections, ongoing thoughts.' },
  { key: 'MEMORIES', label: 'Memories', description: 'Persistent memories across sessions — facts the agent must never forget.' },
  { key: 'PERMISSION', label: 'Permissions', description: 'What the agent is allowed and not allowed to do.' },
  { key: 'CREW', label: 'Crew Doc', description: 'Crew roster, roles, and collaboration playbook.' },
];

export function SoulPanel() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});

  const active = FILES[activeIdx]!;

  const loadList = async () => {
    try {
      const files = await secretSauce.list();
      const s: Record<string, number> = {};
      files.forEach((f) => { s[f.file] = f.size; });
      setSizes(s);
    } catch { /* ignore */ }
  };

  const loadFile = async (file: SecretSauceFile) => {
    setLoading(true);
    setError('');
    try {
      const r = await secretSauce.get(file);
      setContent(r.content);
      setOriginal(r.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
      setContent('');
      setOriginal('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); }, []);
  useEffect(() => { loadFile(active.key); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeIdx]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await secretSauce.save(active.key, content);
      setOriginal(content);
      setSavedAt(Date.now());
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== original;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <AutoAwesomeIcon sx={{ color: colors.accent.purple }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 600 }}>Secret Sauce</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>
            The agent's soul, identity, memories, and permissions. Edit with care — these define behavior across every session.
          </Typography>
        </Box>
      </Box>

      <Tabs
        value={activeIdx}
        onChange={(_, v) => setActiveIdx(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: `1px solid ${colors.border.default}`, mb: 1.5, minHeight: 32 }}
      >
        {FILES.map((f) => (
          <Tab
            key={f.key}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span>{f.label}</span>
                {sizes[f.key] != null && sizes[f.key]! > 0 && (
                  <Chip size="small" label={`${sizes[f.key]} B`} sx={{ height: 14, fontSize: '0.45rem' }} />
                )}
              </Box>
            }
            sx={{ fontSize: '0.7rem', textTransform: 'none', minHeight: 32, px: 1.5 }}
          />
        ))}
      </Tabs>

      <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mb: 1 }}>{active.description}</Typography>

      {error && <Alert severity="error" sx={{ mb: 1, bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>}

      <TextField
        multiline
        fullWidth
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={loading}
        placeholder={loading ? 'Loading...' : `Define the agent's ${active.label.toLowerCase()} in markdown here...`}
        InputProps={{
          sx: {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.72rem',
            alignItems: 'flex-start',
            height: '100%',
            '& textarea': { height: '100% !important', overflow: 'auto !important' },
          },
        }}
        sx={{
          flex: 1, mb: 1.5,
          '& .MuiInputBase-root': { height: '100%' },
        }}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          startIcon={<SaveIcon sx={{ fontSize: 14 }} />}
          onClick={handleSave}
          disabled={saving || !dirty}
          variant="contained"
          sx={{ bgcolor: colors.accent.purple, textTransform: 'none', fontSize: '0.7rem' }}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button
          startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
          onClick={() => loadFile(active.key)}
          disabled={loading}
          sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.7rem' }}
        >
          Reload
        </Button>
        {dirty && <Chip size="small" label="Unsaved changes" sx={{ height: 18, fontSize: '0.55rem', color: colors.accent.orange, borderColor: colors.accent.orange + '60' }} variant="outlined" />}
        {!dirty && savedAt && <Chip size="small" label={`Saved · ${new Date(savedAt).toLocaleTimeString()}`} sx={{ height: 18, fontSize: '0.55rem', color: colors.accent.green, borderColor: colors.accent.green + '60' }} variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          {content.length} chars · {content.split('\n').length} lines
        </Typography>
      </Box>
    </Box>
  );
}
