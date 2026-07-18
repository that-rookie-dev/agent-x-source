import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import MicIcon from '@mui/icons-material/Mic';
import { voice, type VoiceConfig } from '../api';
import { useMicrophonePermission } from '../hooks/useMicrophonePermission';
import { useVoiceKeyboard } from '../hooks/useVoiceKeyboard';
import { useVoiceSession } from '../hooks/useVoiceSession';
import { hasSeenMicPreprompt, markMicPrepromptSeen } from '../utils/microphone-permission';
import { voiceDisabledReason } from '../voice/support';
import { ChatInputBar, type ChatInputBarHandle, type ChatInputBarProps } from './ChatInputBar';
import { VoiceControl } from './VoiceControl';
import { VoiceDeniedBanner } from './VoiceDeniedBanner';
import { VoiceOnboardingCard, dismissVoiceOnboarding, isVoiceOnboardingDismissed } from './VoiceOnboardingCard';
import { VoicePermissionDialog } from './VoicePermissionDialog';
import { VoicePlaybackControls } from './VoicePlaybackControls';
import { VoiceSessionBar } from './VoiceSessionBar';

export interface VoiceComposerSectionProps extends ChatInputBarProps {
  chatSessionId?: string | null;
  onVoiceTranscript?: (text: string, empty: boolean) => void;
  onVoiceAgentRunning?: () => void;
  onVoiceStatus?: (status: string) => void;
  onVoiceTextOnly?: () => void;
}

export const VoiceComposerSection = React.forwardRef<ChatInputBarHandle, VoiceComposerSectionProps>(function VoiceComposerSection({
  chatSessionId,
  onVoiceTranscript,
  onVoiceAgentRunning,
  onVoiceStatus,
  onVoiceTextOnly,
  ...props
}, ref) {
  const navigate = useNavigate();
  const location = useLocation();
  const startVoicePendingRef = useRef(Boolean((location.state as { startVoice?: boolean } | null)?.startVoice));
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [canRunWeb, setCanRunWeb] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [prepromptOpen, setPrepromptOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [duplexActive, setDuplexActive] = useState(false);
  const prevSessionRef = useRef<string | null | undefined>(chatSessionId);
  const mic = useMicrophonePermission();
  const webMode = voiceConfig?.mode?.web ?? 'off';
  const voiceEnabled = Boolean(voiceConfig?.enabled) && webMode !== 'off';
  const envBlocked = voiceDisabledReason();
  const isDuplex = webMode === 'duplex';
  const session = useVoiceSession(
    voiceEnabled && canRunWeb && mic.state === 'granted' && !envBlocked,
    isDuplex ? 'duplex' : 'push-to-talk',
    {
      onTranscriptFinal: onVoiceTranscript,
      onAgentRunning: onVoiceAgentRunning,
    },
  );

  useEffect(() => {
    onVoiceStatus?.(session.agentStatus);
  }, [session.agentStatus, onVoiceStatus]);

  useEffect(() => {
    if (prevSessionRef.current && prevSessionRef.current !== chatSessionId) {
      if (session.holding || session.state !== 'idle') {
        session.cancel();
        setDuplexActive(false);
      }
    }
    prevSessionRef.current = chatSessionId;
  }, [chatSessionId, session]);

  const fetchVoiceState = useCallback(async () => {
    try {
      const cfg = await voice.getConfig();
      const caps = await voice.capabilities();
      const nextWebMode = cfg.mode?.web ?? 'off';
      setVoiceConfig(cfg);
      setCanRunWeb(Boolean(caps.capabilities.canRunWeb));
      setShowOnboarding(Boolean(cfg.enabled) && nextWebMode !== 'off' && !isVoiceOnboardingDismissed() && mic.state !== 'granted');
    } catch {
      setVoiceConfig(null);
    }
  }, [mic.state]);

  useEffect(() => {
    void fetchVoiceState();
  }, [fetchVoiceState, webMode]);

  useEffect(() => {
    const onVoiceUpdated = () => { void fetchVoiceState(); };
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
  }, [fetchVoiceState]);

  const requestMicWithPreprompt = useCallback(async () => {
    if (!hasSeenMicPreprompt()) {
      setPrepromptOpen(true);
      return false;
    }
    const ok = await mic.requestAccess();
    if (ok) {
      dismissVoiceOnboarding();
      setShowOnboarding(false);
      setPermissionOpen(false);
      setPrepromptOpen(false);
    } else {
      setPermissionOpen(true);
    }
    return ok;
  }, [mic]);

  const handleEnableMic = async () => {
    await requestMicWithPreprompt();
  };

  const handlePrepromptContinue = async () => {
    markMicPrepromptSeen();
    setPrepromptOpen(false);
    const ok = await mic.requestAccess();
    if (ok) {
      dismissVoiceOnboarding();
      setShowOnboarding(false);
    } else {
      setPermissionOpen(true);
    }
  };

  const beginVoice = async () => {
    if (envBlocked) return;
    if (!canRunWeb) {
      navigate('/console/settings?voice=1');
      return;
    }
    if (mic.blocked) {
      setPermissionOpen(true);
      return;
    }
    if (mic.state !== 'granted') {
      await requestMicWithPreprompt();
      return;
    }
    if (isDuplex) {
      setDuplexActive(true);
      await session.startSession();
      return;
    }
    await session.beginPushToTalk();
  };

  const endVoice = async () => {
    if (isDuplex) {
      setDuplexActive(false);
      session.cancel();
      return;
    }
    await session.endPushToTalk();
  };

  const toggleDuplexSession = async () => {
    if (duplexActive || session.holding) {
      setDuplexActive(false);
      session.cancel();
    } else {
      await beginVoice();
    }
  };

  useEffect(() => {
    if (!startVoicePendingRef.current || !voiceEnabled || !canRunWeb || mic.blocked || envBlocked) return;
    startVoicePendingRef.current = false;
    navigate(location.pathname + location.search, { replace: true, state: {} });
    void beginVoice();
  }, [voiceEnabled, canRunWeb, mic.blocked, envBlocked, navigate, location.pathname, location.search]);

  useVoiceKeyboard({
    enabled: voiceEnabled && canRunWeb && !envBlocked,
    composerFocused,
    composerEmpty,
    pushToTalk: !isDuplex,
    onBeginPushToTalk: () => { void beginVoice(); },
    onEndPushToTalk: () => { void endVoice(); },
    onToggleSession: () => { void (isDuplex ? toggleDuplexSession() : beginVoice()); },
    onInterruptPlayback: () => session.interruptPlayback(),
  });

  const disabledReason = envBlocked
    ?? (!canRunWeb ? 'Complete voice setup in Settings' : undefined);

  return (
    <>
      {voiceEnabled && envBlocked && (
        <Alert severity="warning" sx={{ mx: 1.25, mb: 0.5, py: 0.25 }}>
          {envBlocked}
        </Alert>
      )}
      {voiceEnabled && (
        <Chip
          size="small"
          icon={<MicIcon sx={{ fontSize: 14 }} />}
          label={
            mic.blocked ? 'Mic blocked'
              : session.state === 'listening' ? 'Listening'
                : session.state === 'processing' ? 'Transcribing'
                  : session.agentStatus || session.state === 'speaking' ? 'Speaking'
                    : canRunWeb ? 'Voice ready' : 'Voice setup needed'
          }
          sx={{ ml: 1.25, mb: 0.5, fontSize: '0.55rem', height: 20, alignSelf: 'flex-start' }}
          onClick={() => {
            if (mic.blocked) setPermissionOpen(true);
            else if (!canRunWeb) navigate('/console/settings?voice=1');
          }}
        />
      )}
      {voiceEnabled && mic.blocked && (
        <VoiceDeniedBanner
          instructions={mic.setupInstructions}
          onTryAgain={() => { void mic.requestAccess(); }}
          onOpenSettings={() => { void mic.openSettings(); }}
          onUseText={() => setPermissionOpen(false)}
        />
      )}
      {showOnboarding && (
        <VoiceOnboardingCard
          onEnableMic={() => { void handleEnableMic(); }}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}
      {session.error && (
        <Alert severity="error" sx={{ mx: 1.25, mb: 0.5, py: 0.25 }} action={
          <Chip size="small" label="Retry" onClick={session.retryPermission} sx={{ cursor: 'pointer' }} />
        }>
          {session.error}
        </Alert>
      )}
      <VoiceSessionBar
        state={session.state}
        mode={isDuplex ? 'duplex' : 'push-to-talk'}
        transcript={session.transcript}
        agentStatus={session.agentStatus}
        recordingSeconds={session.recordingSeconds}
        countdownActive={session.countdownActive}
        audioLevel={session.audioLevel}
        muted={session.muted}
        onMuteToggle={() => session.setMuted(!session.muted)}
        onStop={session.interruptPlayback}
        onEndSession={session.cancel}
      />
      <VoicePlaybackControls
        visible={session.state === 'speaking' && !session.textOnlyPlayback}
        onStop={session.interruptPlayback}
        onReplay={() => { void session.replayPlayback(); }}
        onTextOnly={() => {
          session.setPlaybackTextOnly();
          onVoiceTextOnly?.();
        }}
      />
      <ChatInputBar
        ref={ref}
        {...props}
        onComposerStateChange={({ focused, empty }) => {
          setComposerFocused(focused);
          setComposerEmpty(empty);
        }}
        voiceSlot={(
          <VoiceControl
            enabled={voiceEnabled && !envBlocked}
            blocked={mic.blocked}
            active={session.holding || session.state === 'listening' || session.state === 'speaking' || duplexActive}
            duplex={isDuplex}
            disabledReason={disabledReason}
            onPressStart={() => { void beginVoice(); }}
            onPressEnd={() => { void endVoice(); }}
            onBlockedClick={() => setPermissionOpen(true)}
          />
        )}
      />
      <VoicePermissionDialog
        open={permissionOpen}
        helpText={mic.helpText}
        setupInstructions={mic.setupInstructions}
        onRequest={() => { void handleEnableMic(); }}
        onClose={() => setPermissionOpen(false)}
        onOpenSettings={() => { void mic.openSettings(); }}
      />
      <VoicePermissionDialog
        open={prepromptOpen}
        helpText={mic.helpText}
        setupInstructions={mic.setupInstructions}
        preprompt
        onRequest={() => { void handlePrepromptContinue(); }}
        onClose={() => setPrepromptOpen(false)}
        onOpenSettings={() => { void mic.openSettings(); }}
      />
    </>
  );
});
