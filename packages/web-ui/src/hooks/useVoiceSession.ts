import { useCallback, useEffect, useRef, useState } from 'react';
import { syncAuthTokenFromSession } from '../api';
import { VoiceSessionClient, type VoiceClientState } from '../voice/VoiceSessionClient';
import { VOICE_MAX_TURN_SECONDS, VOICE_TURN_COUNTDOWN_FROM_SECONDS } from '../voice/constants';
import { markVoiceOutputUnlocked } from '../voice/support';
import { friendlyVoiceError } from '../components/voice/voice-comms-theme';

export type VoiceHookState = VoiceClientState;

export interface VoiceSessionCallbacks {
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onAgentRunning?: () => void;
}

export function useVoiceSession(
  enabled: boolean,
  mode: 'push-to-talk' | 'duplex' = 'push-to-talk',
  chatSessionIdOrCallbacks?: string | VoiceSessionCallbacks,
  callbacks?: VoiceSessionCallbacks,
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
  const [holding, setHolding] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [silenceProgress, setSilenceProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [textOnlyPlayback, setTextOnlyPlayback] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pushToTalkActiveRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingSeconds(0);
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

  const ensureClient = useCallback(() => {
    if (!enabled) return null;
    if (!clientRef.current) {
      clientRef.current = new VoiceSessionClient({
        mode,
        chatSessionId,
        onStateChange: setState,
        onTranscriptPartial: setPartialTranscript,
        onTranscriptFinal: (text, empty) => {
          setTranscript(text);
          setPartialTranscript('');
          setAgentText('');
          setSilenceProgress(0);
          callbacksRef.current?.onTranscriptFinal?.(text, Boolean(empty));
        },
        onAgentText: setAgentText,
        onAgentStatus: (status) => {
          setAgentStatus(status === 'running' ? 'Agent processing' : status === 'speaking' ? 'Transmitting' : status);
          if (status === 'running' || status === 'complete') setSilenceProgress(0);
          if (status === 'running') callbacksRef.current?.onAgentRunning?.();
        },
        onError: (message) => setError(friendlyVoiceError(message)),
        onAudioLevel: setAudioLevel,
        onPlaybackLevel: setPlaybackLevel,
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
      });
    }
    return clientRef.current;
  }, [enabled, mode, chatSessionId]);

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

  const stopSession = useCallback(() => {
    pushToTalkActiveRef.current = false;
    clientRef.current?.disconnect();
    clientRef.current = null;
    setHolding(false);
    stopTimer();
    setState('idle');
    setAgentStatus('');
  }, [stopTimer]);

  const beginPushToTalk = useCallback(async () => {
    const client = ensureClient();
    if (!client || muted) return;
    pushToTalkActiveRef.current = true;
    setError(null);
    setTextOnlyPlayback(false);
    setHolding(true);
    markVoiceOutputUnlocked();
    try {
      await ensureVoiceAuthToken();
      await client.connect();
      if (!pushToTalkActiveRef.current) {
        await client.stopListening();
        setHolding(false);
        return;
      }
      await client.startListening();
      if (!pushToTalkActiveRef.current) {
        await client.stopListening();
        setHolding(false);
        return;
      }
    } catch (err) {
      pushToTalkActiveRef.current = false;
      setHolding(false);
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
  }, [ensureClient, ensureVoiceAuthToken, muted, stopTimer]);

  const endPushToTalk = useCallback(async () => {
    if (!pushToTalkActiveRef.current) return;
    pushToTalkActiveRef.current = false;
    setHolding(false);
    stopTimer();
    if (!clientRef.current) return;
    await clientRef.current.stopListening();
  }, [stopTimer]);

  const beginTalk = mode === 'duplex' ? startSession : beginPushToTalk;
  const endTalk = mode === 'duplex' ? stopSession : endPushToTalk;

  const interruptPlayback = useCallback(() => {
    clientRef.current?.interruptPlayback();
  }, []);

  const replayPlayback = useCallback(async () => {
    await clientRef.current?.replayPlayback();
  }, []);

  const setPlaybackTextOnly = useCallback(() => {
    setTextOnlyPlayback(true);
    clientRef.current?.setTextOnlyPlayback(true);
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
    error,
    holding: mode === 'duplex' ? state === 'listening' || state === 'speaking' || state === 'processing' : holding,
    recordingSeconds,
    countdownActive,
    audioLevel,
    silenceProgress,
    muted,
    setMuted,
    mode,
    textOnlyPlayback,
    startSession,
    stopSession,
    beginPushToTalk,
    endPushToTalk,
    beginTalk,
    endTalk,
    cancel: stopSession,
    interruptPlayback,
    replayPlayback,
    setPlaybackTextOnly,
    retryPermission,
  };
}
