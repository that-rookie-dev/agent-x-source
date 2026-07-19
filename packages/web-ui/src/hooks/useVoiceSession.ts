import { useCallback, useEffect, useRef, useState } from 'react';
import { syncAuthTokenFromSession } from '../api';
import { VoiceSessionClient, type VoiceClientState, type VoiceTurnTimings, type VoicePermissionPrompt, type VoicePermissionChoice } from '../voice/VoiceSessionClient';
import { VOICE_MAX_TURN_SECONDS, VOICE_TURN_COUNTDOWN_FROM_SECONDS, VOICE_MIN_RECORDING_MS, VOICE_ACCIDENTAL_TAP_MS, VOICE_MIN_SPEECH_LEVEL } from '../voice/constants';
import { type VoiceTurnPipeline } from '../voice/voice-turn-pipeline';
import { markVoiceOutputUnlocked } from '../voice/support';
import { sanitizeVoiceDisplayText } from '../voice/sanitize-display-text';
import { friendlyVoiceError } from '../components/voice/voice-comms-theme';

export type VoiceHookState = VoiceClientState;

export interface VoiceSessionCallbacks {
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onVoiceUserPending?: () => void;
  onVoiceUserDiscarded?: () => void;
  onAgentRunning?: () => void;
  onVoiceTiming?: (timings: VoiceTurnTimings) => void;
}

export function useVoiceSession(
  enabled: boolean,
  mode: 'push-to-talk' | 'duplex' = 'push-to-talk',
  chatSessionIdOrCallbacks?: string | VoiceSessionCallbacks,
  callbacks?: VoiceSessionCallbacks,
  voiceOnly?: boolean,
) {
  const chatSessionId = typeof chatSessionIdOrCallbacks === 'string'
    ? chatSessionIdOrCallbacks
    : undefined;
  const resolvedCallbacks = typeof chatSessionIdOrCallbacks === 'object'
    ? chatSessionIdOrCallbacks
    : callbacks;
  const callbacksRef = useRef(resolvedCallbacks);
  callbacksRef.current = resolvedCallbacks;

  const clientRef = useRef<VoiceSessionClient | null>(null);
  const [state, setState] = useState<VoiceHookState>('idle');
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [agentStatus, setAgentStatus] = useState('');
  const [agentText, setAgentText] = useState('');
  const [playbackLevel, setPlaybackLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const warningTimerRef = useRef<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [silenceProgress, setSilenceProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [textOnlyPlayback, setTextOnlyPlayback] = useState(false);
  const [voiceTimings, setVoiceTimings] = useState<VoiceTurnTimings | null>(null);
  const [permissionPrompt, setPermissionPrompt] = useState<VoicePermissionPrompt | null>(null);
  const [agentTurnComplete, setAgentTurnComplete] = useState(false);
  const [pttTurnLocked, setPttTurnLocked] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [turnPipeline, setTurnPipeline] = useState<VoiceTurnPipeline>('idle');
  const [pttReady, setPttReady] = useState(false);
  const pttTurnLockedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const pushToTalkActiveRef = useRef(false);
  const pttCaptureActiveRef = useRef(false);
  const pendingEndRef = useRef(false);
  const holdStartedAtRef = useRef(0);
  const maxAudioDuringHoldRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingSeconds(0);
  }, []);

  useEffect(() => () => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
  }, []);

  useEffect(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, [chatSessionId, mode]);

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setState('idle');
      setHolding(false);
      stopTimer();
    }
  }, [enabled, stopTimer]);

  const unlockPttTurn = useCallback(() => {
    pttTurnLockedRef.current = false;
    setPttTurnLocked(false);
    setPlaybackActive(false);
    setTurnPipeline('idle');
    setPttReady(Boolean(clientRef.current?.isPttReady()));
  }, []);

  const syncPttReady = useCallback(() => {
    setPttReady(Boolean(clientRef.current?.isPttReady()));
  }, []);

  const resetPipelineIfIdle = useCallback(() => {
    setTurnPipeline((prev) => {
      if (pttTurnLockedRef.current || pushToTalkActiveRef.current) return prev;
      return 'idle';
    });
  }, []);

  const ensureClient = useCallback(() => {
    if (!enabled) return null;
    if (!clientRef.current) {
      clientRef.current = new VoiceSessionClient({
        mode,
        chatSessionId,
        voiceOnly,
        onStateChange: (nextState) => {
          setState(nextState);
          if (nextState === 'listening' || nextState === 'ready') {
            setError(null);
          }
          if (nextState === 'ready' && mode === 'push-to-talk' && !clientRef.current?.isPlaybackActive()) {
            setPlaybackActive(false);
            if (!pttTurnLockedRef.current && !pushToTalkActiveRef.current) {
              setTurnPipeline((prev) => (
                prev === 'linking' || prev === 'opening_mic' ? 'idle' : prev
              ));
              setPttReady(Boolean(clientRef.current?.isPttReady()));
            }
          }
          if (nextState === 'connecting') {
            setTurnPipeline((prev) => (
              prev === 'idle' || prev === 'capturing' || prev === 'opening_mic' ? 'linking' : prev
            ));
          }
          if (nextState === 'processing') {
            setTurnPipeline((prev) => (
              prev === 'sending_audio' || prev === 'transcribing' || pttTurnLockedRef.current
                ? 'transcribing'
                : prev
            ));
          }
        },
        onTranscriptPartial: (text) => {
          setPartialTranscript(text);
          setTurnPipeline((prev) => (
            prev === 'sending_audio' || prev === 'transcribing' || pttTurnLockedRef.current
              ? 'transcribing'
              : prev
          ));
        },
        onTranscriptPending: () => {
          callbacksRef.current?.onVoiceUserPending?.();
        },
        onTranscriptFinal: (text, empty) => {
          if (empty || !text.trim()) {
            callbacksRef.current?.onVoiceUserDiscarded?.();
            unlockPttTurn();
          } else {
            setTurnPipeline('agent_thinking');
          }
          callbacksRef.current?.onTranscriptFinal?.(text, Boolean(empty));
          setTranscript(text);
          setPartialTranscript('');
          setAgentText('');
          setSilenceProgress(0);
          setVoiceTimings(null);
          setWarning(null);
        },
        onAgentText: (text) => {
          setAgentText(sanitizeVoiceDisplayText(text));
          setTurnPipeline((prev) => (
            prev === 'agent_thinking' ? 'llm_processing' : prev
          ));
        },
        onAgentStatus: (status) => {
          setAgentStatus(status === 'running' ? 'Agent processing' : status === 'speaking' ? 'Transmitting' : status);
          if (status === 'running') {
            setAgentTurnComplete(false);
            setSilenceProgress(0);
            setTurnPipeline('llm_processing');
            callbacksRef.current?.onAgentRunning?.();
          }
          if (status === 'listening') {
            // Barge-in or duplex recovery: reset the pipeline so the UI turns
            // green immediately instead of staying orange ("Agent thinking…").
            setAgentTurnComplete(false);
            setPlaybackActive(false);
            setPlaybackLevel(0);
            setAgentText('');
            setSilenceProgress(0);
            setTurnPipeline('idle');
          }
          if (status === 'complete') {
            setAgentTurnComplete(true);
            window.setTimeout(() => {
              if (!clientRef.current?.isPlaybackActive()) {
                unlockPttTurn();
              }
            }, 150);
          }
          if (status === 'speaking' || status === 'complete') setSilenceProgress(0);
        },
        onError: (message) => {
          unlockPttTurn();
          setError(friendlyVoiceError(message));
        },
        onWarning: (message) => {
          setError(null);
          setWarning(friendlyVoiceError(message));
          if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
          warningTimerRef.current = window.setTimeout(() => setWarning(null), 6000);
        },
        onAudioLevel: (level) => {
          if (pushToTalkActiveRef.current) {
            maxAudioDuringHoldRef.current = Math.max(maxAudioDuringHoldRef.current, level);
          }
          setAudioLevel(level);
        },
        onPlaybackLevel: (level) => {
          setPlaybackLevel(level);
          if (level > 0.04) {
            setPlaybackActive(true);
            setTurnPipeline('speaking');
          }
        },
        onPlaybackIdle: () => {
          setPlaybackActive(false);
          setPlaybackLevel(0);
          setTurnPipeline('idle');
          if (pttTurnLockedRef.current) unlockPttTurn();
        },
        onRecordingDiscarded: (reason) => {
          unlockPttTurn();
          callbacksRef.current?.onVoiceUserDiscarded?.();
          setWarning(
            reason === 'too_short'
              ? 'Hold Space a little longer, then speak'
              : 'Could not capture voice — try again',
          );
          if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
          warningTimerRef.current = window.setTimeout(() => setWarning(null), 4000);
        },
        onDuplexSilence: (elapsedMs, thresholdMs) => {
          if (mode !== 'duplex') {
            setSilenceProgress(0);
            return;
          }
          if (elapsedMs <= 0) {
            setSilenceProgress(0);
            return;
          }
          setSilenceProgress(thresholdMs > 0 ? Math.min(1, elapsedMs / thresholdMs) : 0);
        },
        onVoiceTiming: (timings) => {
          setVoiceTimings(timings);
          callbacksRef.current?.onVoiceTiming?.(timings);
        },
        onPermissionPrompt: (prompt) => setPermissionPrompt(prompt),
        onPermissionResolved: () => setPermissionPrompt(null),
      });
    }
    return clientRef.current;
  }, [enabled, mode, chatSessionId, unlockPttTurn]);

  const ensureVoiceAuthToken = useCallback(async () => {
    await syncAuthTokenFromSession();
  }, []);

  const startSession = useCallback(async () => {
    const client = ensureClient();
    if (!client) return;
    setError(null);
    setTextOnlyPlayback(false);
    markVoiceOutputUnlocked();
    await ensureVoiceAuthToken();
    await client.connect();
    if (mode === 'duplex') await client.startListening();
  }, [ensureClient, ensureVoiceAuthToken, mode]);

  /** Warm WebSocket + mic so Space starts recording immediately. */
  const ensurePttReady = useCallback(async () => {
    if (!enabled) return;
    let client = ensureClient();
    if (!client) return;
    if (client.isPttReady()) {
      syncPttReady();
      resetPipelineIfIdle();
      return;
    }
    setError(null);
    try {
      if (!client.isLinkLive()) {
        if (client.getState() !== 'idle') {
          client.disconnect();
          client = ensureClient();
          if (!client) return;
        }
        setTurnPipeline((prev) => (prev === 'idle' ? 'linking' : prev));
        await ensureVoiceAuthToken();
        await client.connect();
      }
      if (!client.isMicPrepared()) {
        setTurnPipeline((prev) => (
          prev === 'idle' || prev === 'linking' ? 'opening_mic' : prev
        ));
        await client.prepareMicrophone();
      }
      syncPttReady();
    } catch (err) {
      setPttReady(false);
      setError(friendlyVoiceError(err instanceof Error ? err.message : 'Voice setup failed'));
      resetPipelineIfIdle();
    } finally {
      resetPipelineIfIdle();
      syncPttReady();
    }
  }, [enabled, ensureClient, ensureVoiceAuthToken, resetPipelineIfIdle, syncPttReady]);

  /** @deprecated Use ensurePttReady — kept for callers that only need the socket. */
  const ensureSessionLink = ensurePttReady;

  const stopSession = useCallback(() => {
    pushToTalkActiveRef.current = false;
    pttCaptureActiveRef.current = false;
    pendingEndRef.current = false;
    clientRef.current?.disconnect();
    clientRef.current = null;
    setHolding(false);
    stopTimer();
    setState('idle');
    setAgentStatus('');
    setAgentTurnComplete(false);
    pttTurnLockedRef.current = false;
    setPttTurnLocked(false);
    setPlaybackActive(false);
    setTurnPipeline('idle');
    setPttReady(false);
    setPermissionPrompt(null);
  }, [stopTimer]);

  const respondToPermission = useCallback((choice: VoicePermissionChoice) => {
    clientRef.current?.respondToPermission(choice);
    setPermissionPrompt(null);
  }, []);

  const shouldDiscardCapture = useCallback((heldMs: number, listenedMs: number, peakAudio: number) => {
    const effectiveMs = Math.max(heldMs, listenedMs);
    if (effectiveMs < VOICE_ACCIDENTAL_TAP_MS) return true;
    if (effectiveMs < VOICE_MIN_RECORDING_MS && peakAudio < VOICE_MIN_SPEECH_LEVEL) return true;
    return false;
  }, []);

  const finishPushToTalkCapture = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const heldMs = holdStartedAtRef.current > 0 ? Date.now() - holdStartedAtRef.current : 0;
    const listenedMs = client.getListenDurationMs();
    const peakAudio = maxAudioDuringHoldRef.current;
    pttCaptureActiveRef.current = false;

    // Reflect each in-flight step — do not skip to transcribing before audio is sent.
    setTurnPipeline('sending_audio');
    pttTurnLockedRef.current = true;
    setPttTurnLocked(true);
    callbacksRef.current?.onVoiceUserPending?.();

    if (shouldDiscardCapture(heldMs, listenedMs, peakAudio)) {
      holdStartedAtRef.current = 0;
      maxAudioDuringHoldRef.current = 0;
      await client.cancelListening();
      unlockPttTurn();
      callbacksRef.current?.onVoiceUserDiscarded?.();
      setWarning('Hold Space a little longer, then speak');
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
      warningTimerRef.current = window.setTimeout(() => setWarning(null), 4000);
      return;
    }
    try {
      await client.stopListening();
      holdStartedAtRef.current = 0;
      maxAudioDuringHoldRef.current = 0;
      setTurnPipeline('transcribing');
    } catch (err) {
      holdStartedAtRef.current = 0;
      maxAudioDuringHoldRef.current = 0;
      unlockPttTurn();
      setError(friendlyVoiceError(err instanceof Error ? err.message : 'Voice capture failed'));
    }
  }, [shouldDiscardCapture, unlockPttTurn]);

  const beginPushToTalk = useCallback(async () => {
    const client = ensureClient();
    if (!client || muted) return;
    pushToTalkActiveRef.current = true;
    pendingEndRef.current = false;
    holdStartedAtRef.current = Date.now();
    maxAudioDuringHoldRef.current = 0;
    setError(null);
    setTextOnlyPlayback(false);
    setAgentTurnComplete(false);
    setHolding(true);
    markVoiceOutputUnlocked();
    try {
      if (!client.isPttReady()) {
        if (!client.isLinkLive()) {
          setTurnPipeline('linking');
          await ensureVoiceAuthToken();
          await client.connect();
        }
        if (!pushToTalkActiveRef.current) {
          setHolding(false);
          resetPipelineIfIdle();
          return;
        }
        if (!client.isMicPrepared()) {
          setTurnPipeline('opening_mic');
          await client.prepareMicrophone();
        }
      }
      if (!pushToTalkActiveRef.current) {
        setHolding(false);
        resetPipelineIfIdle();
        syncPttReady();
        return;
      }
      client.armCapture();
      pttCaptureActiveRef.current = true;
      setTurnPipeline('capturing');
      syncPttReady();
      if (!pushToTalkActiveRef.current || pendingEndRef.current) {
        pendingEndRef.current = false;
        await finishPushToTalkCapture();
        setHolding(false);
        return;
      }
    } catch (err) {
      pushToTalkActiveRef.current = false;
      pttCaptureActiveRef.current = false;
      pendingEndRef.current = false;
      setHolding(false);
      pttTurnLockedRef.current = false;
      setPttTurnLocked(false);
      resetPipelineIfIdle();
      setError(friendlyVoiceError(err instanceof Error ? err.message : 'Voice capture failed'));
      return;
    }
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => {
        const next = prev + 1;
        if (next >= VOICE_MAX_TURN_SECONDS) {
          void client.stopListening();
          pushToTalkActiveRef.current = false;
          setHolding(false);
          stopTimer();
        }
        return next;
      });
    }, 1000);
  }, [ensureClient, ensureVoiceAuthToken, muted, stopTimer, finishPushToTalkCapture, resetPipelineIfIdle, syncPttReady]);

  const endPushToTalk = useCallback(async () => {
    const wasCapturing = pushToTalkActiveRef.current || pttCaptureActiveRef.current;
    pushToTalkActiveRef.current = false;
    setHolding(false);
    stopTimer();
    if (!wasCapturing) {
      pendingEndRef.current = false;
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    if (client.getState() !== 'listening') {
      pendingEndRef.current = true;
      return;
    }
    pendingEndRef.current = false;
    await finishPushToTalkCapture();
  }, [stopTimer, finishPushToTalkCapture]);

  useEffect(() => {
    if (!enabled || mode !== 'push-to-talk') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const client = clientRef.current;
      if (pttTurnLocked && !pushToTalkActiveRef.current && client) {
        const s = client.getState();
        if (s === 'ready' || s === 'idle' || s === 'error') {
          unlockPttTurn();
        }
      }
      void ensurePttReady();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, mode, pttTurnLocked, ensurePttReady, unlockPttTurn]);

  const beginTalk = mode === 'duplex' ? startSession : beginPushToTalk;
  const endTalk = mode === 'duplex' ? stopSession : endPushToTalk;

  const interruptPlayback = useCallback(() => {
    clientRef.current?.interruptPlayback();
    unlockPttTurn();
  }, [unlockPttTurn]);

  const replayPlayback = useCallback(async () => {
    await clientRef.current?.replayPlayback();
  }, []);

  const setPlaybackTextOnly = useCallback(() => {
    setTextOnlyPlayback(true);
    clientRef.current?.setTextOnlyPlayback(true);
  }, []);

  const setToggles = useCallback((toggles: { searchWeb?: boolean; bypassChip?: boolean }) => {
    clientRef.current?.setToggles(toggles);
  }, []);

  const requestCallKickoff = useCallback((reason: 'open' | 'resume' = 'open') => {
    return clientRef.current?.requestCallKickoff(reason) ?? false;
  }, []);

  const retryPermission = useCallback(() => {
    setError(null);
  }, []);

  const countdownActive = recordingSeconds >= VOICE_TURN_COUNTDOWN_FROM_SECONDS;

  return {
    state,
    transcript: partialTranscript || transcript,
    partialTranscript,
    finalTranscript: transcript,
    agentText,
    playbackLevel,
    agentStatus,
    agentTurnComplete,
    pttTurnLocked,
    playbackActive,
    turnPipeline,
    pttReady,
    error,
    holding: mode === 'duplex' ? state === 'listening' || state === 'speaking' || state === 'processing' : holding,
    recordingSeconds,
    countdownActive,
    audioLevel,
    silenceProgress,
    warning,
    muted,
    setMuted,
    mode,
    textOnlyPlayback,
    voiceTimings,
    permissionPrompt,
    respondToPermission,
    startSession,
    stopSession,
    ensureSessionLink,
    ensurePttReady,
    beginPushToTalk,
    endPushToTalk,
    beginTalk,
    endTalk,
    cancel: stopSession,
    interruptPlayback,
    replayPlayback,
    setPlaybackTextOnly,
    setToggles,
    requestCallKickoff,
    retryPermission,
  };
}
