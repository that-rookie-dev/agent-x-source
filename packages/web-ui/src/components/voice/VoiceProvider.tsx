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
import { useLocation } from 'react-router-dom';
import { voice, personaApi } from '../../api';
import { getCoreSessionId } from '../../perf/api-cache';
import { useWakeWord } from '../../hooks/useWakeWord';
import { useVoiceWarmup, type VoiceWarmupPhase } from '../../hooks/useVoiceWarmup';
import { useVoiceCommsSession, type VoiceCommsContextInput } from '../../hooks/useVoiceCommsSession';
import { voiceDisabledReason } from '../../voice/support';
import { resolveWakePhrase } from '../../voice/wake-phrase';
import type { VoiceConfig, VoiceSidecarHealth } from '../../api';
import { VoiceToolPermissionModal } from './VoiceToolPermissionModal';
const VOICE_ACTIVE_STORAGE_KEY = 'agentx_voice_active_v1';

function readVoiceActiveFromStorage(): boolean {
  try {
    return localStorage.getItem(VOICE_ACTIVE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeVoiceActiveToStorage(active: boolean): void {
  try {
    localStorage.setItem(VOICE_ACTIVE_STORAGE_KEY, active ? '1' : '0');
  } catch {
    // ignore
  }
}

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
  /** Dashboard voice card active state (persisted across navigation). */
  voiceActive: boolean;
  setVoiceActive: (active: boolean) => void;
}

/** Separate context for the dashboard comms session — avoids circular type
 *  dependency between VoiceContextValue and useVoiceCommsSession's return type. */
interface VoiceCommsContextValue {
  comms: ReturnType<typeof useVoiceCommsSession> | null;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);
const VoiceCommsContext = createContext<VoiceCommsContextValue | null>(null);

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

/** Access the dashboard voice comms session (stays alive across navigation). */
export function useVoiceCommsOptional(): VoiceCommsContextValue | null {
  return useContext(VoiceCommsContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const location = useLocation();
  // PTT (Space key) only works on the dashboard page. Duplex works everywhere.
  const isDashboard = location.pathname === '/' || location.pathname === '/console' || location.pathname === '/console/dashboard';
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState(() => resolveWakePhrase());
  const [canRunWeb, setCanRunWeb] = useState(false);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [voiceActive, setVoiceActiveState] = useState(() => readVoiceActiveFromStorage());
  const inlineVoiceHandlerRef = useRef<((autoStart?: boolean) => void) | null>(null);
  const voiceChatBridgeRef = useRef<VoiceChatBridge | null>(null);
  const voiceConsumersRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);

  const warmup = useVoiceWarmup(voiceEnabled, canRunWeb);

  const voiceReady = voiceEnabled && canRunWeb && !voiceDisabledReason();

  // Build the voice context input for useVoiceCommsSession (avoids circular dep
  // on useVoiceOptional when called from within VoiceProvider).
  const commsVoiceContext: VoiceCommsContextInput = useMemo(() => ({
    voiceConfig,
    warmupPhase: warmup.phase,
    voiceReady,
    warmupError: warmup.error,
  }), [voiceConfig, warmup.phase, voiceReady, warmup.error]);

  // Dashboard voice-only comms session — lives at VoiceProvider level so the
  // WebSocket stays alive across page navigation. PTT keyboard is gated to the
  // dashboard page only; duplex mode works on any page.
  const dashboardComms = useVoiceCommsSession({
    active: voiceActive && voiceReady,
    voiceOnly: true,
    requestMicOnActivate: true,
    voiceContext: commsVoiceContext,
    pttKeyboardEnabled: isDashboard,
  });

  const setVoiceActive = useCallback((active: boolean) => {
    setVoiceActiveState(active);
    writeVoiceActiveToStorage(active);
  }, []);

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

  // Retain/release the voice engine based on dashboard voiceActive state.
  // This keeps the engine warm as long as the dashboard voice card is active,
  // even when the user navigates to other pages.
  useEffect(() => {
    if (voiceActive && voiceReady) {
      retainVoiceEngine();
      return () => { releaseVoiceEngine(); };
    }
  }, [voiceActive, voiceReady, retainVoiceEngine, releaseVoiceEngine]);

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
    voiceReady,
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
    voiceActive,
    setVoiceActive,
  }), [
    activateInlineVoice,
    registerChatSession,
    registerInlineVoiceHandler,
    registerVoiceChatBridge,
    getVoiceChatBridge,
    activeChatSessionId,
    coreSessionId,
    voiceReady,
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
    voiceActive,
    setVoiceActive,
  ]);

  const commsContextValue = useMemo<VoiceCommsContextValue>(() => ({
    comms: dashboardComms,
  }), [dashboardComms]);

  return (
    <VoiceContext.Provider value={value}>
      <VoiceCommsContext.Provider value={commsContextValue}>
        {children}
        {/* Global voice permission modal — rendered at the app root so it's
            available on any page, not just the dashboard or chat. */}
        <VoiceToolPermissionModal
          open={Boolean(dashboardComms.session.permissionPrompt)}
          prompt={dashboardComms.session.permissionPrompt}
          onRespond={dashboardComms.session.respondToPermission}
        />
      </VoiceCommsContext.Provider>
    </VoiceContext.Provider>
  );
}
