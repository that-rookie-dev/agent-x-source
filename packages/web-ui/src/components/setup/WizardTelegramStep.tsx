import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';
import { channels } from '../../api';
import { WizardStatusLine, WizardStepShell } from './wizard-step-shell';
import { wizardPrimaryBtnSx, wizardTextFieldSlotProps, wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export interface WizardTelegramStepProps {
  onLinkedChange?: (linked: boolean) => void;
}

/** Two-phase link flow: 1) validate token, 2) detect the chat after user messages the bot. */
type LinkPhase = 'token' | 'awaiting-chat' | 'linked';

export function WizardTelegramStep({ onLinkedChange }: WizardTelegramStepProps) {
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');
  const [phase, setPhase] = useState<LinkPhase>('token');
  const [botLabel, setBotLabel] = useState<string | null>(null);
  const [chatLabel, setChatLabel] = useState<string | null>(null);

  const linked = phase === 'linked';

  const resetToToken = () => {
    setPhase('token');
    setBotLabel(null);
    setChatLabel(null);
    setStatusMsg(null);
    onLinkedChange?.(false);
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
        // Phase 1 passed: token is valid, but no chat yet. Move to phase 2.
        setChatLabel(null);
        setPhase('awaiting-chat');
        setStatusTone('info');
        setStatusMsg(`Token verified for ${label}. Now open Telegram, send any private message to your bot, then run the chat detection.`);
        return;
      }
      // Both phases satisfied in one shot (user already messaged the bot).
      const chat = result.chats[0]!;
      setChatLabel(chat.title);
      setPhase('linked');
      onLinkedChange?.(true);
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

        <TextField
          fullWidth
          size="small"
          type="password"
          label="Bot token"
          placeholder="123456789:ABCdefGHI…"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            resetToToken();
          }}
          disabled={verifying || phase !== 'token'}
          sx={{ mt: 2, mb: 1.5 }}
          slotProps={wizardTextFieldSlotProps}
        />

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
              : linked
                ? 'RE-VERIFY LINK'
                : 'VERIFY BOT TOKEN'}
        </Button>

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
