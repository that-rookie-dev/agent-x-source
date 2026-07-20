import { useState, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import MicIcon from '@mui/icons-material/Mic';
import { colors } from '../theme';
import { health } from '../api';
import { cachedApiCall } from '../perf/api-cache';
import { useVoiceOptional, useVoiceCommsOptional } from './voice/VoiceProvider';

function getZoomShortcutHint(): string {
  if (typeof navigator === 'undefined') return 'zoom Ctrl +/− · Ctrl 0';
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    || navigator.userAgent.includes('Mac');
  return isMac ? 'zoom ⌘ +/− · ⌘ 0' : 'zoom Ctrl +/− · Ctrl 0';
}

export interface FooterProps {
  onToggleLogs?: () => void;
  logsOpen?: boolean;
}

export function Footer({ onToggleLogs, logsOpen }: FooterProps) {
  const [version, setVersion] = useState('');
  const [zoomHint] = useState(getZoomShortcutHint);
  const voice = useVoiceOptional();
  const commsCtx = useVoiceCommsOptional();
  const comms = commsCtx?.comms;
  const showFooterMic = Boolean(voice?.voiceReady && !voice.wakeWordEnabled);
  const showWakeIndicator = Boolean(voice?.voiceReady && voice.wakeWordEnabled);

  // Derive voice status text from the dashboard comms session so the user can
  // see the exact voice state (listening/thinking/speaking) from any page.
  const voiceStatusText = useMemo(() => {
    if (!voice?.voiceActive || !comms) return null;
    const phase = comms.commsPhase;
    if (phase === 'operator_record') return 'listening';
    if (phase === 'agent_tx') return 'speaking';
    if (phase === 'operator_stt' || phase === 'relay_process' || phase === 'agent_prep') return 'thinking';
    if (phase === 'boot' || phase === 'link') return 'connecting';
    return comms.isDuplex ? 'listening' : 'idle';
  }, [voice?.voiceActive, comms?.commsPhase, comms?.isDuplex]);

  const voiceStatusColor = (() => {
    if (!voiceStatusText) return colors.text.dim;
    if (voiceStatusText === 'listening') return colors.accent.green;
    if (voiceStatusText === 'speaking') return colors.accent.purple;
    if (voiceStatusText === 'thinking') return colors.accent.orange;
    if (voiceStatusText === 'connecting') return colors.accent.orange;
    return colors.text.secondary;
  })();

  const footerMicColor = !voice
    ? colors.text.dim
    : voice.warmupPhase === 'ready'
      ? colors.accent.green
      : voice.warmupPhase === 'booting'
        ? colors.accent.orange
        : voice.warmupPhase === 'failed'
          ? colors.accent.red
          : colors.text.dim;

  const footerMicTitle = !voice
    ? 'Voice unavailable'
    : voice.warmupPhase === 'failed'
      ? voice.warmupError ?? 'Voice engine offline — check Settings → Voice'
      : voice.warmupPhase === 'booting'
        ? 'Warming voice engine…'
        : voice.warmupPhase === 'ready'
          ? 'Voice engine ready'
          : 'Voice idle';

  useEffect(() => {
    cachedApiCall('health', () => health.check(), 30_000)
      .then((h) => setVersion(h.version))
      .catch(() => {});
  }, []);

  return (
    <Box sx={{
      flexShrink: 0, borderTop: `1px solid ${colors.border.default}`,
      px: 2, py: 0.5, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.52rem', color: colors.text.dim,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: -0.5 }}>
        <span>🇮🇳 Made in India</span>
        <span style={{ color: colors.border.default }}>/</span>
        <span>
          Created by{' '}
          <Box
            component="a"
            href="mailto:sivaprakash.rajendran.316@gmail.com"
            title="sivaprakash.rajendran.316@gmail.com"
            sx={{
              color: colors.text.secondary,
              textDecoration: 'none',
              transition: 'color 0.15s',
              '&:hover': { color: colors.accent.blue, textDecoration: 'none' },
            }}
          >
            Sivaprakash Rajendran
          </Box>
        </span>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {showWakeIndicator && voice && (
          <>
            <Box
              component="span"
              title={`Wake word active — say "${voice.wakePhrase}" in chat voice mode`}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                color: colors.accent.green,
                letterSpacing: '0.04em',
                userSelect: 'none',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: colors.accent.green,
                  boxShadow: `0 0 6px ${colors.accent.green}`,
                  animation: 'agentx-wake-pulse 2s ease-in-out infinite',
                  '@keyframes agentx-wake-pulse': {
                    '0%, 100%': { opacity: 0.45, transform: 'scale(0.85)' },
                    '50%': { opacity: 1, transform: 'scale(1)' },
                  },
                }}
              />
              <span>wake · {voice.wakePhrase}</span>
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        {showFooterMic && voice && (
          <>
            <Box
              component="span"
              title={footerMicTitle}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                color: footerMicColor,
                letterSpacing: '0.04em',
                userSelect: 'none',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: footerMicColor,
                  boxShadow: voice.warmupPhase === 'ready' ? `0 0 6px ${colors.accent.green}` : 'none',
                  animation: voice.warmupPhase === 'booting'
                    ? 'agentx-voice-warm-pulse 1.4s ease-in-out infinite'
                    : 'none',
                  '@keyframes agentx-voice-warm-pulse': {
                    '0%, 100%': { opacity: 0.35 },
                    '50%': { opacity: 1 },
                  },
                }}
              />
              <MicIcon sx={{ fontSize: 13 }} />
              {voiceStatusText && (
                <Box
                  component="span"
                  sx={{
                    color: voiceStatusColor,
                    transition: 'color 0.2s',
                    minWidth: 52,
                  }}
                >
                  {voiceStatusText}
                </Box>
              )}
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        {onToggleLogs && (
          <>
            <Box
              component="span"
              onClick={onToggleLogs}
              sx={{
                cursor: 'pointer', letterSpacing: '0.5px', userSelect: 'none',
                color: logsOpen ? colors.accent.blue : colors.text.dim,
                transition: 'color 0.15s',
                '&:hover': { color: colors.text.secondary },
              }}
            >
              logger
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        {version && (
          <>
            <span>v{version}</span>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        <span>{zoomHint}</span>
      </Box>
    </Box>
  );
}
