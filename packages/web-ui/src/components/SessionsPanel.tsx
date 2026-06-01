import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import AddIcon from '@mui/icons-material/Add';
import { sessions, type SessionInfo } from '../api';
import { colors } from '../theme';

export function SessionsPanel() {
  const [list, setList] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = () => { sessions.list().then(setList).catch(() => {}); };
  useEffect(load, []);

  const handleNew = async () => {
    try { await sessions.create(); load(); } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try { await sessions.delete(id); load(); } catch { /* ignore */ }
  };

  const handleRestore = async (id: string) => {
    try { await sessions.restore(id); } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Sessions</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ color: colors.accent.blue }}>
          New Session
        </Button>
      </Box>

      <List sx={{ flex: 1, overflow: 'auto' }}>
        {list.map((s) => (
          <ListItemButton
            key={s.id}
            selected={selected === s.id}
            onClick={() => setSelected(s.id)}
            sx={{ borderRadius: 1, mb: 0.5, border: `1px solid ${colors.border.default}` }}
          >
            <ListItemText
              primary={s.title ?? `Session ${s.id.slice(0, 8)}`}
              secondary={`${s.messageCount} msgs • ${s.tokensUsed} tokens • ${s.model}`}
              primaryTypographyProps={{ fontSize: '0.85rem' }}
              secondaryTypographyProps={{ fontSize: '0.7rem', color: colors.text.dim }}
            />
            <Chip size="small" label={new Date(s.createdAt).toLocaleDateString()} sx={{ mr: 1, fontSize: '0.6rem' }} />
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleRestore(s.id); }} sx={{ color: colors.accent.blue }}>
              <RestoreIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} sx={{ color: colors.accent.red }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </ListItemButton>
        ))}
        {list.length === 0 && (
          <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>
            No sessions yet
          </Typography>
        )}
      </List>
    </Box>
  );
}
