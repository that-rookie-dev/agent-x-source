import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import MicIcon from '@mui/icons-material/Mic';
import { colors } from '../theme';
import { health, config as configApi } from '../api';
import { cachedApiCall } from '../perf/api-cache';
import { useNeuralBrainSupported, useCapabilitiesReady } from '../hooks/useSystemCapabilities';
import { useVoiceOptional } from './voice/VoiceProvider';

const NEURON_URL = (import.meta.env.VITE_NEURON_URL as string) || '/neuron';

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
  const neuralBrainSupported = useNeuralBrainSupported();
  const capabilitiesReady = useCapabilitiesReady();
  const [neuralBrainDisabled, setNeuralBrainDisabled] = useState(true);
  const voice = useVoiceOptional();
  const showFooterMic = Boolean(voice?.voiceReady && !voice.wakeWordEnabled);
  const showWakeIndicator = Boolean(voice?.voiceReady && voice.wakeWordEnabled);

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
    if (!capabilitiesReady) return;
    if (!neuralBrainSupported) {
      setNeuralBrainDisabled(true);
      return;
    }
    cachedApiCall('config', () => configApi.get(), 60_000)
      .then((cfg) => setNeuralBrainDisabled(cfg.neuralBrain === false)).catch(() => {
      setNeuralBrainDisabled(false);
    });
  }, [neuralBrainSupported, capabilitiesReady]);

  const handleBrainClick = () => {
    const agentx = (window as unknown as { agentx?: { openInternalWindow?: (url: string) => Promise<boolean> } }).agentx;
    if (agentx?.openInternalWindow) {
      agentx.openInternalWindow(NEURON_URL);
    } else {
      window.open(NEURON_URL, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Box sx={{
      flexShrink: 0, borderTop: `1px solid ${colors.border.default}`,
      px: 2, py: 0.5, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.52rem', color: colors.text.dim,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: -0.5 }}>
        {capabilitiesReady && !neuralBrainDisabled && (
          <>
            <Box
              component="span"
              onClick={handleBrainClick}
              sx={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                color: colors.text.dim, '&:hover': { color: colors.accent.blue },
                transition: 'color 0.15s',
              }}
              title="Open Neural Brain"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                <path d="M3.477 10.896a4 4 0 0 1 .585-.178" />
                <path d="M19.938 10.719a4 4 0 0 1 .586.178" />
                <path d="M6.5 17.599a3 3 0 0 0-1.375.399" />
                <path d="M17.5 17.599a3 3 0 0 0 1.375.399" />
              </svg>
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
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
