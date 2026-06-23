import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { colors } from '../theme';

interface Toast {
  id: number;
  type: 'error' | 'warning' | 'escalation' | 'checkpoint';
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
    error: colors.accent.red,
    warning: colors.accent.orange,
    escalation: colors.accent.red,
    checkpoint: colors.accent.blue,
  };

  const labelMap: Record<Toast['type'], string> = {
    error: 'ERROR',
    warning: 'WARNING',
    escalation: 'ESCALATED',
    checkpoint: 'CHECKPOINT',
  };

  return (
    <Box sx={{
      position: 'fixed', bottom: 48, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 420,
    }}>
      {toasts.map(t => (
        <Box key={t.id} sx={{
          p: 1.5, borderRadius: 1,
          bgcolor: colorMap[t.type] + '20',
          border: `1px solid ${colorMap[t.type]}40`,
          display: 'flex', alignItems: 'flex-start', gap: 1,
          animation: 'slideIn 0.3s ease',
          '@keyframes slideIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: colorMap[t.type], fontSize: '0.6rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", mb: 0.3 }}>
              {labelMap[t.type]}
            </Typography>
            <Typography sx={{ color: colors.text.primary, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.4, wordBreak: 'break-word' }}>
              {t.message}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => dismiss(t.id)}
            sx={{ color: colors.text.dim, p: 0, '&:hover': { color: colors.text.primary } }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
