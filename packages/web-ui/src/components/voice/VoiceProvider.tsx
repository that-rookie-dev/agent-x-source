import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { voice, personaApi, getAuthToken } from '../../api';
import { useWakeWord } from '../../hooks/useWakeWord';
import { useVoiceWarmup, type VoiceWarmupPhase } from '../../hooks/useVoiceWarmup';
import { voiceDisabledReason } from '../../voice/support';
import { resolveWakePhrase } from '../../voice/wake-phrase';
import { VoiceModal } from './VoiceModal';
import type { VoiceConfig, VoiceSidecarHealth } from '../../api';

interface VoiceContextValue {
  openVoiceModal: (sessionId?: string, autoStart?: boolean) => void;
  closeVoiceModal: () => void;
  registerChatSession: (sessionId: string | null) => void;
  registerInlineVoiceHandler: (handler: ((autoStart?: boolean) => void) | null) => void;
  registerVoiceChatBridge: (bridge: VoiceChatBridge | null) => void;
  getVoiceChatBridge: () => VoiceChatBridge | null;
  inlineVoiceAvailable: boolean;
  coreSessionId: string | null;
  voiceReady: boolean;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  warmupPhase: VoiceWarmupPhase;
  warmupHealth?: VoiceSidecarHealth;
  warmupError: string | null;
  warmupLabel: string;
  retryVoiceWarmup: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export interface VoiceChatBridge {
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onAgentRunning?: () => void;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error('useVoice must be used within VoiceProvider');
  }
  return ctx;
}

export function useVoiceOptional(): VoiceContextValue | null {
  return useContext(VoiceContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSessionId, setModalSessionId] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState(() => resolveWakePhrase());
  const [canRunWeb, setCanRunWeb] = useState(false);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const inlineVoiceHandlerRef = useRef<((autoStart?: boolean) => void) | null>(null);
  const voiceChatBridgeRef = useRef<VoiceChatBridge | null>(null);
  const modalSessionRef = useRef<string | null>(null);

  const applyVoiceConfigSnapshot = useCallback((cfg: VoiceConfig) => {
    setVoiceEnabled(Boolean(cfg.enabled));
    setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled));
  }, []);

  const loadVoiceState = useCallback(async () => {
    try {
      const [cfg, caps, core, persona] = await Promise.all([
        voice.getConfig(),
        voice.capabilities(),
        fetch('/api/agent-x-core/session', { method: 'POST', credentials: 'include' })
          .then((r) => r.json() as Promise<{ sessionId?: string }>)
          .catch(() => ({ sessionId: undefined })),
        personaApi.get().catch(() => ({} as Record<string, never>)),
      ]);
      setVoiceEnabled(Boolean(cfg.enabled));
      setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled));
      const personaName = typeof persona?.name === 'string' ? persona.name : null;
      setWakePhrase(resolveWakePhrase(personaName));
      setCanRunWeb(Boolean(caps.capabilities.canRunWeb));
      if (core.sessionId) setCoreSessionId(core.sessionId);
    } catch {
      setVoiceEnabled(false);
      setCanRunWeb(false);
    }
  }, []);

  useEffect(() => {
    void loadVoiceState();
    const onFocus = () => { void loadVoiceState(); };
    const onPersonaUpdated = () => { void loadVoiceState(); };
    const onVoiceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<VoiceConfig | undefined>).detail;
      if (detail) {
        applyVoiceConfigSnapshot(detail);
        return;
      }
      void loadVoiceState();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('agentx:persona-updated', onPersonaUpdated);
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('agentx:persona-updated', onPersonaUpdated);
      window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
    };
  }, [loadVoiceState, applyVoiceConfigSnapshot]);

  const resolveSession = useCallback((sessionId?: string) => {
    return sessionId ?? chatSessionId ?? coreSessionId;
  }, [chatSessionId, coreSessionId]);

  const openVoiceModal = useCallback((sessionId?: string, startListening = false) => {
    if (activeChatSessionId && inlineVoiceHandlerRef.current) {
      inlineVoiceHandlerRef.current(startListening);
      return;
    }
    const target = resolveSession(sessionId);
    if (!target) return;
    modalSessionRef.current = target;
    setModalSessionId(target);
    setAutoStart(startListening);
    setModalOpen(true);
  }, [resolveSession, activeChatSessionId]);

  const closeVoiceModal = useCallback(() => {
    setModalOpen(false);
    setAutoStart(false);
  }, []);

  const registerChatSession = useCallback((sessionId: string | null) => {
    setChatSessionId(sessionId);
    setActiveChatSessionId(sessionId);
  }, []);

  const registerInlineVoiceHandler = useCallback((handler: ((autoStart?: boolean) => void) | null) => {
    inlineVoiceHandlerRef.current = handler;
  }, []);

  const registerVoiceChatBridge = useCallback((bridge: VoiceChatBridge | null) => {
    voiceChatBridgeRef.current = bridge;
  }, []);

  const getVoiceChatBridge = useCallback(() => voiceChatBridgeRef.current, []);

  const onWakeWord = useCallback(() => {
    void (async () => {
      if (!voiceEnabled || !canRunWeb || voiceDisabledReason()) return;
      let sessionId = coreSessionId;
      if (!sessionId) {
        try {
          const core = await fetch('/api/agent-x-core/session', {
            method: 'POST',
            credentials: 'include',
            headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
          }).then((r) => r.json() as Promise<{ sessionId?: string }>);
          if (core.sessionId) {
            setCoreSessionId(core.sessionId);
            sessionId = core.sessionId;
          }
        } catch {
          return;
        }
      }
      if (!sessionId) return;
      openVoiceModal(sessionId, true);
    })();
  }, [voiceEnabled, canRunWeb, openVoiceModal, coreSessionId]);

  useWakeWord(wakeWordEnabled && voiceEnabled && canRunWeb, wakePhrase, onWakeWord);

  const warmup = useVoiceWarmup(voiceEnabled, canRunWeb);

  const value = useMemo<VoiceContextValue>(() => ({
    openVoiceModal,
    closeVoiceModal,
    registerChatSession,
    registerInlineVoiceHandler,
    registerVoiceChatBridge,
    getVoiceChatBridge,
    inlineVoiceAvailable: Boolean(activeChatSessionId),
    coreSessionId,
    voiceReady: voiceEnabled && canRunWeb && !voiceDisabledReason(),
    wakeWordEnabled,
    wakePhrase,
    warmupPhase: warmup.phase,
    warmupHealth: warmup.health,
    warmupError: warmup.error,
    warmupLabel: warmup.label,
    retryVoiceWarmup: warmup.retry,
  }), [
    openVoiceModal,
    closeVoiceModal,
    registerChatSession,
    registerInlineVoiceHandler,
    registerVoiceChatBridge,
    getVoiceChatBridge,
    activeChatSessionId,
    coreSessionId,
    voiceEnabled,
    canRunWeb,
    wakeWordEnabled,
    wakePhrase,
    warmup.phase,
    warmup.health,
    warmup.error,
    warmup.label,
    warmup.retry,
  ]);

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <VoiceModal
        open={modalOpen}
        chatSessionId={modalSessionId}
        onClose={closeVoiceModal}
        autoStart={autoStart}
      />
    </VoiceContext.Provider>
  );
}
