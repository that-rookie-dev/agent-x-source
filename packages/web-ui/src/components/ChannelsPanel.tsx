import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { bridges, type BridgeStatus } from '../api';
import { colors } from '../theme';

function TelegramWizardSteps() {
  return (
    <Box sx={{ mt: 1, p: 1.25, bgcolor: colors.bg.tertiary, borderRadius: 1, border: `1px solid ${colors.border.default}` }}>
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontWeight: 600, mb: 0.75 }}>SETUP STEPS</Typography>
      <Box component="ol" sx={{ pl: 2, m: 0, '& li': { fontSize: '0.65rem', color: colors.text.tertiary, mb: 0.5 } }}>
        <li>Open Telegram and chat with <Link href="https://t.me/BotFather" target="_blank" sx={{ color: colors.accent.blue }}>@BotFather</Link>.</li>
        <li>Send <code style={{ color: colors.accent.green }}>/newbot</code>, pick a name and username ending in <code>bot</code>.</li>
        <li>Copy the API token BotFather returns into the field below.</li>
        <li>(Optional) Open your bot, send it any message, then visit <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> to grab your chat ID.</li>
        <li>Click <strong>Connect</strong>. Agent-X will start polling for messages.</li>
      </Box>
    </Box>
  );
}

interface ChannelCardProps {
  name: string;
  status: BridgeStatus | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => Promise<void>;
  children: React.ReactNode;
}

function ChannelCard({ name, status, onStart, onStop, onClear, children }: ChannelCardProps) {
  const [loading, setLoading] = useState(false);
  const isConnected = status?.connected ?? false;
  const isConfigured = status?.configured ?? false;

  const handle = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <Box sx={{ border: `1px solid ${isConnected ? colors.accent.green + '40' : colors.border.default}`, borderRadius: 1, p: 2, mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>{name}</Typography>
        <Chip size="small" label={isConnected ? 'Running' : isConfigured ? 'Stopped' : 'Not configured'} sx={{
          fontSize: '0.55rem', height: 20,
          color: isConnected ? colors.accent.green : isConfigured ? colors.accent.orange : colors.text.dim,
          border: `1px solid ${isConnected ? colors.accent.green + '40' : isConfigured ? colors.accent.orange + '40' : colors.border.default}`,
        }} />
      </Box>

      {/* Show masked token if configured */}
      {isConfigured && status?.token && (
        <Box sx={{ mb: 1.5, p: 1, bgcolor: colors.bg.tertiary, borderRadius: 1 }}>
          <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            Token: {status.token.slice(0, 6)}{'•'.repeat(20)}{status.token.slice(-4)}
          </Typography>
          {status.chatId && (
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.5 }}>
              Chat ID: {status.chatId}
            </Typography>
          )}
        </Box>
      )}

      {/* Configuration form (only when not configured) */}
      {!isConfigured && children}

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        {!isConnected && isConfigured && (
          <Button size="small" variant="contained" onClick={() => handle(onStart)} disabled={loading}
            sx={{ bgcolor: colors.accent.green, fontSize: '0.65rem', textTransform: 'none' }}>
            Enable
          </Button>
        )}
        {!isConnected && !isConfigured && (
          <Button size="small" variant="contained" onClick={() => handle(onStart)} disabled={loading}
            sx={{ bgcolor: colors.accent.green, fontSize: '0.65rem', textTransform: 'none' }}>
            Connect
          </Button>
        )}
        {isConnected && (
          <Button size="small" variant="outlined" onClick={() => handle(onStop)} disabled={loading}
            sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: colors.accent.orange, color: colors.accent.orange }}>
            Disable
          </Button>
        )}
        {isConfigured && (
          <Button size="small" variant="outlined" onClick={() => handle(onClear)} disabled={loading}
            sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: colors.accent.red, color: colors.accent.red }}>
            Clear Token
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function ChannelsPanel() {
  const [tgStatus, setTgStatus] = useState<BridgeStatus | null>(null);
  const [dcStatus, setDcStatus] = useState<BridgeStatus | null>(null);
  const [slStatus, setSlStatus] = useState<BridgeStatus | null>(null);
  const [emStatus, setEmStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState('');

  // Form fields
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [dcToken, setDcToken] = useState('');
  const [dcChannel, setDcChannel] = useState('');
  const [slBotToken, setSlBotToken] = useState('');
  const [slAppToken, setSlAppToken] = useState('');
  const [tgWizardOpen, setTgWizardOpen] = useState(false);

  const loadAll = async () => {
    const [tg, dc, sl, em] = await Promise.allSettled([
      bridges.telegram.status(),
      bridges.discord.status(),
      bridges.slack.status(),
      bridges.email.status(),
    ]);
    setTgStatus(tg.status === 'fulfilled' ? tg.value : null);
    setDcStatus(dc.status === 'fulfilled' ? dc.value : null);
    setSlStatus(sl.status === 'fulfilled' ? sl.value : null);
    setEmStatus(em.status === 'fulfilled' ? em.value : null);
  };

  useEffect(() => { loadAll(); }, []);

  const wrap = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); await loadAll(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.5 }}>Channels</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>
        Personal communication channels for interacting with Agent-X
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', fontSize: '0.75rem' }}>{error}</Alert>}

      {/* Telegram */}
      <ChannelCard
        name="Telegram"
        status={tgStatus}
        onStart={() => wrap(async () => { await bridges.telegram.start(tgToken, tgChatId || undefined); })}
        onStop={() => wrap(async () => { await bridges.telegram.stop(); })}
        onClear={() => wrap(async () => { await bridges.telegram.stop(); })}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontWeight: 600 }}>Credentials</Typography>
            <Button size="small" startIcon={<HelpOutlineIcon sx={{ fontSize: 14 }} />} onClick={() => setTgWizardOpen((v) => !v)}
              sx={{ fontSize: '0.6rem', textTransform: 'none', color: colors.accent.blue, minWidth: 'auto' }}>
              {tgWizardOpen ? 'Hide setup steps' : 'Show setup wizard'}
            </Button>
          </Box>
          <Collapse in={tgWizardOpen} unmountOnExit><TelegramWizardSteps /></Collapse>
          <TextField size="small" label="Bot Token" value={tgToken} onChange={(e) => setTgToken(e.target.value)} type="password"
            placeholder="123456:ABC-DEF1234..." sx={{ fontSize: '0.8rem' }} />
          <TextField size="small" label="Chat ID (optional)" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)}
            placeholder="-100123456789" />
        </Box>
      </ChannelCard>

      {/* Discord */}
      <ChannelCard
        name="Discord"
        status={dcStatus}
        onStart={() => wrap(async () => { await bridges.discord.start(dcToken, dcChannel || undefined); })}
        onStop={() => wrap(async () => { await bridges.discord.stop(); })}
        onClear={() => wrap(async () => { await bridges.discord.stop(); })}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField size="small" label="Bot Token" value={dcToken} onChange={(e) => setDcToken(e.target.value)} type="password" />
          <TextField size="small" label="Channel ID (optional)" value={dcChannel} onChange={(e) => setDcChannel(e.target.value)} />
        </Box>
      </ChannelCard>

      {/* Slack */}
      <ChannelCard
        name="Slack"
        status={slStatus}
        onStart={() => wrap(async () => { await bridges.slack.start(slBotToken, slAppToken); })}
        onStop={() => wrap(async () => { await bridges.slack.stop(); })}
        onClear={() => wrap(async () => { await bridges.slack.stop(); })}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField size="small" label="Bot Token" value={slBotToken} onChange={(e) => setSlBotToken(e.target.value)} type="password" />
          <TextField size="small" label="App Token" value={slAppToken} onChange={(e) => setSlAppToken(e.target.value)} type="password" />
        </Box>
      </ChannelCard>

      {/* Email */}
      <ChannelCard
        name="Email"
        status={emStatus}
        onStart={async () => {}}
        onStop={async () => {}}
        onClear={async () => {}}
      >
        <Typography variant="caption" sx={{ color: colors.text.dim }}>Email channel configuration coming soon</Typography>
      </ChannelCard>

      <Divider sx={{ my: 2, borderColor: colors.border.default }} />
      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>
        Channels allow you to communicate with Agent-X via messaging platforms.
        When enabled, agents and sub-agents can send you updates and receive commands through these channels.
      </Typography>
    </Box>
  );
}
