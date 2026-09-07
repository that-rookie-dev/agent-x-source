import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { colors } from '../theme';
import { notify as storeNotify, getNotifications, subscribe } from '../stores/notifications.js';

export type ToastType = 'error' | 'warning' | 'escalation' | 'checkpoint' | 'automation';

export function notify(
  type: ToastType,
  message: string,
  opts?: { persist?: boolean; onClick?: () => void },
) {
  storeNotify(type, message, opts);
}

export function NotificationToast() {
  const [toasts, setToasts] = useState<ReturnType<typeof getNotifications>>([]);

  useEffect(() => {
    return subscribe(() => setToasts(getNotifications().filter((n) => !n.skipToast).slice(-4)));
  }, []);

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  const colorMap: Record<ToastType, string> = {
    error: colors.accent.red,
    warning: colors.text.primary,
    escalation: colors.accent.red,
    checkpoint: colors.text.primary,
    automation: colors.text.primary,
  };

  const labelMap: Record<ToastType, string> = {
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
      {toasts.map((t) => (
        <Box key={t.id} sx={{
          p: 1.5, borderRadius: 1,
          bgcolor: colors.bg.secondary,
          border: `1px solid ${colors.border.default}`,
          boxShadow: `0 8px 32px ${colors.shadow.heavy}`,
          display: 'flex', alignItems: 'flex-start', gap: 1,
          animation: 'slideIn 0.3s ease',
          '@keyframes slideIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        }}>
          <Box sx={{ flex: 1, minWidth: 0 }} onClick={t.onClick} style={{ cursor: t.onClick ? 'pointer' : 'default' }}>
            <Typography sx={{ color: colorMap[t.type], fontSize: '0.58rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", mb: 0.3, letterSpacing: '0.08em' }}>
              {labelMap[t.type]}
            </Typography>
            <Typography sx={{ color: colors.text.primary, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
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
