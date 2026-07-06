import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMicrophonePermission } from './useMicrophonePermission';
import { useVoiceKeyboard } from './useVoiceKeyboard';
import { useVoiceSession } from './useVoiceSession';
import { useVoiceOptional } from '../components/voice/VoiceProvider';
import { voiceDisabledReason, markVoiceOutputUnlocked } from '../voice/support';
import { loadVoiceInputMode, saveVoiceInputMode, type VoiceInputMode } from '../voice/input-mode-preference';

export interface UseVoiceCommsSessionOptions {
  active: boolean;
  chatSessionId?: string | null;
  onAgentRunning?: () => void;
  /** Request OS mic permission when panel becomes active. */
  requestMicOnActivate?: boolean;
}

export function useVoiceCommsSession({
  active,
  chatSessionId,
  onAgentRunning,
  requestMicOnActivate = false,
}: UseVoiceCommsSessionOptions) {
  const mic = useMicrophonePermission();
  const voiceCtx = useVoiceOptional();
  const envBlocked = voiceDisabledReason();
  const [inputMode, setInputModeState] = useState<VoiceInputMode>(() => loadVoiceInputMode());

  const setInputMode = useCallback((mode: VoiceInputMode) => {
    setInputModeState(mode);
    saveVoiceInputMode(mode);
  }, []);

  const bootPhase = voiceCtx?.warmupPhase ?? 'idle';
  const commsReady = bootPhase === 'ready';
  const voiceReady = Boolean(voiceCtx?.voiceReady);
  const prerequisitesOk = active && voiceReady && !envBlocked;
  const micReady = mic.state === 'granted';
  const pttEnabled = prerequisitesOk && commsReady && micReady;
  const isDuplex = inputMode === 'duplex';

  const session = useVoiceSession(
    pttEnabled,
    inputMode,
    chatSessionId ?? undefined,
    { onAgentRunning },
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
    if (!pttEnabled) return;
    void session.startSession();
  }, [pttEnabled, inputMode, session.startSession]);

  useEffect(() => {
    if (active) return;
    session.cancel();
  }, [active, session]);

  const beginVoice = useCallback(async () => {
    if (!pttEnabled) return;
    markVoiceOutputUnlocked();
    await session.beginPushToTalk();
  }, [pttEnabled, session]);

  const endVoice = useCallback(async () => {
    if (!pttEnabled) return;
    await session.endPushToTalk();
  }, [pttEnabled, session]);

  useVoiceKeyboard({
    enabled: pttEnabled && active && !isDuplex,
    globalSpace: active,
    composerFocused: false,
    composerEmpty: true,
    pushToTalk: true,
    onBeginPushToTalk: () => { void beginVoice(); },
    onEndPushToTalk: () => { void endVoice(); },
    onToggleSession: () => {},
    onInterruptPlayback: () => session.interruptPlayback(),
  });

  const operatorActive = session.state === 'listening' && (isDuplex || session.holding);
  const agentActive = session.state === 'speaking';
  const relayBusy = session.state === 'connecting' || session.state === 'processing';

  const statusLabel = useMemo(() => {
    if (envBlocked) return envBlocked;
    if (!voiceReady) return 'Voice setup needed';
    if (bootPhase === 'booting') return 'Warming voice engine…';
    if (bootPhase === 'failed') return voiceCtx?.warmupError ?? 'Voice offline';
    if (!commsReady) return 'Linking comms…';
    if (mic.state !== 'granted') return mic.blocked ? 'Mic blocked' : 'Allow microphone';
    if (session.state === 'connecting') return 'Opening session…';
    if (isDuplex && session.state === 'listening') return 'Hands-free · speak naturally';
    if (session.holding && session.state === 'listening') return 'Recording · release Space';
    if (session.state === 'processing') return session.agentStatus || 'Processing…';
    if (session.state === 'speaking') return 'Agent speaking';
    if (commsReady && isDuplex) return 'Hands-free active';
    if (commsReady) return 'Hold Space to talk';
    return 'Standby';
  }, [
    envBlocked, voiceReady, bootPhase, voiceCtx?.warmupError, commsReady, mic.state, mic.blocked,
    session.state, session.holding, session.agentStatus, isDuplex,
  ]);

  return {
    mic,
    voiceCtx,
    envBlocked,
    inputMode,
    setInputMode,
    isDuplex,
    bootPhase,
    commsReady,
    voiceReady,
    pttEnabled,
    micReady,
    session,
    operatorActive,
    agentActive,
    relayBusy,
    statusLabel,
    beginVoice,
    endVoice,
  };
}
