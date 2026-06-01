import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import { todos, type TodoItem } from '../api';
import { colors } from '../theme';

export function TodoPanel() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    todos.list().then(setItems).catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    const item: TodoItem = { id: crypto.randomUUID(), title: newTitle.trim(), status: 'not-started' };
    const updated = [...items, item];
    setItems(updated);
    setNewTitle('');
    try { await todos.save(updated); } catch { /* ignore */ }
  };

  const handleToggle = async (id: string) => {
    const updated = items.map((i) => {
      if (i.id !== id) return i;
      const nextStatus = i.status === 'not-started' ? 'in-progress' : i.status === 'in-progress' ? 'completed' : 'not-started';
      return { ...i, status: nextStatus } as TodoItem;
    });
    setItems(updated);
    try { await todos.save(updated); } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    const updated = items.filter((i) => i.id !== id);
    setItems(updated);
    try { await todos.save(updated); } catch { /* ignore */ }
  };

  const statusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed': return <CheckCircleIcon sx={{ fontSize: 18, color: colors.accent.green }} />;
      case 'in-progress': return <PlayCircleIcon sx={{ fontSize: 18, color: colors.accent.orange }} />;
      default: return <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: colors.text.dim }} />;
    }
  };

  const completedCount = items.filter((i) => i.status === 'completed').length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Todos</Typography>
        <Chip size="small" label={`${completedCount}/${items.length}`} sx={{ fontSize: '0.65rem' }} />
      </Box>

      {/* Add new */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          placeholder="Add a task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          fullWidth
        />
        <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} sx={{ color: colors.accent.blue }}>Add</Button>
      </Box>

      {/* List */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {items.map((item) => (
          <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${colors.border.default}` }}>
            <IconButton size="small" onClick={() => handleToggle(item.id)}>
              {statusIcon(item.status)}
            </IconButton>
            <Typography variant="body2" sx={{
              flex: 1, fontSize: '0.85rem',
              textDecoration: item.status === 'completed' ? 'line-through' : 'none',
              color: item.status === 'completed' ? colors.text.dim : colors.text.primary,
            }}>
              {item.title}
            </Typography>
            <IconButton size="small" onClick={() => handleDelete(item.id)} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ))}
        {items.length === 0 && (
          <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>No tasks yet</Typography>
        )}
      </Box>
    </Box>
  );
}
