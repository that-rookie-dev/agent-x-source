import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

interface Toast {
  id: number;
  type: 'error' | 'warning' | 'escalation' | 'checkpoint' | 'automation';
  message: string;
  timestamp: number;
}

let _addToast: ((t: Omit<Toast, 'id' | 'timestamp'>) => void) | null = null;

export function notify(type: Toast['type'], message: string) {
  _addToast?.({ type, message });
}

export function NotificationToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const addToast = useCallback((t: Omit<Toast, 'id' | 'timestamp'>) => {
    const id = nextId++;
    setToasts(prev => [...prev.slice(-4), { ...t, id, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 8000);
  }, []);

  useEffect(() => {
    _addToast = addToast;
    return () => { _addToast = null; };
  }, [addToast]);

  const dismiss = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  const colorMap: Record<Toast['type'], string> = {
    error: '#ff6b6b',
    warning: '#e0e0e0',
    escalation: '#ff6b6b',
    checkpoint: '#e0e0e0',
    automation: '#ffffff',
  };

  const labelMap: Record<Toast['type'], string> = {
    error: 'ERROR',
    warning: 'WARNING',
    escalation: 'ESCALATED',
    checkpoint: 'CHECKPOINT',
    automation: 'AUTOMATION',
  };

  return (
    <Box sx={{
      position: 'fixed', bottom: 48, right: 16, zIndex: 1400,
      display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 400,
      pointerEvents: 'none',
      '& > *': { pointerEvents: 'auto' },
    }}>
      {toasts.map(t => (
        <Box key={t.id} sx={{
          p: 1.5, borderRadius: 1,
          bgcolor: '#0d0d0d',
          border: '1px solid #2a2a2a',
          boxShadow: '0 8px 32px rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'flex-start', gap: 1,
          animation: 'slideIn 0.3s ease',
          '@keyframes slideIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: colorMap[t.type], fontSize: '0.58rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", mb: 0.3, letterSpacing: '0.08em' }}>
              {labelMap[t.type]}
            </Typography>
            <Typography sx={{ color: '#e8e8e8', fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {t.message}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => dismiss(t.id)}
            sx={{ color: '#666', p: 0, '&:hover': { color: '#fff' } }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
