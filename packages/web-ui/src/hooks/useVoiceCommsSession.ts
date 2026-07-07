import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMicrophonePermission } from './useMicrophonePermission';
import { useVoiceKeyboard } from './useVoiceKeyboard';
import { useVoiceSession } from './useVoiceSession';
import { useVoiceOptional } from '../components/voice/VoiceProvider';
import { voiceDisabledReason, markVoiceOutputUnlocked } from '../voice/support';
import { loadVoiceInputMode, saveVoiceInputMode, type VoiceInputMode } from '../voice/input-mode-preference';
import { VOICE_HANDS_FREE_ENABLED } from '../voice/voice-config';
import {
  computePushToTalkBlocked,
  resolvePttCommsPhase,
  resolvePttWaveMode,
} from '../voice/voice-ptt-orchestration';
import { pipelineStatusLabel } from '../voice/voice-turn-pipeline';
import type { VoiceTurnTimings } from '../voice/VoiceSessionClient';

export interface UseVoiceCommsSessionOptions {
  active: boolean;
  chatSessionId?: string | null;
  onVoiceUserPending?: () => void;
  onVoiceUserDiscarded?: () => void;
  onAgentRunning?: () => void;
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onVoiceTiming?: (timings: VoiceTurnTimings) => void;
  /** Request OS mic permission when panel becomes active. */
  requestMicOnActivate?: boolean;
}

export function useVoiceCommsSession({
  active,
  chatSessionId,
  onVoiceUserPending,
  onVoiceUserDiscarded,
  onAgentRunning,
  onTranscriptFinal,
  onVoiceTiming,
  requestMicOnActivate = false,
}: UseVoiceCommsSessionOptions) {
  const mic = useMicrophonePermission();
  const voiceCtx = useVoiceOptional();
  const envBlocked = voiceDisabledReason();
  const [inputMode, setInputModeState] = useState<VoiceInputMode>(() => loadVoiceInputMode());

  const setInputMode = useCallback((mode: VoiceInputMode) => {
    if (!VOICE_HANDS_FREE_ENABLED && mode === 'duplex') return;
    setInputModeState(mode);
    saveVoiceInputMode(mode);
  }, []);

  const bootPhase = voiceCtx?.warmupPhase ?? 'idle';
  const commsReady = bootPhase === 'ready';
  const voiceReady = Boolean(voiceCtx?.voiceReady);
  const prerequisitesOk = active && voiceReady && !envBlocked;
  const micReady = mic.state === 'granted';
  const pttEnabled = prerequisitesOk && commsReady && micReady;
  const effectiveInputMode = VOICE_HANDS_FREE_ENABLED ? inputMode : 'push-to-talk';
  const isDuplex = effectiveInputMode === 'duplex';

  const session = useVoiceSession(
    pttEnabled,
    effectiveInputMode,
    chatSessionId ?? undefined,
    { onVoiceUserPending, onVoiceUserDiscarded, onAgentRunning, onTranscriptFinal, onVoiceTiming },
  );

  useEffect(() => {
    if (!active || !requestMicOnActivate) return;
    void mic.refresh();
  }, [active, requestMicOnActivate, mic.refresh]);

  useEffect(() => {
    if (!active || !requestMicOnActivate || envBlocked) return;
    if (mic.state === 'granted' || mic.state === 'denied') return;
    void mic.requestAccess();
  }, [active, requestMicOnActivate, envBlocked, mic.state, mic.requestAccess]);

  useEffect(() => {
    if (!pttEnabled || isDuplex) return;
    void session.ensurePttReady();
  }, [pttEnabled, isDuplex, session.ensurePttReady]);

  useEffect(() => {
    if (!pttEnabled) return;
    if (!isDuplex) return;
    void session.startSession();
  }, [pttEnabled, isDuplex, session.startSession]);

  useEffect(() => {
    if (active) return;
    session.cancel();
  }, [active, session]);

  const beginVoice = useCallback(async () => {
    if (!pttEnabled) return;
    if (session.pttTurnLocked && !(session.playbackActive && session.agentTurnComplete)) return;
    markVoiceOutputUnlocked();
    await session.beginPushToTalk();
  }, [pttEnabled, session]);

  const endVoice = useCallback(async () => {
    if (!pttEnabled) return;
    await session.endPushToTalk();
  }, [pttEnabled, session]);

  const toggleInputMode = useCallback(() => {
    if (!VOICE_HANDS_FREE_ENABLED) return;
    session.cancel();
    setInputMode(isDuplex ? 'push-to-talk' : 'duplex');
  }, [isDuplex, session, setInputMode]);

  const pushToTalkBlocked = computePushToTalkBlocked({
    state: session.state,
    holding: session.holding,
    pttTurnLocked: session.pttTurnLocked,
    agentTurnComplete: session.agentTurnComplete,
    playbackActive: session.playbackActive,
    playbackLevel: session.playbackLevel,
  });

  const handleBeginPushToTalk = useCallback(() => {
    if (session.playbackActive && session.agentTurnComplete) {
      session.interruptPlayback();
    }
    void beginVoice();
  }, [session, beginVoice]);

  useVoiceKeyboard({
    enabled: pttEnabled && active,
    globalSpace: active,
    composerFocused: false,
    composerEmpty: true,
    pushToTalk: !isDuplex,
    pushToTalkBlocked,
    onBeginPushToTalk: handleBeginPushToTalk,
    onEndPushToTalk: () => { void endVoice(); },
    onToggleSession: () => {},
    onInterruptPlayback: () => session.interruptPlayback(),
    onDoubleTapSpace: VOICE_HANDS_FREE_ENABLED ? toggleInputMode : undefined,
  });

  const operatorText = (session.finalTranscript || session.partialTranscript || session.transcript).trim();
  const commsPhase = resolvePttCommsPhase({
    bootPhase,
    commsReady,
    state: session.state,
    holding: session.holding,
    isDuplex,
    operatorText,
    agentText: session.agentText,
    playbackLevel: session.playbackLevel,
    pttTurnLocked: session.pttTurnLocked,
    playbackActive: session.playbackActive,
    turnPipeline: session.turnPipeline,
  });

  const operatorActive = session.state === 'listening' && (isDuplex || session.holding);
  const agentActive = session.state === 'speaking' || session.playbackActive || session.playbackLevel > 0.04;
  const waveMode = resolvePttWaveMode(session.turnPipeline, operatorActive, agentActive);
  const relayBusy = session.pttTurnLocked || session.state === 'connecting' || session.state === 'processing';
  const pipelineLabel = pipelineStatusLabel(session.turnPipeline, {
    agentStatus: session.agentStatus,
    partialTranscript: session.partialTranscript,
  });

  const statusLabel = useMemo(() => {
    if (envBlocked) return envBlocked;
    if (!voiceReady) return 'Voice setup needed';
    if (bootPhase === 'booting') return 'Warming voice engine…';
    if (bootPhase === 'idle') return 'Starting voice engine…';
    if (bootPhase === 'failed') return voiceCtx?.warmupError ?? 'Voice offline';
    if (!commsReady) return 'Linking comms…';
    if (mic.state !== 'granted') return mic.blocked ? 'Mic blocked' : 'Allow microphone';
    if (session.pttReady && !session.pttTurnLocked && !session.holding) return 'Hold Space to speak';
    if (pipelineLabel) return pipelineLabel;
    if (session.pttTurnLocked) {
      if (commsPhase === 'operator_stt') return 'Preparing voice…';
      if (commsPhase === 'relay_process') return session.agentStatus || 'Thinking…';
      if (commsPhase === 'agent_prep') return 'Preparing response…';
      if (commsPhase === 'agent_tx') return 'Agent speaking';
    }
    if (commsReady) return 'Hold Space to speak';
    return 'Standby';
  }, [
    envBlocked, voiceReady, bootPhase, voiceCtx?.warmupError, commsReady, mic.state, mic.blocked,
    session.agentStatus, session.pttTurnLocked, session.turnPipeline, session.partialTranscript, session.pttReady, commsPhase, pipelineLabel,
  ]);

  return {
    mic,
    voiceCtx,
    envBlocked,
    inputMode: effectiveInputMode,
    setInputMode,
    isDuplex,
    handsFreeEnabled: VOICE_HANDS_FREE_ENABLED,
    bootPhase,
    commsReady,
    voiceReady,
    pttEnabled,
    micReady,
    session,
    commsPhase,
    waveMode,
    operatorActive,
    agentActive,
    relayBusy,
    pushToTalkBlocked,
    statusLabel,
    beginVoice,
    endVoice,
  };
}
