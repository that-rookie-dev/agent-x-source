import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';
import { bridges, channels, config } from '../../api';
import { WizardStatusLine, WizardStepShell } from './wizard-step-shell';
import { wizardPrimaryBtnSx, wizardTextFieldSlotProps, wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export interface WizardTelegramLinkMeta {
  botLabel: string | null;
  chatLabel: string | null;
}

export interface WizardTelegramStepProps {
  onLinkedChange?: (linked: boolean, meta?: WizardTelegramLinkMeta) => void;
  /** Parent already marked this step complete — restore finished UI on revisit. */
  alreadyLinked?: boolean;
  initialBotLabel?: string | null;
  initialChatLabel?: string | null;
}

/** Two-phase link flow: 1) validate token, 2) detect the chat after user messages the bot. */
type LinkPhase = 'token' | 'awaiting-chat' | 'linked';

export function WizardTelegramStep({
  onLinkedChange,
  alreadyLinked,
  initialBotLabel,
  initialChatLabel,
}: WizardTelegramStepProps) {
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');
  const [phase, setPhase] = useState<LinkPhase>(alreadyLinked ? 'linked' : 'token');
  const [botLabel, setBotLabel] = useState<string | null>(initialBotLabel ?? null);
  const [chatLabel, setChatLabel] = useState<string | null>(initialChatLabel ?? null);
  const [tokenConfigured, setTokenConfigured] = useState(Boolean(alreadyLinked));

  const linked = phase === 'linked';

  useEffect(() => {
    void (async () => {
      try {
        const [cfg, status] = await Promise.all([
          config.get().catch(() => null),
          bridges.telegram.status().catch(() => null),
        ]);
        const tg = cfg?.channels?.telegram;
        const serverLinked = Boolean(
          (tg?.enabled && tg.chatId) || status?.configured,
        );
        if (!serverLinked && !alreadyLinked) return;

        const nextBot = initialBotLabel
          || (typeof status?.['botUsername'] === 'string' ? `@${String(status['botUsername'])}` : null)
          || (tg?.botToken ? 'Telegram bot' : null)
          || 'Bot';
        const nextChat = initialChatLabel
          || (tg?.chatId ? `Chat ${tg.chatId}` : null)
          || 'Linked chat';

        setTokenConfigured(true);
        setBotLabel(nextBot);
        setChatLabel(nextChat);
        setPhase('linked');
        onLinkedChange?.(true, { botLabel: nextBot, chatLabel: nextChat });
      } catch { /* ignore */ }
    })();
    // Intentionally once on mount / when parent says already linked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyLinked]);

  const resetToToken = () => {
    setPhase('token');
    setBotLabel(null);
    setChatLabel(null);
    setStatusMsg(null);
    setTokenConfigured(false);
    onLinkedChange?.(false, { botLabel: null, chatLabel: null });
  };

  const showError = (msg: string) => {
    setStatusTone('error');
    setStatusMsg(msg);
  };

  const verify = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      showError('Enter a bot token from @BotFather');
      return;
    }
    setVerifying(true);
    setStatusMsg(null);
    try {
      const result = await channels.discoverTelegram(trimmed);
      if (!result.ok) {
        showError(result.error ?? 'Token rejected. Check the token from @BotFather and try again.');
        return;
      }
      const label = result.botUsername ? `@${result.botUsername}` : result.botName ?? 'Bot';
      setBotLabel(label);
      if (!result.chats?.length) {
        setChatLabel(null);
        setPhase('awaiting-chat');
        setStatusTone('info');
        setStatusMsg(`Token verified for ${label}. Now open Telegram, send any private message to your bot, then run the chat detection.`);
        return;
      }
      const chat = result.chats[0]!;
      setChatLabel(chat.title);
      setPhase('linked');
      setTokenConfigured(true);
      onLinkedChange?.(true, { botLabel: label, chatLabel: chat.title });
      setStatusMsg(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <WizardStepShell
      codename="MODULE · TELEGRAM RELAY"
      title="Establish Field Link"
      subtitle="Connect a Telegram bot to receive and send missions from your phone. Credentials are stored encrypted on this machine."
      icon={<SendIcon sx={{ fontSize: 24 }} />}
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <WizardStatusLine label="PROTOCOL" value="Telegram Bot API" />
        <WizardStatusLine label="INBOUND" value="Text · voice notes · files" />
        <WizardStatusLine label="REQUIREMENT" value="@BotFather token" />

        {phase === 'linked' && tokenConfigured ? (
          <Box sx={{
            mt: 2,
            mb: 1.5,
            p: 1.5,
            borderRadius: 1,
            border: `1px solid ${wizardTheme.accentOk}`,
            bgcolor: alphaColor(colors.accent.green, 0.06),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}>
            <Box>
              <Typography sx={{ fontFamily: WIZARD_MONO, fontSize: '0.62rem', color: wizardTheme.accentOk, mb: 0.25 }}>
                TOKEN ON FILE
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: wizardTheme.textDim }}>
                Bot token saved — leave blank to keep
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setToken('');
                resetToToken();
              }}
              sx={{
                fontFamily: WIZARD_MONO,
                fontSize: '0.6rem',
                color: wizardTheme.accentErr,
                borderColor: alphaColor(colors.accent.red, 0.3),
                '&:hover': { borderColor: wizardTheme.accentErr, bgcolor: alphaColor(colors.accent.red, 0.06) },
              }}
            >
              REPLACE
            </Button>
          </Box>
        ) : (
          <TextField
            fullWidth
            size="small"
            type="password"
            label="Bot token"
            placeholder="123456789:ABCdefGHI…"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              if (phase !== 'token') resetToToken();
            }}
            disabled={verifying || phase === 'awaiting-chat'}
            sx={{ mt: 2, mb: 1.5 }}
            slotProps={wizardTextFieldSlotProps}
          />
        )}

        {/* Step tracker — makes the two checks explicit. */}
        <Box sx={{ mb: 2 }}>
          <StepRow
            index={1}
            label="Verify bot token"
            state={phase === 'token' ? 'active' : 'done'}
          />
          <StepRow
            index={2}
            label="Message your bot, then detect chat"
            state={phase === 'token' ? 'pending' : phase === 'awaiting-chat' ? 'active' : 'done'}
          />
        </Box>

        {phase === 'token' && (
          <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.textDim, mb: 2, lineHeight: 1.5, fontFamily: WIZARD_MONO }}>
            1. Message @BotFather on Telegram → /newbot<br />
            2. Paste the token above → Verify bot token
          </Typography>
        )}

        {phase === 'awaiting-chat' && (
          <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.textDim, mb: 2, lineHeight: 1.5, fontFamily: WIZARD_MONO }}>
            Almost there. Open Telegram, send <strong>any</strong> message to {botLabel ?? 'your bot'},
            then press <strong>Detect chat &amp; link</strong> below.
          </Typography>
        )}

        {linked && botLabel && chatLabel && (
          <Box sx={{
            mb: 1.5,
            p: 1.25,
            borderRadius: 1,
            border: `1px solid ${wizardTheme.panelBorder}`,
            bgcolor: alphaColor(colors.ink, 0.02),
          }}>
            <Typography sx={{
              fontSize: '0.62rem',
              fontFamily: WIZARD_MONO,
              color: wizardTheme.accentOk,
            }}>
              RELAY ACTIVE · {botLabel} → {chatLabel}
            </Typography>
          </Box>
        )}

        {statusMsg && !linked && (
          <Typography sx={{
            mb: 1.5,
            fontSize: '0.62rem',
            fontFamily: WIZARD_MONO,
            color: statusTone === 'error' ? wizardTheme.accentErr : wizardTheme.textSecondary,
          }}>
            {statusMsg}
          </Typography>
        )}

        {phase !== 'linked' && (
          <Button
            fullWidth
            variant="contained"
            onClick={() => { void verify(); }}
            disabled={verifying || !token.trim()}
            sx={{ ...wizardPrimaryBtnSx, py: 1.1 }}
          >
            {verifying
              ? (phase === 'awaiting-chat' ? 'DETECTING CHAT…' : 'VERIFYING TOKEN…')
              : phase === 'awaiting-chat'
                ? 'DETECT CHAT & LINK'
                : 'VERIFY BOT TOKEN'}
          </Button>
        )}

        <Typography sx={{ mt: 1.5, fontSize: '0.55rem', color: wizardTheme.textDim, textAlign: 'center', fontFamily: WIZARD_MONO }}>
          Skip to configure later in Settings → Channels
        </Typography>
      </Box>
    </WizardStepShell>
  );
}

function StepRow({ index, label, state }: { index: number; label: string; state: 'pending' | 'active' | 'done' }) {
  const color = state === 'done'
    ? wizardTheme.accentOk
    : state === 'active'
      ? wizardTheme.text
      : wizardTheme.textDim;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4 }}>
      <Box sx={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        flexShrink: 0,
        border: `1px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.55rem',
        fontFamily: WIZARD_MONO,
        color,
      }}>
        {state === 'done' ? '✓' : index}
      </Box>
      <Typography sx={{
        fontSize: '0.6rem',
        fontFamily: WIZARD_MONO,
        color,
        letterSpacing: '0.3px',
      }}>
        {label}
      </Typography>
    </Box>
  );
}
