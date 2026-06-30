import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import LinearProgress from '@mui/material/LinearProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import UploadIcon from '@mui/icons-material/Upload';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SchoolIcon from '@mui/icons-material/School';
import { PanelHeader } from './PanelHeader';
import { rag, type RAGResult } from '../api';
import { colors } from '../theme';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export function KnowledgePanel() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Knowledge Base"
        subtitle="Files, context, and RAG search for agent knowledge"
        icon={<SchoolIcon sx={{ fontSize: 20 }} />}
      />
      <Box sx={{ px: 2, borderBottom: `1px solid ${colors.border.default}` }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{
          minHeight: 32,
          '& .MuiTab-root': { minHeight: 32, fontSize: '0.7rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace" },
          '& .MuiTabs-indicator': { bgcolor: colors.accent.blue },
        }}>
          <Tab label="Files & Context" />
          <Tab label="RAG Search" />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tab === 0 && <FilesTab />}
        {tab === 1 && <RAGTab />}
      </Box>
    </Box>
  );
}

// ─── Files Tab ───

function FilesTab() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/files', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFiles(Array.isArray(data) ? data : data.files ?? []);
      }
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/files/upload', { method: 'POST', credentials: 'include', body: form });
      if (res.ok) load();
    } catch { /* ignore */ }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleDelete = async (id: string) => {
    try { await fetch(`/api/files/${id}`, { method: 'DELETE', credentials: 'include' }); load(); } catch { /* ignore */ }
  };

  const handleDownload = (id: string, name: string) => {
    const a = document.createElement('a');
    a.href = `/api/files/${id}`;
    a.download = name;
    a.click();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>
          Upload files to provide context to Agent-X. Files are auto-indexed for RAG.
        </Typography>
        <Button size="small" startIcon={<UploadIcon sx={{ fontSize: 14 }} />} onClick={() => fileInputRef.current?.click()}
          sx={{ color: colors.accent.blue, fontSize: '0.65rem', textTransform: 'none' }}>
          Upload
        </Button>
        <input ref={fileInputRef} type="file" hidden onChange={handleUpload} />
      </Box>

      {uploading && <LinearProgress sx={{ mb: 2 }} />}

      <List disablePadding>
        {files.map((f) => (
          <ListItem key={f.id} sx={{ border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 0.5, px: 1.5, py: 0.5 }}
            secondaryAction={
              <Box>
                <IconButton size="small" onClick={() => handleDownload(f.id, f.name)} sx={{ color: colors.accent.blue }}>
                  <DownloadIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <IconButton size="small" onClick={() => handleDelete(f.id)} sx={{ color: colors.accent.red }}>
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            }
          >
            <InsertDriveFileIcon sx={{ fontSize: 16, color: colors.text.dim, mr: 1 }} />
            <ListItemText
              primary={f.name}
              secondary={`${formatSize(f.size)} • ${f.type} • ${new Date(f.uploadedAt).toLocaleDateString()}`}
              primaryTypographyProps={{ fontSize: '0.75rem' }}
              secondaryTypographyProps={{ fontSize: '0.6rem', color: colors.text.dim }}
            />
          </ListItem>
        ))}
      </List>

      {files.length === 0 && !uploading && (
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <InsertDriveFileIcon sx={{ fontSize: 36, color: colors.text.dim, mb: 1 }} />
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim }}>No files uploaded yet</Typography>
        </Box>
      )}
    </Box>
  );
}

// ─── RAG Tab ───

function RAGTab() {
  const [status, setStatus] = useState<{ enabled: boolean; chunkCount: number } | null>(null);
  const [indexContent, setIndexContent] = useState('');
  const [indexMeta, setIndexMeta] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RAGResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadStatus = () => { rag.status().then(setStatus).catch(() => {}); };
  useEffect(loadStatus, []);

  const handleIndex = async () => {
    if (!indexContent.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const metadata = indexMeta.trim() ? Object.fromEntries(indexMeta.split(',').map((p) => p.split('=').map((s) => s.trim()))) : undefined;
      await rag.index(indexContent, metadata);
      setMessage('Document indexed successfully');
      setIndexContent('');
      setIndexMeta('');
      loadStatus();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Indexing failed'); }
    finally { setLoading(false); }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const results = await rag.search(searchQuery, 10);
      setSearchResults(results);
    } catch { setSearchResults([]); }
    finally { setLoading(false); }
  };

  const handleClear = async () => {
    try { await rag.clear(); setSearchResults([]); loadStatus(); setMessage('RAG store cleared'); } catch { /* ignore */ }
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {status && (
          <>
            <Chip size="small" label={status.enabled ? 'Enabled' : 'Disabled'} sx={{ fontSize: '0.55rem', height: 18, color: status.enabled ? colors.accent.green : colors.text.dim }} />
            <Chip size="small" label={`${status.chunkCount} chunks`} sx={{ fontSize: '0.55rem', height: 18 }} />
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<DeleteIcon sx={{ fontSize: 12 }} />} onClick={handleClear}
          sx={{ fontSize: '0.6rem', textTransform: 'none', borderColor: colors.accent.red, color: colors.accent.red }}>
          Clear
        </Button>
      </Box>

      {message && <Alert severity={message.includes('fail') ? 'error' : 'success'} sx={{ mb: 2, fontSize: '0.7rem' }}>{message}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Index */}
      <Box sx={{ mb: 2, p: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.secondary, mb: 1 }}>Index Document</Typography>
        <TextField fullWidth multiline rows={3} placeholder="Paste content to index..." size="small"
          value={indexContent} onChange={(e) => setIndexContent(e.target.value)} sx={{ mb: 1 }} />
        <TextField fullWidth size="small" placeholder="Metadata (key=value, key2=value2)"
          value={indexMeta} onChange={(e) => setIndexMeta(e.target.value)} sx={{ mb: 1 }} />
        <Button size="small" variant="contained" onClick={handleIndex} disabled={loading || !indexContent.trim()}
          sx={{ bgcolor: colors.accent.blue, fontSize: '0.65rem', textTransform: 'none' }}>
          Index
        </Button>
      </Box>

      {/* Search */}
      <Box sx={{ p: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.secondary, mb: 1 }}>
          <SearchIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: 'middle' }} />
          Search Knowledge
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField fullWidth size="small" placeholder="Search query..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }} />
          <Button size="small" variant="contained" onClick={handleSearch} disabled={loading}
            sx={{ bgcolor: colors.accent.blue, fontSize: '0.65rem', textTransform: 'none' }}>
            Search
          </Button>
        </Box>

        {searchResults.length > 0 && (
          <List dense disablePadding>
            {searchResults.map((r, i) => (
              <ListItem key={i} sx={{ border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 0.5, px: 1 }}>
                <ListItemText
                  primary={r.content.slice(0, 200) + (r.content.length > 200 ? '...' : '')}
                  secondary={`Score: ${r.score.toFixed(3)}`}
                  primaryTypographyProps={{ fontSize: '0.7rem' }}
                  secondaryTypographyProps={{ fontSize: '0.6rem', color: colors.text.dim }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
