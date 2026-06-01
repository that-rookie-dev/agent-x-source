import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import LinearProgress from '@mui/material/LinearProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { rag, type RAGResult } from '../api';
import { colors } from '../theme';

export function RAGPanel() {
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
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Indexing failed');
    } finally {
      setLoading(false);
    }
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
    try {
      await rag.clear();
      setSearchResults([]);
      loadStatus();
      setMessage('RAG store cleared');
    } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">RAG Knowledge Base</Typography>
        {status && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Chip size="small" label={status.enabled ? 'Enabled' : 'Disabled'} sx={{ fontSize: '0.6rem', color: status.enabled ? colors.accent.green : colors.text.dim }} />
            <Chip size="small" label={`${status.chunkCount} chunks`} sx={{ fontSize: '0.6rem' }} />
          </Box>
        )}
      </Box>

      {message && <Alert severity={message.includes('fail') ? 'error' : 'success'} sx={{ mb: 2 }}>{message}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Index Section */}
      <Box sx={{ mb: 3, p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>
          <UploadFileIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          Index Document
        </Typography>
        <TextField
          fullWidth multiline rows={4} placeholder="Paste content to index..."
          value={indexContent} onChange={(e) => setIndexContent(e.target.value)} sx={{ mb: 1 }}
        />
        <TextField
          fullWidth size="small" placeholder="Metadata (key=value, key2=value2)"
          value={indexMeta} onChange={(e) => setIndexMeta(e.target.value)} sx={{ mb: 1 }}
        />
        <Button size="small" variant="contained" onClick={handleIndex} disabled={loading || !indexContent.trim()}
          sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
          Index
        </Button>
      </Box>

      {/* Search Section */}
      <Box sx={{ mb: 3, p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>
          <SearchIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          Search
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField fullWidth size="small" placeholder="Search query..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <Button size="small" variant="contained" onClick={handleSearch} disabled={loading}
            sx={{ bgcolor: colors.accent.blue }}>
            Search
          </Button>
        </Box>

        {searchResults.length > 0 && (
          <List dense>
            {searchResults.map((r, i) => (
              <ListItem key={i} sx={{ border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 0.5 }}>
                <ListItemText
                  primary={r.content.slice(0, 200) + (r.content.length > 200 ? '...' : '')}
                  secondary={`Score: ${r.score.toFixed(3)}${r.metadata ? ' • ' + Object.entries(r.metadata).map(([k, v]) => `${k}: ${v}`).join(', ') : ''}`}
                  primaryTypographyProps={{ fontSize: '0.8rem' }}
                  secondaryTypographyProps={{ fontSize: '0.65rem', color: colors.text.dim }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* Danger Zone */}
      <Box sx={{ p: 2, border: `1px solid ${colors.accent.red}30`, borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, color: colors.accent.red }}>Danger Zone</Typography>
        <Button size="small" variant="outlined" startIcon={<DeleteIcon />} onClick={handleClear}
          sx={{ borderColor: colors.accent.red, color: colors.accent.red }}>
          Clear All RAG Data
        </Button>
      </Box>
    </Box>
  );
}
