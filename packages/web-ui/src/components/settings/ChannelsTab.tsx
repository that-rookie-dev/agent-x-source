import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import TelegramIcon from '@mui/icons-material/Telegram';
import ForumIcon from '@mui/icons-material/Forum';
import EmailIcon from '@mui/icons-material/Email';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { NotificationChannelsConfig } from '@agentx/shared/browser';
import { channels as channelsApi, bridges } from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsOverlineSx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsBtnPrimarySx,
  settingsStatusBadgeSx,
  settingsCardSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { brands } from '../../styles/brands';

export interface ChannelsTabProps {
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}

interface ChannelMeta {
  id: keyof NotificationChannelsConfig;
  name: string;
  tagline: string;
  accent: string;
  icon: React.ReactNode;
  instructions: string[];
}

const CHANNELS: ChannelMeta[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'Chat with Agent-X via your bot',
    accent: brands.telegram,
    icon: <TelegramIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Create a bot with @BotFather and paste the token below.',
      'Send any message to your bot in Telegram, then click Verify token.',
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'Receive tasks and send alerts',
    accent: brands.slack,
    icon: <ForumIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Create a Slack app with Socket Mode enabled (bot + app tokens).',
      'Add an Incoming Webhook for automation alerts.',
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Receive tasks and send alerts',
    accent: brands.discord,
    icon: <HeadphonesIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Discord Developer Portal → create a bot and copy the token.',
      'Server Integrations → Webhook URL for alerts.',
    ],
  },
  {
    id: 'email',
    name: 'Email',
    tagline: 'SMTP alerts',
    accent: settingsTheme.accent.hud,
    icon: <EmailIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Configure SMTP for automation summaries and alerts.',
    ],
  },
];

function getField(
  obj: NotificationChannelsConfig,
  section: keyof NotificationChannelsConfig,
  fieldKey: string,
): string {
  const block = obj[section] as Record<string, unknown> | undefined;
  const val = block?.[fieldKey];
  if (typeof val === 'number') return String(val);
  return typeof val === 'string' ? val : '';
}

function setField(
  obj: NotificationChannelsConfig,
  section: keyof NotificationChannelsConfig,
  fieldKey: string,
  raw: string,
  type?: 'number',
): NotificationChannelsConfig {
  const block = { ...(obj[section] as Record<string, unknown> | undefined) };
  block[fieldKey] = type === 'number' ? (raw ? Number(raw) : undefined) : (raw || undefined);
  return { ...obj, [section]: block };
}

function channelStatusLabel(id: keyof NotificationChannelsConfig, section: Record<string, unknown>): string {
  if (section.enabled !== true) return 'OFF';
  if (id === 'telegram') {
    if (section.botToken && section.chatId) return 'READY';
    if (section.botToken) return 'VERIFY';
    return 'SETUP';
  }
  if (id === 'slack') {
    if (section.botToken && section.appToken && section.webhookUrl) return 'READY';
    if (section.botToken || section.webhookUrl) return 'PARTIAL';
    return 'SETUP';
  }
  if (id === 'discord') {
    if (section.botToken && section.webhookUrl) return 'READY';
    if (section.botToken || section.webhookUrl) return 'PARTIAL';
    return 'SETUP';
  }
  if (id === 'email') {
    return section.smtpHost && section.toAddress ? 'READY' : 'SETUP';
  }
  return 'SETUP';
}

function statusState(status: string): 'active' | 'warn' | 'idle' {
  if (status === 'READY') return 'active';
  if (status === 'PARTIAL' || status === 'VERIFY') return 'warn';
  return 'idle';
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Typography sx={{ ...settingsOverlineSx, fontSize: '0.52rem', letterSpacing: '1.5px', mb: 0.5 }}>
      {children}
      {required && <Box component="span" sx={{ color: settingsTheme.accent.alert, ml: 0.5 }}>*</Box>}
    </Typography>
  );
}

function CredentialField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  gridColumn,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'number';
  placeholder?: string;
  required?: boolean;
  gridColumn?: string;
}) {
  return (
    <Box sx={{ gridColumn, display: 'flex', flexDirection: 'column' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <TextField
        size="small"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ ...settingsTextFieldSx }}
      />
    </Box>
  );
}

function AllowedUserIdsField({
  section,
  value,
  onChange,
}: {
  section: keyof NotificationChannelsConfig;
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}) {
  return (
    <Box sx={{ gridColumn: '1 / -1' }}>
      <FieldLabel>Allowed User IDs</FieldLabel>
      <TextField
        size="small"
        fullWidth
        placeholder="123456789, 987654321"
        helperText="Inbound messaging requires at least one allowed user ID per channel."
        value={getField(value, section, 'allowedUserIds')}
        onChange={(e) => onChange(setField(value, section, 'allowedUserIds', e.target.value))}
        sx={{
          ...settingsTextFieldSx,
          '& .MuiFormHelperText-root': {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.55rem',
            color: settingsTheme.text.dim,
            mt: 0.5,
          },
        }}
      />
    </Box>
  );
}

function TelegramFields({
  value,
  onChange,
}: {
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [greetingMsg, setGreetingMsg] = useState<string | null>(null);

  const chatId = getField(value, 'telegram', 'chatId');
  const allowedUserId = getField(value, 'telegram', 'allowedUserIds').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)[0] ?? '';
  const hasToken = Boolean(getField(value, 'telegram', 'botToken').trim());

  const handleVerify = async () => {
    const token = getField(value, 'telegram', 'botToken');
    if (!token) {
      setVerifyMsg('Enter a bot token first.');
      return;
    }
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const result = await channelsApi.discoverTelegram(token, chatId || undefined);
      if (!result.ok) {
        setVerifyMsg(result.error ?? 'Verification failed');
        return;
      }
      const botLabel = result.botUsername ? `@${result.botUsername}` : result.botName ?? 'Bot';
      if (result.error && !result.saved) {
        setVerifyMsg(result.error);
        return;
      }
      if (!result.chats?.length) {
        setVerifyMsg(`Token valid (${botLabel}). Open Telegram, send a private message to your bot, then verify again.`);
        return;
      }
      const ownerId = result.allowedUserId
        ?? result.chats.find((c) => c.type === 'private')?.userId
        ?? result.chats.find((c) => c.type === 'private')?.id;
      if (!ownerId || !result.chatId) {
        setVerifyMsg(result.error ?? 'Message your bot in a private chat, then verify again.');
        return;
      }
      const chat = result.chats.find((c) => c.id === result.chatId) ?? result.chats[0]!;
      const next = {
        ...value,
        telegram: {
          ...value.telegram,
          enabled: true,
          inbound: true,
          outbound: true,
          botToken: token,
          chatId: result.chatId,
          allowedUserIds: ownerId,
        },
      };
      onChange(next);
      setVerifyMsg(
        result.saved
          ? `Connected (${botLabel} → ${chat.title}). Owner user ID ${ownerId} locked.`
          : `Connected (${botLabel} → ${chat.title}). Owner user ID ${ownerId}.`,
      );
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleGreeting = async () => {
    if (!hasToken) {
      setGreetingMsg('Enter a bot token first.');
      return;
    }
    if (!chatId) {
      setGreetingMsg('Verify token and link a chat before sending a greeting.');
      return;
    }
    setGreeting(true);
    setGreetingMsg(null);
    try {
      const result = await channelsApi.sendTelegramGreeting(
        getField(value, 'telegram', 'botToken'),
        chatId || allowedUserId,
      );
      setGreetingMsg(result.ok ? `Greeting sent. ${result.message ?? ''}` : (result.error ?? 'Failed to send greeting'));
    } catch (e) {
      setGreetingMsg(e instanceof Error ? e.message : 'Failed to send greeting');
    } finally {
      setGreeting(false);
    }
  };

  const message = greetingMsg ?? verifyMsg;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <CredentialField
          label="Bot Token"
          value={getField(value, 'telegram', 'botToken')}
          onChange={(v) => onChange(setField(value, 'telegram', 'botToken', v))}
          type="password"
          placeholder="123456:ABC-DEF..."
          required
          gridColumn="1 / -1"
        />
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          onClick={() => { void handleVerify(); }}
          disabled={verifying || !hasToken}
          sx={settingsBtnPrimarySx}
        >
          {verifying ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Verify Token
        </Button>
        <Button
          size="small"
          onClick={() => { void handleGreeting(); }}
          disabled={greeting || !hasToken || !chatId}
          sx={settingsBtnGhostSx}
        >
          {greeting ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Send Greeting
        </Button>
        {message && (
          <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx, flex: 1, minWidth: 160 }}>
            {message}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function ChannelCard({
  meta,
  value,
  onChange,
}: {
  meta: ChannelMeta;
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState('');
  const [clearSuccess, setClearSuccess] = useState('');
  const section = (value[meta.id] ?? {}) as Record<string, unknown>;
  const enabled = section.enabled === true;
  const status = channelStatusLabel(meta.id, section);

  const handleClearConfirm = async () => {
    setClearLoading(true);
    setClearError('');
    setClearSuccess('');
    try {
      const result = await bridges.clearConversation(String(meta.id));
      setClearSuccess(result.message ?? `Cleared ${meta.name} conversation`);
      setClearOpen(false);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Failed to clear conversation');
    } finally {
      setClearLoading(false);
    }
  };

  const enableSection = (checked: boolean) => ({
    ...section,
    enabled: checked,
    inbound: true,
    outbound: true,
  });

  return (
    <Box sx={settingsCardSx(meta.accent, enabled)}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        {/* Header — always visible */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '4px',
              bgcolor: `${meta.accent}14`,
              color: meta.accent,
              border: `1px solid ${meta.accent}44`,
            }}>
              {meta.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary, lineHeight: 1.3 }}>
                {meta.name}
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx, letterSpacing: '0.5px' }}>
                {meta.tagline}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
            <Box sx={{ ...settingsStatusBadgeSx(statusState(status)), flexShrink: 0 }}>
              {status}
            </Box>
            <Switch
              size="small"
              checked={enabled}
              onChange={(e) => onChange({ ...value, [meta.id]: enableSection(e.target.checked) })}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: meta.accent },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: meta.accent },
              }}
            />
          </Box>
        </Box>

        {/* Expanded configuration */}
        <Collapse in={enabled}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
            {/* Instructions */}
            <Box sx={{
              border: `1px solid ${settingsTheme.border.subtle}`,
              borderRadius: '4px',
              bgcolor: settingsTheme.bg.void,
              overflow: 'hidden',
            }}>
              <Box
                onClick={() => setInstructionsOpen((o) => !o)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 1.25, py: 0.75, cursor: 'pointer', userSelect: 'none',
                }}
              >
                <Typography sx={{ ...settingsOverlineSx, fontSize: '0.5rem', letterSpacing: '1.5px' }}>
                  Setup Instructions
                </Typography>
                <ExpandMoreIcon sx={{
                  fontSize: 14, color: settingsTheme.text.dim,
                  transform: instructionsOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }} />
              </Box>
              <Collapse in={instructionsOpen}>
                <Box sx={{ px: 1.25, pb: 1 }}>
                  {meta.instructions.map((line, i) => (
                    <Typography key={i} sx={{ ...settingsHelperSx, fontSize: '0.6rem', mb: 0.35 }}>
                      {i + 1}. {line}
                    </Typography>
                  ))}
                </Box>
              </Collapse>
            </Box>

            {/* Alerts */}
            {clearSuccess && (
              <Alert severity="success" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setClearSuccess('')}>
                {clearSuccess}
              </Alert>
            )}
            {clearError && (
              <Alert severity="error" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setClearError('')}>
                {clearError}
              </Alert>
            )}

            {/* Credentials */}
            {meta.id === 'telegram' && <TelegramFields value={value} onChange={onChange} />}

            {meta.id === 'slack' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="Bot Token"
                    value={getField(value, 'slack', 'botToken')}
                    onChange={(v) => onChange(setField(value, 'slack', 'botToken', v))}
                    type="password"
                    placeholder="xoxb-..."
                  />
                  <CredentialField
                    label="App Token"
                    value={getField(value, 'slack', 'appToken')}
                    onChange={(v) => onChange(setField(value, 'slack', 'appToken', v))}
                    type="password"
                    placeholder="xapp-..."
                  />
                  <CredentialField
                    label="Webhook URL"
                    value={getField(value, 'slack', 'webhookUrl')}
                    onChange={(v) => onChange(setField(value, 'slack', 'webhookUrl', v))}
                    type="password"
                    placeholder="https://hooks.slack.com/..."
                    gridColumn="1 / -1"
                  />
                  <AllowedUserIdsField section="slack" value={value} onChange={onChange} />
                </Box>
              </Box>
            )}

            {meta.id === 'discord' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="Bot Token"
                    value={getField(value, 'discord', 'botToken')}
                    onChange={(v) => onChange(setField(value, 'discord', 'botToken', v))}
                    type="password"
                    placeholder="MTQ..."
                  />
                  <CredentialField
                    label="Channel ID (optional)"
                    value={getField(value, 'discord', 'channelId')}
                    onChange={(v) => onChange(setField(value, 'discord', 'channelId', v))}
                    placeholder="Optional"
                  />
                  <CredentialField
                    label="Webhook URL"
                    value={getField(value, 'discord', 'webhookUrl')}
                    onChange={(v) => onChange(setField(value, 'discord', 'webhookUrl', v))}
                    type="password"
                    placeholder="https://discord.com/api/webhooks/..."
                    gridColumn="1 / -1"
                  />
                  <AllowedUserIdsField section="discord" value={value} onChange={onChange} />
                </Box>
              </Box>
            )}

            {meta.id === 'email' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="SMTP Host"
                    value={getField(value, 'email', 'smtpHost')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpHost', v))}
                    placeholder="smtp.example.com"
                  />
                  <CredentialField
                    label="Port"
                    value={getField(value, 'email', 'smtpPort')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpPort', v, 'number'))}
                    type="number"
                    placeholder="587"
                  />
                  <CredentialField
                    label="Username"
                    value={getField(value, 'email', 'smtpUser')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpUser', v))}
                  />
                  <CredentialField
                    label="Password"
                    value={getField(value, 'email', 'smtpPassword')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpPassword', v))}
                    type="password"
                  />
                  <CredentialField
                    label="From"
                    value={getField(value, 'email', 'fromAddress')}
                    onChange={(v) => onChange(setField(value, 'email', 'fromAddress', v))}
                    placeholder="agent@example.com"
                  />
                  <CredentialField
                    label="To"
                    value={getField(value, 'email', 'toAddress')}
                    onChange={(v) => onChange(setField(value, 'email', 'toAddress', v))}
                    placeholder="you@example.com"
                  />
                </Box>
              </Box>
            )}

            {/* Danger zone */}
            <Box sx={{
              border: `1px dashed ${settingsTheme.border.alert}`,
              borderRadius: '4px',
              bgcolor: `${settingsTheme.accent.alert}08`,
              p: 1.25,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
              flexWrap: 'wrap',
            }}>
              <Box>
                <Typography sx={{ ...settingsOverlineSx, fontSize: '0.5rem', color: settingsTheme.accent.alert, mb: 0.25 }}>
                  Danger Zone
                </Typography>
                <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                  Wipe all conversation history and session data for this channel.
                </Typography>
              </Box>
              <Button
                size="small"
                startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
                onClick={() => setClearOpen(true)}
                sx={settingsBtnDangerSx}
              >
                Clear Conversation
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Box>
      
      <Dialog
        open={clearOpen}
        onClose={() => { if (!clearLoading) setClearOpen(false); }}
        PaperProps={{ sx: {
          bgcolor: settingsTheme.bg.void,
          border: `1px solid ${settingsTheme.border.default}`,
          borderRadius: '6px',
          maxWidth: 420,
          width: '100%',
        }}}
      >
        <DialogTitle sx={{ fontSize: '0.85rem', fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          {meta.icon}
          Clear {meta.name} Conversation
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: settingsTheme.text.dim, mt: 1, fontSize: '0.72rem' }}>
            This will permanently delete <strong>all messages, tool executions, and conversation history</strong> for {meta.name}.
            The agent will start fresh with no memory of prior conversations. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClearOpen(false)} sx={{ color: settingsTheme.text.dim }}>Cancel</Button>
          <Button
            onClick={handleClearConfirm}
            variant="contained"
            disabled={clearLoading}
            sx={{ bgcolor: settingsTheme.accent.alert, color: '#fff' }}
          >
            {clearLoading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Clear All
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export function mergeChannelsConfig(raw?: NotificationChannelsConfig | null): NotificationChannelsConfig {
  return {
    telegram: { enabled: false, inbound: true, outbound: true, ...raw?.telegram },
    slack: { enabled: false, inbound: true, outbound: true, ...raw?.slack },
    discord: { enabled: false, inbound: true, outbound: true, ...raw?.discord },
    email: { enabled: false, inbound: false, outbound: true, ...raw?.email },
  };
}

export function ChannelsTab({ value, onChange }: ChannelsTabProps) {
  const cfg = mergeChannelsConfig(value);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <SettingsSectionHeader
        icon={<NotificationsIcon sx={{ fontSize: 16 }} />}
        title="Channels"
        subtitle="Secure channels for Agent-X inbound and outbound traffic"
      />

      {CHANNELS.map((meta) => (
        <ChannelCard key={String(meta.id)} meta={meta} value={cfg} onChange={onChange} />
      ))}

      <Typography sx={{ ...settingsHelperSx, mt: 0.5 }}>
        Enable a channel to configure credentials. Telegram verifies and saves automatically on success.
        Other changes save automatically.
      </Typography>
    </Box>
  );
}
