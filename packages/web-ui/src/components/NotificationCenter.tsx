import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Badge from '@mui/material/Badge';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { getNotifications, markAllRead, clearNotifications, subscribe, setQuietHours, isQuiet, type Notification } from '../stores/notifications.js';
import { colors, MONO } from '../theme';

const colorMap: Record<Notification['type'], string> = {
  error: colors.accent.red,
  warning: colors.text.primary,
  escalation: colors.accent.red,
  checkpoint: colors.text.primary,
  automation: colors.text.primary,
};

export function NotificationCenter() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [, tick] = useState(0);
  const [dnd, setDnd] = useState(isQuiet());

  useEffect(() => {
    return subscribe(() => tick((n) => n + 1));
  }, []);

  const all = getNotifications();
  const last = all.slice(-20).reverse();
  const unread = all.filter((n) => !n.read).length;

  const open = (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const close = () => {
    markAllRead();
    setAnchor(null);
  };

  const toggleDnd = (enabled: boolean) => {
    setDnd(enabled);
    if (enabled) {
      setQuietHours(0, 24);
    } else {
      setQuietHours(-1, -1);
    }
  };

  return (
    <>
      <IconButton size="small" onClick={open} aria-label="Notifications" title="Notifications" sx={{ color: colors.text.dim }}>
        <Badge badgeContent={unread} color="warning" max={99}>
          <NotificationsIcon sx={{ fontSize: 16 }} />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close} PaperProps={{ sx: { width: 360, maxHeight: 400, overflow: 'auto', fontFamily: MONO } }}>
        {last.length === 0 ? (
          <MenuItem disabled><Typography sx={{ fontFamily: MONO, fontSize: '0.7rem' }}>No notifications</Typography></MenuItem>
        ) : (
          <Box sx={{ p: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem' }}>Notifications</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim }}>DND</Typography>
                <Switch
                  size="small"
                  checked={dnd}
                  onChange={(e) => toggleDnd(e.target.checked)}
                  inputProps={{ 'aria-label': 'Do not disturb', title: 'Do not disturb' }}
                />
                <Button size="small" onClick={clearNotifications} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.6rem' }}>Clear all</Button>
              </Box>
            </Box>
            {last.map((n) => (
              <MenuItem
                key={n.id}
                dense
                onClick={() => { n.onClick?.(); setAnchor(null); }}
                sx={{ display: 'block', py: 0.5, borderBottom: `1px solid ${colors.border.subtle}` }}
              >
                <Typography sx={{ color: colorMap[n.type], fontSize: '0.58rem', fontWeight: 700, fontFamily: MONO, mb: 0.3 }}>{n.type.toUpperCase()}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: n.read ? colors.text.dim : colors.text.primary }}>{n.message}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim }}>{new Date(n.timestamp).toLocaleTimeString()}</Typography>
              </MenuItem>
            ))}
          </Box>
        )}
      </Menu>
    </>
  );
}
