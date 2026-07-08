import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TelegramIcon from '@mui/icons-material/Telegram';
import ForumIcon from '@mui/icons-material/Forum';
import EmailIcon from '@mui/icons-material/Email';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { NotificationChannelsConfig } from '@agentx/shared/browser';
import { channels as channelsApi } from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsTextFieldSx,
  settingsHelperSx,
  settingsScanlineSx,
  settingsBtnGhostSx,
  settingsCardSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';
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
    icon: <TelegramIcon sx={{ fontSize: 16, color: brands.telegram }} />,
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
    icon: <ForumIcon sx={{ fontSize: 16, color: brands.slack }} />,
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
    icon: <HeadphonesIcon sx={{ fontSize: 16, color: brands.discord }} />,
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
    icon: <EmailIcon sx={{ fontSize: 16, color: settingsTheme.accent.hud }} />,
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
    <TextField
      size="small"
      fullWidth
      label="Allowed user IDs"
      placeholder="123456789, 987654321 (comma-separated)"
      helperText="In server mode, inbound messaging requires at least one allowed user ID per channel."
      value={getField(value, section, 'allowedUserIds')}
      onChange={(e) => onChange(setField(value, section, 'allowedUserIds', e.target.value))}
      sx={{ ...settingsTextFieldSx, gridColumn: '1 / -1' }}
    />
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
      if (!result.chats?.length) {
        setVerifyMsg(`Token valid (${botLabel}). Message your bot, then verify again.`);
        return;
      }
      const chat = result.chats[0]!;
      const next = {
        ...value,
        telegram: {
          ...value.telegram,
          enabled: true,
          inbound: true,
          outbound: true,
          botToken: token,
          chatId: chat.id,
        },
      };
      onChange(next);
      setVerifyMsg(
        result.saved
          ? `Connected (${botLabel} → ${chat.title}). Saved — survives restart.`
          : `Connected (${botLabel} → ${chat.title}).`,
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
        chatId,
      );
      if (!result.ok) {
        setGreetingMsg(result.error ?? 'Greeting failed');
        return;
      }
      onChange({
        ...value,
        telegram: {
          ...value.telegram,
          enabled: true,
          inbound: true,
          outbound: true,
          botToken: getField(value, 'telegram', 'botToken'),
          chatId,
        },
      });
      setGreetingMsg(result.message ? `Sent: ${result.message}` : 'Greeting sent. Inbound listener started.');
    } catch (e) {
      setGreetingMsg(e instanceof Error ? e.message : 'Greeting failed');
    } finally {
      setGreeting(false);
    }
  };

  return (
    <>
      <TextField
        size="small"
        fullWidth
        type="password"
        label="Bot token"
        placeholder="123456:ABC…"
        value={getField(value, 'telegram', 'botToken')}
        onChange={(e) => onChange(setField(value, 'telegram', 'botToken', e.target.value))}
        sx={settingsTextFieldSx}
      />
      <AllowedUserIdsField section="telegram" value={value} onChange={onChange} />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => { void handleVerify(); }} disabled={verifying} sx={settingsBtnGhostSx}>
          {verifying ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Verify token
        </Button>
        <Button
          size="small"
          onClick={() => { void handleGreeting(); }}
          disabled={greeting || !hasToken || !chatId}
          sx={settingsBtnGhostSx}
        >
          {greeting ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Send greeting
        </Button>
        {(verifyMsg || greetingMsg) && (
          <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, flex: 1, minWidth: 160 }}>
            {greetingMsg ?? verifyMsg}
          </Typography>
        )}
      </Box>
    </>
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
  const section = (value[meta.id] ?? {}) as Record<string, unknown>;
  const enabled = section.enabled === true;
  const status = channelStatusLabel(meta.id, section);

  const enableSection = (checked: boolean) => ({
    ...section,
    enabled: checked,
    inbound: true,
    outbound: true,
  });

  const headerRow = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {meta.icon}
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary }}>
          {meta.name}
        </Typography>
        <Typography sx={{
          fontSize: '0.55rem',
          color: enabled ? settingsTheme.accent.signal : settingsTheme.text.dim,
          ...settingsMonoSx,
          letterSpacing: '0.08em',
        }}>
          {status}
        </Typography>
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
  );

  if (!enabled) {
    return (
      <Box sx={{ ...settingsCardSx(meta.accent, false), mb: 1, py: 1, px: 1.25 }}>
        {headerRow}
      </Box>
    );
  }

  return (
    <SettingsCard title={meta.name} subtitle={meta.tagline} accent={meta.accent} active sx={{ mb: 1.5 }}>
      <Box sx={{ mb: 1 }}>{headerRow}</Box>

      <Box
        onClick={() => setInstructionsOpen((o) => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', py: 0.5, userSelect: 'none' }}
      >
        <ExpandMoreIcon sx={{
          fontSize: 16,
          color: settingsTheme.text.dim,
          transform: instructionsOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }} />
        <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          SETUP INSTRUCTIONS
        </Typography>
      </Box>
      <Collapse in={instructionsOpen}>
        <Box sx={{ mb: 1, pl: 0.5 }}>
          {meta.instructions.map((line, i) => (
            <Typography key={i} sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.35 }}>
              {i + 1}. {line}
            </Typography>
          ))}
        </Box>
      </Collapse>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, mt: 0.5 }}>
        {meta.id === 'telegram' && <Box sx={{ gridColumn: '1 / -1' }}><TelegramFields value={value} onChange={onChange} /></Box>}

        {meta.id === 'slack' && (
          <>
            <TextField size="small" fullWidth type="password" label="Bot token" placeholder="xoxb-…"
              value={getField(value, 'slack', 'botToken')}
              onChange={(e) => onChange(setField(value, 'slack', 'botToken', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth type="password" label="App token" placeholder="xapp-…"
              value={getField(value, 'slack', 'appToken')}
              onChange={(e) => onChange(setField(value, 'slack', 'appToken', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth type="password" label="Webhook URL" placeholder="https://hooks.slack.com/…"
              value={getField(value, 'slack', 'webhookUrl')}
              onChange={(e) => onChange(setField(value, 'slack', 'webhookUrl', e.target.value))}
              sx={{ ...settingsTextFieldSx, gridColumn: '1 / -1' }} />
            <AllowedUserIdsField section="slack" value={value} onChange={onChange} />
          </>
        )}

        {meta.id === 'discord' && (
          <>
            <TextField size="small" fullWidth type="password" label="Bot token" placeholder="MTQ…"
              value={getField(value, 'discord', 'botToken')}
              onChange={(e) => onChange(setField(value, 'discord', 'botToken', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth label="Channel ID (optional)"
              value={getField(value, 'discord', 'channelId')}
              onChange={(e) => onChange(setField(value, 'discord', 'channelId', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth type="password" label="Webhook URL" placeholder="https://discord.com/api/webhooks/…"
              value={getField(value, 'discord', 'webhookUrl')}
              onChange={(e) => onChange(setField(value, 'discord', 'webhookUrl', e.target.value))}
              sx={{ ...settingsTextFieldSx, gridColumn: '1 / -1' }} />
            <AllowedUserIdsField section="discord" value={value} onChange={onChange} />
          </>
        )}

        {meta.id === 'email' && (
          <>
            <TextField size="small" fullWidth label="SMTP host" placeholder="smtp.example.com"
              value={getField(value, 'email', 'smtpHost')}
              onChange={(e) => onChange(setField(value, 'email', 'smtpHost', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth label="Port" type="number" placeholder="587"
              value={getField(value, 'email', 'smtpPort')}
              onChange={(e) => onChange(setField(value, 'email', 'smtpPort', e.target.value, 'number'))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth label="Username"
              value={getField(value, 'email', 'smtpUser')}
              onChange={(e) => onChange(setField(value, 'email', 'smtpUser', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth type="password" label="Password"
              value={getField(value, 'email', 'smtpPassword')}
              onChange={(e) => onChange(setField(value, 'email', 'smtpPassword', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth label="From" placeholder="agent@example.com"
              value={getField(value, 'email', 'fromAddress')}
              onChange={(e) => onChange(setField(value, 'email', 'fromAddress', e.target.value))}
              sx={settingsTextFieldSx} />
            <TextField size="small" fullWidth label="To" placeholder="you@example.com"
              value={getField(value, 'email', 'toAddress')}
              onChange={(e) => onChange(setField(value, 'email', 'toAddress', e.target.value))}
              sx={settingsTextFieldSx} />
          </>
        )}
      </Box>
    </SettingsCard>
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
    <Box>
      <SettingsSectionHeader
        icon={<EmailIcon sx={{ fontSize: 16 }} />}
        title="Channels"
        subtitle="Send tasks in and get results out via Agent-X"
      />
      <Box sx={{ position: 'relative' }}>
        <Box sx={settingsScanlineSx} />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {CHANNELS.map((meta) => (
            <ChannelCard key={String(meta.id)} meta={meta} value={cfg} onChange={onChange} />
          ))}
        </Box>
      </Box>
      <Typography sx={{ ...settingsHelperSx, mt: 1 }}>
        Enable a channel and enter credentials. Verify saves Telegram settings automatically — no need to re-verify after restart. Commit other changes when ready.
      </Typography>
    </Box>
  );
}
