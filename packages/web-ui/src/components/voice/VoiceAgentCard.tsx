import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import { colors, alphaColor, MONO } from '../../theme';
import { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { useVoiceOptional } from './VoiceProvider';
import { getCoreSessionId } from '../../perf/api-cache';
import { voiceDisabledReason } from '../../voice/support';
import { VoiceWaveform } from './VoiceWaveform';
import { CommsSpinner } from './CommsSpinner';

/**
 * Voice Agent card for the Bento dashboard.
 *
 * Lifecycle of the circular mic button:
 *  1. disabled (grey) — voice not enabled or kit not ready
 *  2. enabled (accent) — voice session active, mic icon visible
 *  3. recording (green wave) — spacebar held, recording user voice
 *  4. thinking (spinner) — spacebar released, waiting for agent response
 *  5. speaking (purple wave) — TTS response playing
 *  6. back to enabled (2) when TTS ends
 */

type ButtonPhase = 'disabled' | 'idle' | 'recording' | 'thinking' | 'speaking';

export function VoiceAgentCard() {
  const voiceCtx = useVoiceOptional();
  const envBlocked = voiceDisabledReason();
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  // Resolve the super-session (Agent-X core session) once.
  useEffect(() => {
    if (!voiceCtx?.voiceReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = await getCoreSessionId();
        if (!cancelled) setCoreSessionId(id);
      } catch { /* ignore — card stays disabled */ }
    })();
    return () => { cancelled = true; };
  }, [voiceCtx?.voiceReady]);

  const sessionReady = Boolean(coreSessionId) && Boolean(voiceCtx?.voiceReady) && !envBlocked;

  // Wire voice comms to the core session only when the user toggles voice on.
  const comms = useVoiceCommsSession({
    active: voiceActive && sessionReady,
    chatSessionId: coreSessionId,
    requestMicOnActivate: true,
  });

  // Retain/release the voice engine when the card is active.
  useEffect(() => {
    if (voiceActive && sessionReady) {
      voiceCtx?.retainVoiceEngine();
      return () => { voiceCtx?.releaseVoiceEngine(); };
    }
  }, [voiceActive, sessionReady, voiceCtx?.retainVoiceEngine, voiceCtx?.releaseVoiceEngine]);

  // Derive the button phase from comms state.
  const phase: ButtonPhase = useMemo(() => {
    if (!voiceActive || !sessionReady) return 'disabled';
    if (comms.commsPhase === 'operator_record') return 'recording';
    if (comms.commsPhase === 'agent_tx') return 'speaking';
    if (comms.commsPhase === 'operator_stt' || comms.commsPhase === 'relay_process' || comms.commsPhase === 'agent_prep') return 'thinking';
    if (comms.commsPhase === 'boot' || comms.commsPhase === 'link') return 'thinking';
    return 'idle';
  }, [voiceActive, sessionReady, comms.commsPhase]);

  const handleClick = () => {
    if (!sessionReady) return;
    setVoiceActive((prev) => !prev);
  };

  const waveLevel = phase === 'recording'
    ? comms.session.audioLevel
    : phase === 'speaking'
      ? comms.session.playbackLevel
      : 0;

  const statusText = (() => {
    if (!voiceActive) return 'Click to activate';
    if (!sessionReady) return 'Voice kit required';
    if (phase === 'disabled') return 'Click to activate';
    if (phase === 'recording') return 'Listening… release Space';
    if (phase === 'thinking') return comms.statusLabel || 'Thinking…';
    if (phase === 'speaking') return 'Agent speaking';
    return 'Hold Space to speak';
  })();

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1.5,
      height: '100%',
      minHeight: 180,
      py: 2,
    }}>
      <Tooltip title={sessionReady ? (voiceActive ? 'Click to disable voice' : 'Click to enable voice') : 'Deploy voice kit first'}>
        <Box
          onClick={handleClick}
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: sessionReady ? 'pointer' : 'default',
            transition: 'all 0.25s ease',
            position: 'relative',
            border: `2px solid ${phaseColor(phase, true)}`,
            bgcolor: phase === 'disabled'
              ? alphaColor(colors.text.dim, '0a')
              : phase === 'idle'
                ? alphaColor(colors.accent.blue, '14')
                : phase === 'recording'
                  ? alphaColor(colors.accent.green, '1a')
                  : phase === 'speaking'
                    ? alphaColor(colors.accent.purple, '1a')
                    : alphaColor(colors.accent.orange, '14'),
            '&:hover': sessionReady && phase === 'idle' ? {
              borderColor: colors.accent.blue,
              transform: 'scale(1.05)',
              boxShadow: `0 0 16px ${alphaColor(colors.accent.blue, '33')}`,
            } : {},
            ...(phase === 'recording' && {
              animation: 'voicePulseRec 1.5s ease-in-out infinite',
              '@keyframes voicePulseRec': {
                '0%, 100%': { boxShadow: `0 0 8px ${alphaColor(colors.accent.green, '33')}` },
                '50%': { boxShadow: `0 0 20px ${alphaColor(colors.accent.green, '66')}` },
              },
            }),
            ...(phase === 'speaking' && {
              animation: 'voicePulseSpeak 1.2s ease-in-out infinite',
              '@keyframes voicePulseSpeak': {
                '0%, 100%': { boxShadow: `0 0 8px ${alphaColor(colors.accent.purple, '33')}` },
                '50%': { boxShadow: `0 0 20px ${alphaColor(colors.accent.purple, '66')}` },
              },
            }),
          }}
        >
          {phase === 'recording' || phase === 'speaking' ? (
            <Box sx={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <VoiceWaveform
                level={waveLevel}
                active
                accent={phase === 'recording' ? colors.accent.green : colors.accent.purple}
                bars={14}
                height={40}
              />
            </Box>
          ) : phase === 'thinking' ? (
            <CommsSpinner color={colors.accent.orange} size={32} />
          ) : phase === 'disabled' ? (
            <MicOffIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
          ) : (
            <MicIcon sx={{ fontSize: 28, color: colors.accent.blue }} />
          )}
        </Box>
      </Tooltip>

      <Typography sx={{
        fontSize: '0.62rem',
        fontFamily: MONO,
        color: phase === 'disabled'
          ? colors.text.dim
          : phase === 'recording'
            ? colors.accent.green
            : phase === 'speaking'
              ? colors.accent.purple
              : phase === 'thinking'
                ? colors.accent.orange
                : colors.text.secondary,
        textAlign: 'center',
        letterSpacing: '0.03em',
        transition: 'color 0.2s',
      }}>
        {statusText}
      </Typography>
    </Box>
  );
}

function phaseColor(phase: ButtonPhase, border: boolean): string {
  switch (phase) {
    case 'disabled': return colors.border.default;
    case 'idle': return border ? alphaColor(colors.accent.blue, '66') : colors.accent.blue;
    case 'recording': return border ? alphaColor(colors.accent.green, '66') : colors.accent.green;
    case 'thinking': return border ? alphaColor(colors.accent.orange, '66') : colors.accent.orange;
    case 'speaking': return border ? alphaColor(colors.accent.purple, '66') : colors.accent.purple;
  }
}
