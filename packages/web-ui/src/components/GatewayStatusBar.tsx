import { useState, useEffect, useCallback } from 'react';
import { Box, Chip, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import TelegramIcon from '@mui/icons-material/Telegram';
import PublicIcon from '@mui/icons-material/Public';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { colors } from '../theme';
import { gateway } from '../api';

const FOCUS_CHANNELS = [
  { id: 'web', label: 'Web-UI', icon: PublicIcon },
  { id: 'telegram', label: 'Telegram', icon: TelegramIcon },
];

export function GatewayStatusBar() {
  const [focus, setFocus] = useState<string | null>(null);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const poll = useCallback(async () => {
    try {
      const status = await gateway.status();
      if (status.active && status.focus) {
        setFocus(status.focus);
        const tgChan = status.channelStats?.['telegram'];
        setTelegramConnected(
          typeof tgChan === 'object' && tgChan !== null && (tgChan as Record<string, unknown>)['connected'] === true,
        );
      }
      const focusStatus = await gateway.focus();
      setFocus(focusStatus.focus);
    } catch {
      // server offline
    }
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [poll]);

  const handleFocusClick = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleFocusSelect = async (channel: string) => {
    setAnchorEl(null);
    try {
      await gateway.setFocus(channel);
      setFocus(channel);
    } catch { /* ignore */ }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1 }}>
      <Tooltip title={telegramConnected ? 'Telegram connected' : 'Telegram disconnected'}>
        <Chip
          icon={
            <TelegramIcon
              sx={{ fontSize: 14, color: telegramConnected ? colors.accent.green : colors.text.tertiary }}
            />
          }
          label={telegramConnected ? 'TG' : 'TG'}
          size="small"
          variant="outlined"
          sx={{
            height: 22,
            borderColor: telegramConnected ? colors.accent.green : colors.text.dim,
            '& .MuiChip-label': { fontSize: 10, px: 0.5 },
          }}
        />
      </Tooltip>

      <Tooltip title={`Focus: ${focus ?? 'none'} — Click to switch`}>
        <Chip
          icon={<SwapHorizIcon sx={{ fontSize: 13 }} />}
          label={focus ?? 'auto'}
          size="small"
          variant="outlined"
          onClick={handleFocusClick}
          sx={{ height: 22, cursor: 'pointer', '& .MuiChip-label': { fontSize: 10, px: 0.5 } }}
        />
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: colors.text.secondary }}>
          Switch focus channel
        </Typography>
        {FOCUS_CHANNELS.map((ch) => {
          const Icon = ch.icon;
          return (
            <MenuItem key={ch.id} onClick={() => handleFocusSelect(ch.id)} selected={focus === ch.id}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Icon sx={{ fontSize: 16, color: focus === ch.id ? '#4FC3F7' : colors.text.tertiary }} />
              </ListItemIcon>
              <ListItemText primary={ch.label} primaryTypographyProps={{ fontSize: 12 }} />
              {focus === ch.id && <CircleIcon sx={{ fontSize: 8, color: '#4FC3F7', ml: 1 }} />}
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
