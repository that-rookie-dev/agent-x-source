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
import { crewChat, sessions } from '../../api';
import { useVoiceOptional } from '../voice/VoiceProvider';
import { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { sanitizeVoiceDisplayText } from '../../voice/sanitize-display-text';
import { CrewCallModal } from './CrewCallModal';
import { mapCallHistoryMessages } from './map-call-transcript';
import type { CrewCallPhase, CrewCallTarget, CrewCallTranscriptLine } from './types';

const HISTORY_PAGE = 12;
const CALL_EVENT_RE = /^\[call_event:(open|resume)\]$/i;

interface CrewCallContextValue {
  phase: CrewCallPhase;
  target: CrewCallTarget | null;
  sessionId: string | null;
  isActive: boolean;
  error: string | null;
  startCall: (target: CrewCallTarget) => Promise<void>;
  endCall: () => void;
  holdCall: () => void;
  resumeCall: () => void;
}

const CrewCallContext = createContext<CrewCallContextValue | null>(null);

export function useCrewCall(): CrewCallContextValue {
  const ctx = useContext(CrewCallContext);
  if (!ctx) throw new Error('useCrewCall must be used within CrewCallProvider');
  return ctx;
}

export function useCrewCallOptional(): CrewCallContextValue | null {
  return useContext(CrewCallContext);
}

export function CrewCallProvider({ children }: { children: ReactNode }) {
  const voice = useVoiceOptional();
  const [phase, setPhase] = useState<CrewCallPhase>('idle');
  const [target, setTarget] = useState<CrewCallTarget | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<CrewCallTranscriptLine[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const pausedDashboardVoiceRef = useRef(false);
  const startGuardRef = useRef(false);
  const lastAgentTextRef = useRef('');
  const endingTimerRef = useRef<number | null>(null);
  const runningSinceRef = useRef<number | null>(null);
  const accruedMsRef = useRef(0);
  const kickoffSentRef = useRef(false);
  const kickoffKindRef = useRef<'open' | 'resume'>('open');
  const kickoffTimerRef = useRef<number | null>(null);
  const requestKickoffRef = useRef<(kind: 'open' | 'resume') => boolean>(() => false);
  const oldestMsgIdRef = useRef<string | null>(null);
  /** After hold/resume, ignore live agent text until the operator speaks again. */
  const suppressAgentTranscriptRef = useRef(false);
  const historySeededForSessionRef = useRef<string | null>(null);

  const callLive = phase === 'connecting' || phase === 'encoding' || phase === 'linked';
  const callModalOpen = phase !== 'idle';

  const pushLine = useCallback((role: CrewCallTranscriptLine['role'], text: string) => {
    const raw = text.trim();
    if (!raw || CALL_EVENT_RE.test(raw)) return;
    const trimmed = role === 'system' ? raw : sanitizeVoiceDisplayText(raw);
    if (!trimmed) return;
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === trimmed) return prev;
      if (last && last.role === role && role !== 'system' && trimmed.startsWith(last.text)) {
        return [...prev.slice(0, -1), { ...last, text: trimmed, at: Date.now() }];
      }
      return [...prev.slice(-60), { id: crypto.randomUUID(), role, text: trimmed, at: Date.now() }];
    });
  }, []);

  const loadHistoryPage = useCallback(async (sid: string, before?: string) => {
    // Only seed history once per voice session — hold/resume must not re-dump
    // the full transcript into the live panel.
    if (!before && historySeededForSessionRef.current === sid) return;
    setHistoryLoading(true);
    try {
      const page = await sessions.getMessagesPage(sid, { limit: HISTORY_PAGE, before });
      const mapped = mapCallHistoryMessages(page.messages ?? [], { maxLen: 400 });
      if (page.messages?.length) {
        oldestMsgIdRef.current = page.messages[0]?.id ?? oldestMsgIdRef.current;
      }
      setHistoryHasMore(Boolean(page.hasMore));
      setTranscript((prev) => {
        if (!before) {
          historySeededForSessionRef.current = sid;
          // Seed with history, keep any live system lines that arrived first
          const live = prev.filter((l) => l.role === 'system');
          const seen = new Set(mapped.map((l) => `${l.role}:${l.text}`));
          const liveUnique = live.filter((l) => !seen.has(`${l.role}:${l.text}`));
          return [...mapped, ...liveUnique].slice(-60);
        }
        const existing = new Set(prev.map((l) => l.id));
        const older = mapped.filter((l) => !existing.has(l.id));
        return [...older, ...prev].slice(0, 80);
      });
    } catch {
      /* best-effort — call still works without history preview */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadEarlierHistory = useCallback(() => {
    if (!sessionId || !historyHasMore || historyLoading) return;
    const before = oldestMsgIdRef.current;
    if (!before) return;
    void loadHistoryPage(sessionId, before);
  }, [sessionId, historyHasMore, historyLoading, loadHistoryPage]);

  const comms = useVoiceCommsSession({
    active: callLive && Boolean(sessionId),
    chatSessionId: sessionId,
    voiceOnly: false,
    requestMicOnActivate: true,
    pttKeyboardEnabled: true,
    // Keep Space owned by the call UI even while connecting / on hold.
    spaceGuard: callModalOpen,
    onTranscriptFinal: (text, empty) => {
      if (empty) return;
      // Operator speech ends hold/resume transcript suppression.
      suppressAgentTranscriptRef.current = false;
      pushLine('operator', text);
    },
  });

  useEffect(() => {
    if (!callLive) {
      lastAgentTextRef.current = '';
      return;
    }
    if (suppressAgentTranscriptRef.current) return;
    const agent = (comms.session.agentText || '').trim();
    if (!agent || agent === lastAgentTextRef.current) return;
    // Drop internal context dumps that leak into spoken/transcript text.
    if (/^\[INTERNAL CONTEXT/i.test(agent) || /INTERNAL CONTEXT — do not speak/i.test(agent)) {
      return;
    }
    lastAgentTextRef.current = agent;
    pushLine('crew', agent);
  }, [callLive, comms.session.agentText, pushLine]);

  // Call timer — pauses while on hold
  useEffect(() => {
    if (phase !== 'linked' && phase !== 'on_hold') return;
    const id = window.setInterval(() => {
      const running = runningSinceRef.current;
      const live = running != null ? Date.now() - running : 0;
      setElapsedMs(accruedMsRef.current + live);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!callLive || !sessionId) return;
    if (phase !== 'connecting' && phase !== 'encoding') return;

    // Linked only after session_ready (ready/listening/…). Duplex alone is not enough —
    // that was marking the call live while the WebSocket was still connecting.
    const sessionLive =
      comms.session.state === 'ready'
      || comms.session.state === 'listening'
      || comms.session.state === 'speaking'
      || comms.session.state === 'processing';
    // PTT still needs mic prep; duplex is live once the socket reports ready.
    const uplinkReady =
      comms.commsReady
      && sessionLive
      && (comms.isDuplex || comms.session.pttReady);
    if (uplinkReady) {
      setPhase('linked');
      // Start / resume active call time only once the uplink is actually live.
      if (runningSinceRef.current == null) {
        runningSinceRef.current = Date.now();
      }
      pushLine('system', 'Channel live');
      return;
    }
    if (comms.voiceReady || comms.bootPhase === 'booting') {
      setPhase('encoding');
    }
  }, [
    callLive,
    sessionId,
    phase,
    comms.voiceReady,
    comms.bootPhase,
    comms.commsReady,
    comms.session.pttReady,
    comms.session.state,
    comms.isDuplex,
    pushLine,
  ]);

  requestKickoffRef.current = comms.requestCallKickoff;

  // Proactive welcome ONLY on first connect — never after hold/resume.
  // Resume must continue the same call silently (history already on the session).
  useEffect(() => {
    if (phase !== 'linked' && phase !== 'connecting' && phase !== 'encoding') return;
    if (kickoffSentRef.current) return;
    if (!comms.commsReady) return;
    // Need session_ready (not merely duplex mode configured).
    const sessionLive =
      comms.session.state === 'ready'
      || comms.session.state === 'listening'
      || comms.session.state === 'speaking'
      || comms.session.state === 'processing';
    if (!sessionLive) return;
    if (!comms.isDuplex && !comms.session.pttReady) return;
    if (kickoffTimerRef.current != null) return;

    const kind = kickoffKindRef.current;
    // Hold → resume: reconnect uplink only. Do not ask the model to greet again.
    if (kind === 'resume') {
      kickoffSentRef.current = true;
      pushLine('system', 'Back on the line');
      return;
    }

    pushLine('system', 'Connecting…');

    let attempts = 0;
    const tryKickoff = () => {
      if (kickoffSentRef.current) {
        kickoffTimerRef.current = null;
        return;
      }
      attempts += 1;
      const ok = requestKickoffRef.current('open');
      if (ok) {
        kickoffSentRef.current = true;
        kickoffTimerRef.current = null;
        pushLine('system', 'On the line');
        return;
      }
      if (attempts >= 30) {
        kickoffTimerRef.current = null;
        pushLine('system', 'Welcome delayed — you can start speaking');
        return;
      }
      kickoffTimerRef.current = window.setTimeout(tryKickoff, 250);
    };
    kickoffTimerRef.current = window.setTimeout(tryKickoff, 80);
  }, [
    phase,
    comms.commsReady,
    comms.isDuplex,
    comms.session.pttReady,
    comms.session.state,
    pushLine,
  ]);

  // Only cancel an in-flight kickoff when leaving the active call phases.
  // Clearing on connecting/encoding was aborting the greeting before "linked".
  useEffect(() => {
    if (phase === 'linked' || phase === 'connecting' || phase === 'encoding') return;
    if (kickoffTimerRef.current != null) {
      window.clearTimeout(kickoffTimerRef.current);
      kickoffTimerRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'linked') return;
    if (comms.session.error) pushLine('system', comms.session.error);
  }, [phase, comms.session.error, pushLine]);

  useEffect(() => () => {
    if (endingTimerRef.current) window.clearTimeout(endingTimerRef.current);
    if (kickoffTimerRef.current != null) window.clearTimeout(kickoffTimerRef.current);
  }, []);

  const endCall = useCallback(() => {
    setPhase((prev) => (prev === 'idle' ? prev : 'ending'));
    if (endingTimerRef.current) window.clearTimeout(endingTimerRef.current);
    endingTimerRef.current = window.setTimeout(() => {
      setPhase('idle');
      setTarget(null);
      setSessionId(null);
      setError(null);
      setTranscript([]);
      setHistoryHasMore(false);
      setElapsedMs(0);
      lastAgentTextRef.current = '';
      runningSinceRef.current = null;
      accruedMsRef.current = 0;
      kickoffSentRef.current = false;
      oldestMsgIdRef.current = null;
      historySeededForSessionRef.current = null;
      suppressAgentTranscriptRef.current = false;
      voice?.releaseVoiceEngine();
      pausedDashboardVoiceRef.current = false;
      startGuardRef.current = false;
      endingTimerRef.current = null;
    }, 280);
  }, [voice]);

  const holdCall = useCallback(() => {
    if (phase !== 'linked') return;
    if (runningSinceRef.current != null) {
      accruedMsRef.current += Date.now() - runningSinceRef.current;
      runningSinceRef.current = null;
    }
    // Keep call continuity: never re-issue a first-connect greeting after hold.
    kickoffSentRef.current = true;
    kickoffKindRef.current = 'resume';
    lastAgentTextRef.current = '';
    suppressAgentTranscriptRef.current = true;
    setPhase('on_hold');
    pushLine('system', 'On hold — channel disconnected');
  }, [phase, pushLine]);

  const resumeCall = useCallback(() => {
    if (phase !== 'on_hold' || !sessionId) return;
    kickoffSentRef.current = true;
    kickoffKindRef.current = 'resume';
    lastAgentTextRef.current = '';
    // Keep suppressing until the operator speaks — prevents replay of prior
    // turns into the live transcript when the uplink reconnects.
    suppressAgentTranscriptRef.current = true;
    // Do not start the timer until the channel is linked again.
    runningSinceRef.current = null;
    setPhase('connecting');
    pushLine('system', 'Reconnecting…');
  }, [phase, sessionId, pushLine]);

  const startCall = useCallback(async (next: CrewCallTarget) => {
    if (startGuardRef.current && phase !== 'failed' && phase !== 'idle') return;
    startGuardRef.current = true;
    setError(null);
    setTranscript([]);
    setHistoryHasMore(false);
    setElapsedMs(0);
    lastAgentTextRef.current = '';
    runningSinceRef.current = null;
    accruedMsRef.current = 0;
    kickoffSentRef.current = false;
    kickoffKindRef.current = 'open';
    oldestMsgIdRef.current = null;
    historySeededForSessionRef.current = null;
    suppressAgentTranscriptRef.current = false;
    setTarget(next);
    setPhase('resolving');
    pushLine('system', `Calling @${next.callsign}…`);

    try {
      if (voice?.voiceActive) {
        pausedDashboardVoiceRef.current = true;
        voice.setVoiceActive(false);
      }
      voice?.retainVoiceEngine();

      // Voice calls use a segregated sibling session: voice:{textSessionId}.
      // Never bind the uplink to the private text chat session.
      if (!next.crewId && !next.recruit && !next.sessionId) {
        throw new Error('Call target missing crew identity');
      }
      const body = next.recruit
        ? {
            crewId: next.crewId,
            textSessionId: next.sessionId,
            recruit: {
              id: next.recruit.id ?? `hub-${next.recruit.callsign ?? next.callsign}`,
              name: next.recruit.name,
              title: next.recruit.title,
              callsign: next.recruit.callsign ?? next.callsign,
              systemPrompt: next.recruit.systemPrompt,
              description: next.recruit.description,
              tone: next.recruit.tone,
              expertise: next.recruit.expertise,
              traits: next.recruit.traits,
              tools: next.recruit.tools,
              source: next.recruit.source ?? 'hub',
              catalogId: next.recruit.catalogId,
              categoryId: next.recruit.categoryId,
              color: next.recruit.color,
            },
          }
        : {
            crewId: next.crewId,
            textSessionId: next.sessionId,
          };
      const result = await crewChat.startVoiceSession(body);
      const sid = result.sessionId;
      pushLine('system', `Connected · ${result.crew?.name ?? next.displayName}`);

      setSessionId(sid);
      void loadHistoryPage(sid);
      setPhase('connecting');
      pushLine('system', 'Opening voice channel…');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPhase('failed');
      pushLine('system', `Call failed — ${message}`);
      voice?.releaseVoiceEngine();
      startGuardRef.current = false;
    }
  }, [phase, pushLine, voice, loadHistoryPage]);

  const value = useMemo<CrewCallContextValue>(() => ({
    phase,
    target,
    sessionId,
    isActive: phase !== 'idle' && phase !== 'failed' && phase !== 'ending',
    error,
    startCall,
    endCall,
    holdCall,
    resumeCall,
  }), [phase, target, sessionId, error, startCall, endCall, holdCall, resumeCall]);

  return (
    <CrewCallContext.Provider value={value}>
      {children}
      <CrewCallModal
        open={phase !== 'idle'}
        phase={phase}
        target={target}
        error={error}
        transcript={transcript}
        elapsedMs={elapsedMs}
        comms={comms}
        historyHasMore={historyHasMore}
        historyLoading={historyLoading}
        onLoadEarlier={loadEarlierHistory}
        onEnd={endCall}
        onHold={holdCall}
        onResume={resumeCall}
        onRetry={target ? () => { void startCall(target); } : undefined}
      />
    </CrewCallContext.Provider>
  );
}
