import Box from '@mui/material/Box';
import { useEffect, useMemo } from 'react';
import { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { useVoiceOptional } from './VoiceProvider';
import { VoiceWaveCard } from './VoiceWaveCard';
import { friendlyVoiceError } from './voice-comms-theme';
import type { VoiceTurnTimings } from '../../voice/VoiceSessionClient';

export interface ChatVoicePanelProps {
  chatSessionId: string | null;
  onVoiceUserPending?: () => void;
  onVoiceUserDiscarded?: () => void;
  onAgentRunning?: () => void;
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onVoiceTiming?: (timings: VoiceTurnTimings) => void;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
}

export function ChatVoicePanel({
  chatSessionId,
  onVoiceUserPending,
  onVoiceUserDiscarded,
  onAgentRunning,
  onTranscriptFinal,
  onVoiceTiming,
}: ChatVoicePanelProps) {
  const voiceCtx = useVoiceOptional();

  useEffect(() => {
    if (!chatSessionId) return;
    voiceCtx?.retainVoiceEngine();
    return () => { voiceCtx?.releaseVoiceEngine(); };
  }, [chatSessionId, voiceCtx?.retainVoiceEngine, voiceCtx?.releaseVoiceEngine]);

  const comms = useVoiceCommsSession({
    active: Boolean(chatSessionId),
    chatSessionId,
    onVoiceUserPending,
    onVoiceUserDiscarded,
    onAgentRunning,
    onTranscriptFinal,
    onVoiceTiming,
    requestMicOnActivate: true,
  });

  const waveLevel = useMemo(() => {
    if (comms.waveMode === 'user') return comms.session.audioLevel;
    if (comms.waveMode === 'agent') return comms.session.playbackLevel;
    return 0;
  }, [comms.waveMode, comms.session.audioLevel, comms.session.playbackLevel]);

  const linkReady = comms.commsReady && comms.micReady && comms.session.pttReady && comms.session.state !== 'connecting';
  const standbyHint = linkReady ? 'Hold Space to speak' : comms.statusLabel;
  const notice = comms.session.warning
    ?? (comms.session.error ? friendlyVoiceError(comms.session.error) : null);

  return (
    <Box sx={{ px: 1.25, py: 0.5 }}>
      <VoiceWaveCard
        phase={comms.commsPhase}
        waveMode={comms.waveMode}
        waveLevel={waveLevel}
        turnPipeline={comms.session.turnPipeline}
        standbyHint={standbyHint}
        statusLabel={comms.statusLabel}
        error={notice}
      />
    </Box>
  );
}
