import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { mcp, type MCPServer } from '../api';
import { colors } from '../theme';

export function MCPPanel() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');

  const load = () => { mcp.servers().then(setServers).catch(() => {}); };
  useEffect(load, []);

  const handleAdd = async () => {
    if (!newName || !newCommand) return;
    try {
      await mcp.add({ name: newName, command: newCommand, args: newArgs ? newArgs.split(' ') : undefined });
      setDialogOpen(false);
      setNewName(''); setNewCommand(''); setNewArgs('');
      load();
    } catch { /* ignore */ }
  };

  const handleRestart = async (id: string) => {
    try { await mcp.restart(id); load(); } catch { /* ignore */ }
  };

  const handleRemove = async (id: string) => {
    try { await mcp.remove(id); load(); } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">MCP Servers</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)} sx={{ color: colors.accent.blue }}>
          Add Server
        </Button>
      </Box>

      {servers.map((s) => (
        <Box key={s.id} sx={{ p: 2, mb: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.name}</Typography>
            <Typography variant="caption" sx={{ color: colors.text.dim }}>{s.command ?? `${s.host}:${s.port}`}</Typography>
            {s.toolCount !== undefined && <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>{s.toolCount} tools</Typography>}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip size="small" label={s.status} sx={{
              fontSize: '0.6rem', textTransform: 'uppercase',
              color: s.status === 'running' ? colors.accent.green : s.status === 'error' ? colors.accent.red : colors.text.dim,
              borderColor: s.status === 'running' ? colors.accent.green : s.status === 'error' ? colors.accent.red : colors.text.dim,
              variant: 'outlined',
            }} />
            <IconButton size="small" onClick={() => handleRestart(s.id)} sx={{ color: colors.accent.blue }}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton size="small" onClick={() => handleRemove(s.id)} sx={{ color: colors.accent.red }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
      ))}

      {servers.length === 0 && (
        <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>No MCP servers configured</Typography>
      )}

      {/* Add Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}` } }}>
        <DialogTitle>Add MCP Server</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important', minWidth: 350 }}>
          <TextField label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} fullWidth />
          <TextField label="Command" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} fullWidth placeholder="e.g. npx -y @mcp/server" />
          <TextField label="Args (space-separated)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
