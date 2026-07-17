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
import { voice, personaApi } from '../../api';
import { getCoreSessionId } from '../../perf/api-cache';
import { useWakeWord } from '../../hooks/useWakeWord';
import { useVoiceWarmup, type VoiceWarmupPhase } from '../../hooks/useVoiceWarmup';
import { voiceDisabledReason } from '../../voice/support';
import { resolveWakePhrase } from '../../voice/wake-phrase';
import type { VoiceConfig, VoiceSidecarHealth } from '../../api';

interface VoiceContextValue {
  /** Switch the active chat session to inline voice mode (chat page only). */
  activateInlineVoice: (autoStart?: boolean) => void;
  registerChatSession: (sessionId: string | null) => void;
  registerInlineVoiceHandler: (handler: ((autoStart?: boolean) => void) | null) => void;
  registerVoiceChatBridge: (bridge: VoiceChatBridge | null) => void;
  getVoiceChatBridge: () => VoiceChatBridge | null;
  inlineVoiceAvailable: boolean;
  coreSessionId: string | null;
  voiceReady: boolean;
  /** Merged voice configuration (engine, mode, etc.). */
  voiceConfig: VoiceConfig | null;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  warmupPhase: VoiceWarmupPhase;
  warmupHealth?: VoiceSidecarHealth;
  warmupError: string | null;
  warmupLabel: string;
  /** Settings → keep engine running at launch (docking warm-up). */
  engineWarmAtLaunch: boolean;
  ensureVoiceWarmup: () => void;
  retainVoiceEngine: () => void;
  releaseVoiceEngine: () => void;
  releaseVoiceSidecar: () => void;
  retryVoiceWarmup: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export interface VoiceChatBridge {
  onVoiceUserPending?: () => void;
  onVoiceUserDiscarded?: () => void;
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
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState(() => resolveWakePhrase());
  const [canRunWeb, setCanRunWeb] = useState(false);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const inlineVoiceHandlerRef = useRef<((autoStart?: boolean) => void) | null>(null);
  const voiceChatBridgeRef = useRef<VoiceChatBridge | null>(null);
  const voiceConsumersRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);

  const warmup = useVoiceWarmup(voiceEnabled, canRunWeb);

  const retainVoiceEngine = useCallback(() => {
    voiceConsumersRef.current += 1;
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    warmup.ensureWarmup();
  }, [warmup.ensureWarmup]);

  const releaseVoiceEngine = useCallback(() => {
    voiceConsumersRef.current = Math.max(0, voiceConsumersRef.current - 1);
    if (voiceConsumersRef.current > 0) return;
    if (warmup.engineWarmAtLaunch) return;

    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null;
      if (voiceConsumersRef.current === 0 && !warmup.engineWarmAtLaunch) {
        warmup.releaseSidecar();
      }
    }, 400);
  }, [warmup.releaseSidecar, warmup.engineWarmAtLaunch]);

  const applyVoiceConfigSnapshot = useCallback((cfg: VoiceConfig) => {
    setVoiceConfig(cfg);
    setVoiceEnabled(Boolean(cfg.enabled));
    // Wake word uses browser SpeechRecognition; it works with any engine, but the
    // toggle is disabled for xAI in settings to avoid confusion. Keep it off here.
    setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled) && cfg.engine !== 'realtime_xai');
  }, []);

  const loadVoiceState = useCallback(async () => {
    try {
      const [cfg, caps, coreSessionId, persona] = await Promise.all([
        voice.getConfig(),
        voice.capabilities(),
        getCoreSessionId().catch(() => null),
        personaApi.get().catch(() => ({} as Record<string, never>)),
      ]);
      setVoiceConfig(cfg);
      setVoiceEnabled(Boolean(cfg.enabled));
      setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled) && cfg.engine !== 'realtime_xai');
      const personaName = typeof persona?.name === 'string' ? persona.name : null;
      setWakePhrase(resolveWakePhrase(personaName));
      setCanRunWeb(Boolean(caps.capabilities.canRunWeb));
      if (coreSessionId) setCoreSessionId(coreSessionId);
    } catch {
      setVoiceConfig(null);
      setVoiceEnabled(false);
      setCanRunWeb(false);
    }
  }, []);

  useEffect(() => {
    const defer = () => { void loadVoiceState(); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(defer, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(defer, 1200);
    return () => window.clearTimeout(timer);
  }, [loadVoiceState]);

  useEffect(() => {
    const onFocus = () => { void loadVoiceState(); };
    const onPersonaUpdated = () => { void loadVoiceState(); };
    const onVoiceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<VoiceConfig | undefined>).detail;
      if (detail) {
        applyVoiceConfigSnapshot(detail);
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

  const activateInlineVoice = useCallback((startListening = false) => {
    if (!voiceEnabled || !canRunWeb || voiceDisabledReason()) return;
    if (!activeChatSessionId || !inlineVoiceHandlerRef.current) return;
    inlineVoiceHandlerRef.current(startListening);
  }, [activeChatSessionId, voiceEnabled, canRunWeb]);

  const registerChatSession = useCallback((sessionId: string | null) => {
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
    activateInlineVoice(true);
  }, [activateInlineVoice]);

  useWakeWord(wakeWordEnabled && voiceEnabled && canRunWeb, wakePhrase, onWakeWord);

  const value = useMemo<VoiceContextValue>(() => ({
    activateInlineVoice,
    registerChatSession,
    registerInlineVoiceHandler,
    registerVoiceChatBridge,
    getVoiceChatBridge,
    inlineVoiceAvailable: Boolean(activeChatSessionId),
    coreSessionId,
    voiceReady: voiceEnabled && canRunWeb && !voiceDisabledReason(),
    voiceConfig,
    wakeWordEnabled,
    wakePhrase,
    warmupPhase: warmup.phase,
    warmupHealth: warmup.health,
    warmupError: warmup.error,
    warmupLabel: warmup.label,
    engineWarmAtLaunch: warmup.engineWarmAtLaunch,
    ensureVoiceWarmup: warmup.ensureWarmup,
    retainVoiceEngine,
    releaseVoiceEngine,
    releaseVoiceSidecar: releaseVoiceEngine,
    retryVoiceWarmup: warmup.retry,
  }), [
    activateInlineVoice,
    registerChatSession,
    registerInlineVoiceHandler,
    registerVoiceChatBridge,
    getVoiceChatBridge,
    activeChatSessionId,
    coreSessionId,
    voiceEnabled,
    canRunWeb,
    voiceConfig,
    wakeWordEnabled,
    wakePhrase,
    warmup.phase,
    warmup.health,
    warmup.error,
    warmup.label,
    warmup.engineWarmAtLaunch,
    warmup.ensureWarmup,
    retainVoiceEngine,
    releaseVoiceEngine,
    warmup.retry,
  ]);

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  );
}
