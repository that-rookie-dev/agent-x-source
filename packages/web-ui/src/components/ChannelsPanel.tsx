import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import TelegramIcon from '@mui/icons-material/Telegram';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import SlackIcon from '@mui/icons-material/Forum';
import EmailIcon from '@mui/icons-material/Email';
import SettingsIcon from '@mui/icons-material/Settings';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ComputerIcon from '@mui/icons-material/Computer';
import PublicIcon from '@mui/icons-material/Public';
import CircleIcon from '@mui/icons-material/Circle';
import { bridges, gateway, type BridgeStatus } from '../api';
import { colors } from '../theme';

interface ChannelDef {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: BridgeStatus | null;
}

interface ChannelFormState {
  botToken: string;
  chatId: string;
  appToken: string;
  channelId: string;
}

const EMPTY_FORM: ChannelFormState = { botToken: '', chatId: '', appToken: '', channelId: '' };

function ChannelIcon({ id }: { id: string }) {
  switch (id) {
    case 'telegram': return <TelegramIcon sx={{ fontSize: 28, color: '#0088cc' }} />;
    case 'discord': return <HeadphonesIcon sx={{ fontSize: 28, color: '#5865f2' }} />;
    case 'slack': return <SlackIcon sx={{ fontSize: 28, color: '#ecb22e' }} />;
    case 'email': return <EmailIcon sx={{ fontSize: 28, color: colors.accent.cyan }} />;
    default: return <SettingsIcon sx={{ fontSize: 28, color: colors.text.dim }} />;
  }
}

function ConfigureModal({
  channel,
  open,
  onClose,
  onSave,
  loading,
}: {
  channel: ChannelDef | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: Record<string, string>) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM);

  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  if (!channel) return null;

  const set = (k: keyof ChannelFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSave = () => {
    const data: Record<string, string> = {};
    if (channel.id === 'telegram') {
      if (!form.botToken) return;
      data.token = form.botToken;
      data.chatId = form.chatId;
    } else if (channel.id === 'discord') {
      if (!form.botToken) return;
      data.token = form.botToken;
      data.channelId = form.channelId;
    } else if (channel.id === 'slack') {
      if (!form.botToken || !form.appToken) return;
      data.botToken = form.botToken;
      data.appToken = form.appToken;
    }
    onSave(data);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 480, width: '100%' } }}
    >
      <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ChannelIcon id={channel.id} />
        Configure {channel.name}
      </DialogTitle>
      <DialogContent>
        {channel.id === 'telegram' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
              Enter your Telegram bot token from <strong>@BotFather</strong>.
            </Typography>
            <TextField label="Bot Token" value={form.botToken} onChange={set('botToken')} fullWidth type="password" placeholder="123456:ABC-DEF1234..." />
            <TextField label="Chat ID (optional)" value={form.chatId} onChange={set('chatId')} fullWidth placeholder="-100123456789" />
          </Box>
        )}
        {channel.id === 'discord' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
              Enter your Discord bot token from the Developer Portal.
            </Typography>
            <TextField label="Bot Token" value={form.botToken} onChange={set('botToken')} fullWidth type="password" placeholder="MTE5MjM0NTY3ODkwMTIzNDU2Ng..." />
            <TextField label="Channel ID (optional)" value={form.channelId} onChange={set('channelId')} fullWidth placeholder="123456789012345678" />
          </Box>
        )}
        {channel.id === 'slack' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
              Enter your Slack app tokens from the Slack API dashboard.
            </Typography>
            <TextField label="Bot Token" value={form.botToken} onChange={set('botToken')} fullWidth type="password" placeholder="xoxb-..." />
            <TextField label="App Token" value={form.appToken} onChange={set('appToken')} fullWidth type="password" placeholder="xapp-..." />
          </Box>
        )}
        {channel.id === 'email' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
              Email channel setup coming soon.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: colors.text.dim }}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
          {loading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
          Save & Enable
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ChannelsPanel() {
  const [channels, setChannels] = useState<ChannelDef[]>([
    { id: 'telegram', name: 'Telegram', description: 'Chat via Telegram bot', icon: null, status: null },
    { id: 'discord', name: 'Discord', description: 'Connect via Discord bot', icon: null, status: null },
    { id: 'slack', name: 'Slack', description: 'Slack integration', icon: null, status: null },
    { id: 'email', name: 'Email', description: 'Email communication channel', icon: null, status: null },
  ]);
  const [error, setError] = useState('');
  const [modalChannel, setModalChannel] = useState<ChannelDef | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<null | HTMLElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const FOCUS_CHANNELS = [
    { id: 'tui', label: 'TUI', icon: ComputerIcon },
    { id: 'web', label: 'Web-UI', icon: PublicIcon },
    { id: 'telegram', label: 'Telegram', icon: TelegramIcon },
  ];

  const loadFocus = useCallback(async () => {
    try {
      const f = await gateway.focus();
      setFocus(f.focus);
    } catch { /* ignore */ }
  }, []);

  const handleFocusSelect = async (channel: string) => {
    setFocusAnchor(null);
    try {
      await gateway.setFocus(channel);
      setFocus(channel);
    } catch { /* ignore */ }
  };

  const loadAll = useCallback(async () => {
    const [tg, dc, sl, em] = await Promise.allSettled([
      bridges.telegram.status(),
      bridges.discord.status(),
      bridges.slack.status(),
      bridges.email.status(),
    ]);
    setChannels((prev) => prev.map((ch) => {
      let status: BridgeStatus | null = null;
      if (ch.id === 'telegram') status = tg.status === 'fulfilled' ? tg.value : null;
      if (ch.id === 'discord') status = dc.status === 'fulfilled' ? dc.value : null;
      if (ch.id === 'slack') status = sl.status === 'fulfilled' ? sl.value : null;
      if (ch.id === 'email') status = em.status === 'fulfilled' ? em.value : null;
      return { ...ch, status };
    }));
  }, []);

  useEffect(() => {
    loadAll();
    loadFocus();
    pollingRef.current = setInterval(() => { loadAll(); loadFocus(); }, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [loadAll, loadFocus]);

  const handleToggle = async (ch: ChannelDef) => {
    const isEnabled = ch.status?.connected ?? false;
    setToggleLoading(ch.id);
    setError('');
    try {
      if (isEnabled) {
        const stopMap: Record<string, () => Promise<{ ok: boolean }>> = {
          telegram: bridges.telegram.stop,
          discord: bridges.discord.stop,
          slack: bridges.slack.stop,
          email: bridges.email.stop,
        };
        await stopMap[ch.id]();
      } else {
        if (!ch.status?.configured) {
          setModalChannel(ch);
          return;
        }
        const startMap: Record<string, () => Promise<{ ok: boolean }>> = {
          telegram: () => bridges.telegram.start(ch.status?.token ?? ''),
          discord: () => bridges.discord.start(ch.status?.token ?? ''),
          slack: () => bridges.slack.start(ch.status?.token ?? '', String((ch.status as any)?.appToken ?? '')),
          email: () => bridges.email.start({} as any),
        };
        await startMap[ch.id]();
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setToggleLoading(null);
    }
  };

  const handleConfigureSave = async (data: Record<string, string>) => {
    if (!modalChannel) return;
    setModalLoading(true);
    setError('');
    try {
      if (modalChannel.id === 'telegram') {
        await bridges.telegram.start(data.token, data.chatId || undefined);
      } else if (modalChannel.id === 'discord') {
        await bridges.discord.start(data.token, data.channelId || undefined);
      } else if (modalChannel.id === 'slack') {
        await bridges.slack.start(data.botToken, data.appToken);
      }
      setModalChannel(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Configuration failed');
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, px: 3, pt: 2.5, pb: 1.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600 }}>Channels</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mt: 0.25 }}>
            Communication channels for interacting with Agent-X
          </Typography>
        </Box>

        <Box>
          <Chip
            icon={<SwapHorizIcon sx={{ fontSize: 13 }} />}
            label={focus ?? 'auto'}
            size="small"
            variant="outlined"
            onClick={(e) => setFocusAnchor(e.currentTarget)}
            sx={{ height: 24, cursor: 'pointer', '& .MuiChip-label': { fontSize: 10, px: 0.75 }, borderColor: colors.border.strong }}
          />
          <Menu
            anchorEl={focusAnchor}
            open={Boolean(focusAnchor)}
            onClose={() => setFocusAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 180 } }}
          >
            <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: colors.text.tertiary, fontSize: '0.65rem' }}>
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
      </Box>

      {error && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" sx={{ bgcolor: '#1a0000', fontSize: '0.75rem' }} onClose={() => setError('')}>{error}</Alert>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, pb: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 2 }}>
          {channels.map((ch) => {
            const isConnected = ch.status?.connected ?? false;
            const isConfigured = ch.status?.configured ?? false;
            const isLoading = toggleLoading === ch.id;

            return (
              <Box
                key={ch.id}
                sx={{
                  border: `1px solid ${isConnected ? colors.accent.green + '50' : colors.border.default}`,
                  borderRadius: 1.5,
                  bgcolor: colors.bg.secondary,
                  transition: 'all 0.2s ease',
                  '&:hover': { borderColor: isConnected ? colors.accent.green : colors.border.strong },
                }}
              >
                <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <ChannelIcon id={ch.id} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{ch.name}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: colors.text.tertiary, mt: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ch.description}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={isConnected ? 'Enabled' : isConfigured ? 'Disabled' : 'Not set'}
                    sx={{
                      fontSize: '0.55rem', height: 20,
                      color: isConnected ? colors.accent.green : isConfigured ? colors.accent.orange : colors.text.dim,
                      border: `1px solid ${isConnected ? colors.accent.green + '40' : isConfigured ? colors.accent.orange + '40' : colors.border.default}`,
                    }}
                  />
                  <Switch
                    checked={isConnected}
                    onChange={() => handleToggle(ch)}
                    disabled={isLoading}
                    size="small"
                    sx={{
                      '& .MuiSwitch-thumb': { bgcolor: isConnected ? colors.accent.green : colors.text.dim },
                      '& .MuiSwitch-track': { bgcolor: isConnected ? colors.accent.green + '40' : colors.border.default },
                    }}
                  />
                </Box>

                {isConnected && (
                  <Box sx={{ px: 2, pb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green }} />
                      <Typography sx={{ fontSize: '0.6rem', color: colors.accent.green, fontFamily: "'JetBrains Mono', monospace" }}>
                        Live
                      </Typography>
                    </Box>
                  </Box>
                )}

                {isConfigured && (
                  <Box sx={{ px: 2, pb: 2, display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SettingsIcon sx={{ fontSize: 14 }} />}
                      onClick={() => setModalChannel(ch)}
                      sx={{ fontSize: '0.6rem', textTransform: 'none', borderColor: colors.border.strong, color: colors.text.secondary }}
                    >
                      Configure
                    </Button>
                  </Box>
                )}

                {!isConfigured && (
                  <Box sx={{ px: 2, pb: 2 }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => setModalChannel(ch)}
                      sx={{ fontSize: '0.6rem', textTransform: 'none', bgcolor: colors.text.primary, color: colors.bg.primary }}
                    >
                      Enable
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      <ConfigureModal
        channel={modalChannel}
        open={!!modalChannel}
        onClose={() => { if (!modalLoading) setModalChannel(null); }}
        onSave={handleConfigureSave}
        loading={modalLoading}
      />
    </Box>
  );
}
