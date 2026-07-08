import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Modal from '@mui/material/Modal';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import FolderIcon from '@mui/icons-material/Folder';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import HomeIcon from '@mui/icons-material/Home';
import { system } from '../api';
import { colors, alphaColor } from '../theme';

interface Props {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function FolderPickerModal({ open, onSelect, onCancel }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDirs = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const result = await system.dirs(path);
      setCurrentPath(result.current);
      setDirs(result.dirs);
      setParentPath(result.parent);
    } catch {
      setDirs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) loadDirs(); }, [open, loadDirs]);

  return (
    <Modal open={open} onClose={onCancel}>
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 480, maxHeight: '70vh', bgcolor: colors.bg.secondary,
        border: `1px solid ${colors.border.default}`, borderRadius: 2,
        boxShadow: 24, display: 'flex', flexDirection: 'column', outline: 'none',
      }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border.default}`, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FolderIcon sx={{ fontSize: 16, color: colors.accent.blue }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentPath || 'Loading...'}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', p: 0.5 }}>
          <List dense disablePadding>
            {parentPath && (
              <ListItemButton onClick={() => loadDirs(parentPath)} sx={{ borderRadius: 1, mb: 0.25 }}>
                <ArrowUpwardIcon sx={{ fontSize: 16, mr: 1, color: colors.text.dim }} />
                <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>.. (parent)</Typography>
              </ListItemButton>
            )}
            <ListItemButton onClick={() => loadDirs()} sx={{ borderRadius: 1, mb: 0.25 }}>
              <HomeIcon sx={{ fontSize: 16, mr: 1, color: colors.text.dim }} />
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>Home</Typography>
            </ListItemButton>
            {loading ? (
              <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, textAlign: 'center', py: 4 }}>Loading...</Typography>
            ) : dirs.length === 0 ? (
              <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, textAlign: 'center', py: 4 }}>No subdirectories</Typography>
            ) : (
              dirs.map((d) => (
                <ListItemButton key={d.path} onClick={() => loadDirs(d.path)} sx={{ borderRadius: 1, mb: 0.25 }}>
                  <FolderIcon sx={{ fontSize: 16, mr: 1, color: alphaColor(colors.accent.blue, '80') }} />
                  <Typography sx={{ fontSize: '0.7rem', color: colors.text.primary }}>{d.name}</Typography>
                </ListItemButton>
              ))
            )}
          </List>
        </Box>

        <Box sx={{ px: 2, py: 1, borderTop: `1px solid ${colors.border.default}`, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onCancel} sx={{ fontSize: '0.65rem', color: colors.text.dim, textTransform: 'none' }}>Cancel</Button>
          <Button size="small" variant="contained" onClick={() => onSelect(currentPath)}
            sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: colors.accent.blue, '&:hover': { bgcolor: alphaColor(colors.accent.blue, 'cc') } }}>
            Select Folder
          </Button>
        </Box>
      </Box>
    </Modal>
  );
}
