import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import UploadIcon from '@mui/icons-material/Upload';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { colors } from '../theme';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export function FilesPanel() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/files', { credentials: 'include' });
      if (res.ok) setFiles(await res.json());
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
    try {
      await fetch(`/api/files/${id}`, { method: 'DELETE', credentials: 'include' });
      load();
    } catch { /* ignore */ }
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
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Files</Typography>
        <Button size="small" startIcon={<UploadIcon />} onClick={() => fileInputRef.current?.click()} sx={{ color: colors.accent.blue }}>
          Upload
        </Button>
        <input ref={fileInputRef} type="file" hidden onChange={handleUpload} />
      </Box>

      {uploading && <LinearProgress sx={{ mb: 2 }} />}

      <List>
        {files.map((f) => (
          <ListItem key={f.id} sx={{ border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 0.5 }}
            secondaryAction={
              <Box>
                <IconButton size="small" onClick={() => handleDownload(f.id, f.name)} sx={{ color: colors.accent.blue }}>
                  <DownloadIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <IconButton size="small" onClick={() => handleDelete(f.id)} sx={{ color: colors.accent.red }}>
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            }
          >
            <InsertDriveFileIcon sx={{ fontSize: 20, color: colors.text.dim, mr: 1.5 }} />
            <ListItemText
              primary={f.name}
              secondary={`${formatSize(f.size)} • ${f.type} • ${new Date(f.uploadedAt).toLocaleDateString()}`}
              primaryTypographyProps={{ fontSize: '0.85rem' }}
              secondaryTypographyProps={{ fontSize: '0.65rem', color: colors.text.dim }}
            />
            <Chip size="small" label={f.type.split('/')[1] ?? f.type} sx={{ mr: 2, fontSize: '0.55rem', height: 18 }} />
          </ListItem>
        ))}
      </List>

      {files.length === 0 && !uploading && (
        <Box sx={{ textAlign: 'center', mt: 6 }}>
          <InsertDriveFileIcon sx={{ fontSize: 48, color: colors.text.dim, mb: 1 }} />
          <Typography variant="body2" sx={{ color: colors.text.dim }}>No files uploaded yet</Typography>
          <Typography variant="caption" sx={{ color: colors.text.dim }}>Upload files to provide context to Agent-X (max 50MB)</Typography>
        </Box>
      )}
    </Box>
  );
}
