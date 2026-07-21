// useChatSessionLifecycle.ts — extracted from useChatSessionState.tsx
// Owns session list loading, title generation, session CRUD handlers,
// the session-restore effect (mount/URL change), and handleSelectSession.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { sessions, todos, crews, type SessionInfo, type TodoItem } from '../../api';
import type { ChildSessionDrawerState } from '../../chat/ChildSessionDrawer';
import type { ChatView, UIMessage } from '../../chat/types';
import type { Crew } from '../../api';
import { CHAT_INITIAL_MESSAGES_PER_ROLE, CORE_SESSION_MESSAGES_PER_ROLE, mapHistoryToUiMessages, buildSessionShellPatch, applyTurnFeedbackRows, buildActiveTurnAssistantMessage } from '../../chat/restoreMessages';
import { hydrateCrewDeliverables } from '../../chat/restoreCrewHydration';
import { normalizeTodoItems } from '../../chat/todoItems';
import { MESSAGE_PAGE_SIZE } from '../../chat/messageWindow';

export interface UseChatSessionLifecycleInputs {
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  isCrewPrivateSession: boolean;
  coreSession: boolean;
  sessionId?: string;
  location: { state: any };
  crewList: Crew[];
  // Orchestrator state setters
  setView: React.Dispatch<React.SetStateAction<ChatView>>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentSessionTitle: React.Dispatch<React.SetStateAction<string | null>>;
  setSessionList: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  setCrewList: React.Dispatch<React.SetStateAction<Crew[]>>;
  setTodoItems: React.Dispatch<React.SetStateAction<TodoItem[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  setWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setPendingFeedbackMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setChildSessionDrawer: React.Dispatch<React.SetStateAction<ChildSessionDrawerState | null>>;
  // Token setters (from useChatTokens)
  setTokenUsed: React.Dispatch<React.SetStateAction<number>>;
  setTokenInput: React.Dispatch<React.SetStateAction<number>>;
  setTokenOutput: React.Dispatch<React.SetStateAction<number>>;
  setTokenTotal: React.Dispatch<React.SetStateAction<number>>;
  setCompactionCount: React.Dispatch<React.SetStateAction<number>>;
  // Scroll setters (from useChatScroll)
  setShowJumpPill: React.Dispatch<React.SetStateAction<boolean>>;
  setHasOlderMessages: React.Dispatch<React.SetStateAction<boolean>>;
  // Session-restore setters
  setSessionRestoring: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCrewPrivateSession: React.Dispatch<React.SetStateAction<boolean>>;
  setCrewPrivateHost: React.Dispatch<React.SetStateAction<{ name: string; callsign: string; title?: string } | null>>;
  setPrivateHostCrewId: React.Dispatch<React.SetStateAction<string | null>>;
  setParentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setCrewWorkers: React.Dispatch<React.SetStateAction<any[]>>;
  setBypassPermissionsState: React.Dispatch<React.SetStateAction<boolean>>;
  // Turn-activity setters (used to re-activate indicator when restoring a session whose agent is still running)
  setTurnActivity: React.Dispatch<React.SetStateAction<{ stage: string; step: number; elapsedMs: number } | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<string | null>>;
  // Refs
  currentSessionIdRef: React.MutableRefObject<string | null>;
  chatReturnToRef: React.MutableRefObject<string | null>;
  skipRestoreRef: React.MutableRefObject<boolean>;
  titleGeneratedRef: React.MutableRefObject<boolean>;
  // Session-restore refs
  sessionRestoringRef: React.MutableRefObject<boolean>;
  isInitialLoadRef: React.MutableRefObject<boolean>;
  lastTurnFeedbackCandidateRef: React.MutableRefObject<{ messageId: string; elapsedMs: number } | null>;
  rateLimitSeenRef: React.MutableRefObject<boolean>;
  crewMissionSessionIdRef: React.MutableRefObject<string | null>;
  tokenInputRef: React.MutableRefObject<number>;
  tokenOutputRef: React.MutableRefObject<number>;
  isAtBottomRef: React.MutableRefObject<boolean>;
  messagesContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  jumpSuppressScrollTopRef: React.MutableRefObject<number | null>;
  // Turn-activity refs
  turnActiveRef: React.MutableRefObject<boolean>;
  activeTurnIdRef: React.MutableRefObject<string | null>;
  messagesRef: React.MutableRefObject<UIMessage[]>;
  // Scroll helper
  resetScrollState: () => void;
}

export function useChatSessionLifecycle({
  navigate,
  isCrewPrivateSession,
  coreSession,
  sessionId,
  location,
  crewList,
  setView,
  setCurrentSessionId,
  setCurrentSessionTitle,
  setSessionList,
  setCrewList,
  setTodoItems,
  setStreaming,
  setMessages,
  setWarnings,
  setPendingFeedbackMessageId,
  setChildSessionDrawer,
  setTokenUsed,
  setTokenInput,
  setTokenOutput,
  setTokenTotal,
  setCompactionCount,
  setShowJumpPill,
  setHasOlderMessages,
  setSessionRestoring,
  setIsCrewPrivateSession,
  setCrewPrivateHost,
  setPrivateHostCrewId,
  setParentSessionId,
  setCrewWorkers,
  setBypassPermissionsState,
  setTurnActivity,
  setCurrentStep,
  currentSessionIdRef,
  chatReturnToRef,
  skipRestoreRef,
  titleGeneratedRef,
  sessionRestoringRef,
  isInitialLoadRef,
  lastTurnFeedbackCandidateRef,
  rateLimitSeenRef,
  crewMissionSessionIdRef,
  tokenInputRef,
  tokenOutputRef,
  isAtBottomRef,
  messagesContainerRef,
  jumpSuppressScrollTopRef,
  turnActiveRef,
  activeTurnIdRef,
  messagesRef,
  resetScrollState,
}: UseChatSessionLifecycleInputs) {
  // ─── Stable refs for handler dependencies ───
  const sessionIdRef = useRef(sessionId);
  const locationRef = useRef(location);
  const isCrewPrivateSessionRef = useRef(isCrewPrivateSession);
  const crewListRef = useRef(crewList);
  const coreSessionRef = useRef(coreSession);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { isCrewPrivateSessionRef.current = isCrewPrivateSession; }, [isCrewPrivateSession]);
  useEffect(() => { crewListRef.current = crewList; }, [crewList]);
  useEffect(() => { coreSessionRef.current = coreSession; }, [coreSession]);

  // ─── loadSessions ───
  const loadSessions = useCallback(() => {
    sessions.list().then((list) => setSessionList(list.filter((s) => !s.parentId))).catch(() => {});
  }, [setSessionList]);

  // ─── openChildSession ───
  const openChildSession = useCallback((props: {
    childSessionId: string;
    label: string;
    kind: 'sub_agent' | 'crew_worker';
  }) => {
    setChildSessionDrawer({
      childSessionId: props.childSessionId,
      label: props.label,
      kind: props.kind,
    });
  }, [setChildSessionDrawer]);

  // ─── generateTitle ───
  const generateTitle = useCallback(async (sid: string, msgs: any[]) => {
    if (titleGeneratedRef.current) return;
    const firstUser = msgs.find((m: any) => m.role === 'user');
    if (!firstUser) return;
    titleGeneratedRef.current = true;
    try {
      const { title } = await sessions.generateTitle(sid);
      if (title) {
        setCurrentSessionTitle(title);
        loadSessions();
      }
    } catch { /* best-effort */ }
  }, [titleGeneratedRef, setCurrentSessionTitle, loadSessions]);

  // ─── loadTodos ───
  const loadTodos = useCallback((sessionId?: string | null) => {
    const sid = sessionId ?? currentSessionIdRef.current;
    if (!sid) {
      setTodoItems([]);
      return;
    }
    todos.list(sid)
      .then((items) => setTodoItems(normalizeTodoItems(items)))
      .catch(() => { /* best-effort */ });
  }, [setTodoItems, currentSessionIdRef]);

  // ─── Shared restore helper (used by both session-restore effect and handleSelectSession) ───
  const restoreSessionData = useCallback(async (sid: string, sessionInfo?: SessionInfo) => {
    const { messages: historyMsgs, session, turnFeedback, messagesMeta, turnState, backgroundTasks } = await sessions.restore(sid, {
      perRole: coreSessionRef.current ? CORE_SESSION_MESSAGES_PER_ROLE : CHAT_INITIAL_MESSAGES_PER_ROLE,
    });
    if (currentSessionIdRef.current !== sid) return;

    if (session?.parentId || sessionInfo?.parentId) {
      setSessionRestoring(false);
      sessionRestoringRef.current = false;
      isInitialLoadRef.current = false;
      const parentId = session?.parentId ?? sessionInfo!.parentId!;
      setChildSessionDrawer({
        childSessionId: sid,
        label: session?.title ?? sessionInfo?.title ?? 'Background work',
        kind: sid.startsWith('crew-worker') ? 'crew_worker' : 'sub_agent',
      });
      navigate(`/console/chat/${parentId}`, { replace: !sessionInfo });
      return;
    }

    const mapped = mapHistoryToUiMessages(historyMsgs);
    const shell = buildSessionShellPatch({ ...(sessionInfo ?? {}), ...session, id: sid });

    let feedbackRows = turnFeedback ?? [];
    if (!feedbackRows.length) {
      try {
        const fb = await sessions.listTurnFeedback(sid);
        feedbackRows = fb.feedback;
      } catch { /* best-effort */ }
    }
    const withFeedback = applyTurnFeedbackRows(mapped, feedbackRows);

    // Recycle: keep only the newest page in memory for snappy UI.
    const windowed = withFeedback.length > MESSAGE_PAGE_SIZE
      ? withFeedback.slice(-MESSAGE_PAGE_SIZE)
      : withFeedback;
    setMessages(windowed);
    setHasOlderMessages((messagesMeta?.truncated ?? false) || withFeedback.length > MESSAGE_PAGE_SIZE);
    setIsCrewPrivateSession(shell.crewPrivate);
    setCrewPrivateHost(shell.privateHost);
    setPrivateHostCrewId(shell.privateHostCrewId);
    setCurrentSessionTitle(shell.title);
    setBypassPermissionsState(shell.bypassPermissions ?? false);
    if (shell.crewPrivate) {
      const navState = locationRef.current.state as { fromCrews?: boolean } | null;
      chatReturnToRef.current = navState?.fromCrews ? '/console/crews' : 'crew_tab';
    }
    setParentSessionId(session?.parentId ?? sessionInfo?.parentId ?? null);
    if (!sessionInfo) setCurrentSessionId(sid);
    setShowJumpPill(false);
    jumpSuppressScrollTopRef.current = null;
    const visible = historyMsgs.filter((m) => m.role !== 'part' && m.role !== 'system');
    const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
    const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
    const persistedUsed = (sessionInfo as { tokenUsed?: number; tokensUsed?: number } | undefined)?.tokenUsed ?? (session as { tokenUsed?: number; tokensUsed?: number }).tokenUsed ?? (sessionInfo as { tokensUsed?: number } | undefined)?.tokensUsed ?? session.tokensUsed ?? 0;
    const tokenAvail = Number((sessionInfo as { tokenAvailable?: number; token_available?: number } | undefined)?.tokenAvailable ?? (session as { tokenAvailable?: number; token_available?: number }).tokenAvailable ?? (session as { token_available?: number }).token_available ?? 0);
    if (tokenAvail > 0) setTokenTotal(tokenAvail);
    setTokenUsed(persistedUsed > 0 ? persistedUsed : inputEst + outputEst);
    setCompactionCount((session as { compactionCount?: number }).compactionCount ?? (sessionInfo as { compactionCount?: number })?.compactionCount ?? 0);
    setTokenInput(inputEst);
    setTokenOutput(outputEst);
    tokenInputRef.current = inputEst;
    tokenOutputRef.current = outputEst;
    loadTodos(sid);

    // If the backend reports an active turn for this session (agent still
    // processing in the background after navigation), re-activate the turn
    // indicator and rebuild the in-progress assistant bubble (tools/text).
    const turnPhase = turnState?.phase;
    if (turnPhase && turnPhase !== 'idle' && turnPhase !== 'done' && turnPhase !== 'cancelled') {
      turnActiveRef.current = true;
      activeTurnIdRef.current = turnState?.turnId ?? null;
      setStreaming(true);
      setTurnActivity({
        stage: turnState?.stage ?? 'working',
        step: turnState?.step ?? 0,
        elapsedMs: turnState?.startedAt ? Date.now() - turnState.startedAt : 0,
      });
      setCurrentStep(turnState?.stage ?? 'Working…');
      const lastMapped = withFeedback[withFeedback.length - 1];
      const live = buildActiveTurnAssistantMessage({
        turnId: turnState?.turnId,
        partialContent: turnState?.partialContent,
        activeParts: turnState?.activeParts,
        backgroundTasks,
      });
      if (lastMapped?.role === 'assistant') {
        // Merge live tools/subagents onto the existing assistant row (streaming or not).
        setMessages([...withFeedback.slice(0, -1), {
          ...lastMapped,
          ...live,
          id: lastMapped.id,
          content: live.content || lastMapped.content,
          parts: live.parts?.length ? live.parts : lastMapped.parts,
          toolCalls: live.toolCalls?.length ? live.toolCalls : lastMapped.toolCalls,
          subAgents: live.subAgents?.length ? live.subAgents : lastMapped.subAgents,
          streaming: true,
        }]);
      } else {
        setMessages([...withFeedback, live]);
      }
      // Allow SSE telemetry events to flow (otherwise isInitialLoadRef would gate them).
      isInitialLoadRef.current = false;
    } else {
      isInitialLoadRef.current = false;
    }
    if (!session.title || session.title === 'New Session' || session.title === 'Child Session') {
      generateTitle(sid, visible);
    }

    if (!shell.crewPrivate && !coreSessionRef.current) {
      void (async () => {
        try {
          let roster = crewListRef.current;
          if (!roster.length) {
            roster = await crews.list();
            setCrewList(roster);
          }
          const hydrated = await hydrateCrewDeliverables(sid, withFeedback, roster);
          if (hydrated.crewWorkers.length > 0) {
            setCrewWorkers(hydrated.crewWorkers);
            crewMissionSessionIdRef.current = sid;
          }
          // hydrateCrewDeliverables returns the same `messages` reference when it
          // no-ops. Overwriting always would wipe a mid-turn streaming bubble we
          // just seeded from turnState.
          if (hydrated.messages !== withFeedback) {
            const base = applyTurnFeedbackRows(hydrated.messages, feedbackRows);
            setMessages((prev) => {
              const live = prev[prev.length - 1];
              if (turnActiveRef.current && live?.role === 'assistant' && live.streaming) {
                const lastBase = base[base.length - 1];
                if (lastBase?.role === 'assistant') {
                  return [
                    ...base.slice(0, -1),
                    {
                      ...lastBase,
                      content: live.content || lastBase.content,
                      parts: live.parts?.length ? live.parts : lastBase.parts,
                      toolCalls: live.toolCalls?.length ? live.toolCalls : lastBase.toolCalls,
                      subAgents: live.subAgents?.length ? live.subAgents : lastBase.subAgents,
                      thinking: live.thinking ?? lastBase.thinking,
                      streaming: true,
                    },
                  ];
                }
                return [...base, live];
              }
              return base;
            });
          }
          if (isAtBottomRef.current) {
            requestAnimationFrame(() => {
              const el = messagesContainerRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
        } catch { /* best-effort */ }
      })();
    }
  }, [currentSessionIdRef, navigate, setMessages, setHasOlderMessages, setIsCrewPrivateSession, setCrewPrivateHost, setPrivateHostCrewId, setCurrentSessionTitle, setParentSessionId, setCurrentSessionId, setShowJumpPill, jumpSuppressScrollTopRef, setTokenTotal, setTokenUsed, setCompactionCount, setTokenInput, setTokenOutput, tokenInputRef, tokenOutputRef, loadTodos, generateTitle, setCrewList, setCrewWorkers, crewMissionSessionIdRef, isAtBottomRef, messagesContainerRef, setSessionRestoring, sessionRestoringRef, isInitialLoadRef, setChildSessionDrawer, coreSessionRef, locationRef, crewListRef, setStreaming, setTurnActivity, setCurrentStep, turnActiveRef, activeTurnIdRef]);

  // ─── Session-restore effect (mount/URL change) ───
  useEffect(() => {
    if (sessionId) {
      if (skipRestoreRef.current) {
        skipRestoreRef.current = false;
        setView('chat');
        return;
      }
      // Re-entering the same in-flight session (session list → same thread):
      // keep React mid-turn state; do not wipe and re-fetch.
      const live = messagesRef.current[messagesRef.current.length - 1];
      if (
        currentSessionIdRef.current === sessionId
        && turnActiveRef.current
        && live?.role === 'assistant'
        && live.streaming
      ) {
        setView('chat');
        setCurrentSessionId(sessionId);
        isInitialLoadRef.current = false;
        setSessionRestoring(false);
        sessionRestoringRef.current = false;
        return;
      }
      setView('chat');
      setCurrentSessionId(sessionId);
      resetScrollState();
      titleGeneratedRef.current = false;
      setSessionRestoring(true);
      sessionRestoringRef.current = true;
      isInitialLoadRef.current = true;
      setPendingFeedbackMessageId(null);
      lastTurnFeedbackCandidateRef.current = null;
      setMessages([]);

      void sessions.get(sessionId).then((sessionInfo) => {
        if (currentSessionIdRef.current !== sessionId) return;
        const shell = buildSessionShellPatch(sessionInfo);
        setIsCrewPrivateSession(shell.crewPrivate);
        setCrewPrivateHost(shell.privateHost);
        setPrivateHostCrewId(shell.privateHostCrewId);
        setCurrentSessionTitle(shell.title);
        setBypassPermissionsState(shell.bypassPermissions ?? false);
        if (shell.crewPrivate) {
          const navState = location.state as { fromCrews?: boolean } | null;
          chatReturnToRef.current = navState?.fromCrews ? '/console/crews' : 'crew_tab';
        }
      }).catch(() => { /* full restore follows */ });

      void restoreSessionData(sessionId).catch((err) => {
        console.error('Failed to restore session on mount:', err);
        setWarnings([`Failed to restore session: ${err instanceof Error ? err.message : 'Unknown error'}`]);
        setSessionRestoring(false);
        sessionRestoringRef.current = false;
        isInitialLoadRef.current = false;
      });
    } else {
      setView('sessions');
      setIsCrewPrivateSession(false);
      setCrewPrivateHost(null);
      setPrivateHostCrewId(null);
    }
  }, [sessionId, location.state, navigate]);

  // ─── handleSelectSession ───
  const handleSelectSession = useCallback(async (s: SessionInfo) => {
    const live = messagesRef.current[messagesRef.current.length - 1];
    if (
      s.id === currentSessionIdRef.current
      && turnActiveRef.current
      && live?.role === 'assistant'
      && live.streaming
    ) {
      skipRestoreRef.current = true;
      setView('chat');
      navigate(`/console/chat/${s.id}`);
      return;
    }
    setWarnings([]);
    rateLimitSeenRef.current = false;
    setStreaming(false);
    resetScrollState();
    setSessionRestoring(true);
    sessionRestoringRef.current = true;
    isInitialLoadRef.current = true;
    setPendingFeedbackMessageId(null);
    lastTurnFeedbackCandidateRef.current = null;
    setMessages([]);
    const previewShell = buildSessionShellPatch(s);
    setIsCrewPrivateSession(previewShell.crewPrivate);
    setCrewPrivateHost(previewShell.privateHost);
    setPrivateHostCrewId(previewShell.privateHostCrewId);
    setBypassPermissionsState(previewShell.bypassPermissions ?? false);
    setCurrentSessionTitle(previewShell.title);
    if (previewShell.crewPrivate) chatReturnToRef.current = 'crew_tab';
    try {
      await restoreSessionData(s.id, s);
      navigate(`/console/chat/${s.id}`);
    } catch (e) {
      setSessionRestoring(false);
      sessionRestoringRef.current = false;
      isInitialLoadRef.current = false;
      setWarnings([`Failed to restore session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
  }, [setWarnings, rateLimitSeenRef, setStreaming, resetScrollState, setSessionRestoring, sessionRestoringRef, isInitialLoadRef, setPendingFeedbackMessageId, lastTurnFeedbackCandidateRef, setMessages, setIsCrewPrivateSession, setCrewPrivateHost, setPrivateHostCrewId, setCurrentSessionTitle, chatReturnToRef, restoreSessionData, navigate, messagesRef, turnActiveRef, currentSessionIdRef, skipRestoreRef, setView]);

  // ─── handleShowSessions ───
  const handleShowSessions = useCallback(() => {
    // Keep turnActive streaming state — only hide the chat view. Killing
    // streaming here made mid-turn bubbles look idle after returning.
    if (!turnActiveRef.current) setStreaming(false);
    loadSessions();
    const returnTo = chatReturnToRef.current;
    chatReturnToRef.current = null;
    if (returnTo === '/console/crews') {
      navigate('/console/crews');
    } else if (returnTo === 'crew_tab' || isCrewPrivateSessionRef.current) {
      navigate('/console/chat?tab=crew');
    } else {
      navigate('/console/chat');
    }
  }, [setStreaming, loadSessions, chatReturnToRef, navigate, isCrewPrivateSessionRef, turnActiveRef]);

  // ─── Clear session modal state ───
  const [clearSessionModalOpen, setClearSessionModalOpen] = useState(false);
  const [clearSessionBusy, setClearSessionBusy] = useState(false);

  // ─── resetSessionViewState ───
  const resetSessionViewState = useCallback(() => {
    setMessages([]);
    setHasOlderMessages(false);
    setPendingFeedbackMessageId(null);
    setTokenUsed(0);
    setTokenInput(0);
    setTokenOutput(0);
    setCompactionCount(0);
  }, [setMessages, setHasOlderMessages, setPendingFeedbackMessageId, setTokenUsed, setTokenInput, setTokenOutput, setCompactionCount]);

  // ─── handleArchiveSession ───
  const handleArchiveSession = useCallback(async () => {
    const sid = currentSessionIdRef.current;
    if (!sid) return;
    setClearSessionBusy(true);
    try {
      await sessions.archiveMessages(sid);
      resetSessionViewState();
      setClearSessionModalOpen(false);
    } catch (e) {
      setWarnings([`Failed to archive session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    } finally {
      setClearSessionBusy(false);
    }
  }, [currentSessionIdRef, setClearSessionBusy, resetSessionViewState, setClearSessionModalOpen, setWarnings]);

  // ─── handleDeleteSessionContent ───
  const handleDeleteSessionContent = useCallback(async () => {
    const sid = currentSessionIdRef.current;
    if (!sid) return;
    setClearSessionBusy(true);
    try {
      await sessions.purgeContent(sid);
      resetSessionViewState();
      setClearSessionModalOpen(false);
    } catch (e) {
      setWarnings([`Failed to delete session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    } finally {
      setClearSessionBusy(false);
    }
  }, [currentSessionIdRef, setClearSessionBusy, resetSessionViewState, setClearSessionModalOpen, setWarnings]);

  // ─── startNewSession (defined before handleNewSession which depends on it) ───
  const startNewSession = useCallback(async () => {
    setWarnings([]);
    setStreaming(false);
    setMessages([]);
    setCurrentSessionTitle(null);
    setTokenUsed(0);
    setTokenInput(0);
    setTokenOutput(0);
    setCompactionCount(0);
    setTodoItems([]);
    setShowJumpPill(false);
    try {
      const { sessionId: newSessionId } = await sessions.create();
      setCurrentSessionId(newSessionId);
      currentSessionIdRef.current = newSessionId;
      skipRestoreRef.current = true;
      setView('chat');
      navigate(`/console/chat/${newSessionId}`);
    } catch (e) {
      setCurrentSessionId(null);
      currentSessionIdRef.current = null;
      setWarnings([`Failed to start session: ${e instanceof Error ? e.message : 'Unknown error.'}`]);
    }
  }, [setWarnings, setStreaming, setMessages, setCurrentSessionTitle, setTokenUsed, setTokenInput, setTokenOutput, setCompactionCount, setTodoItems, setShowJumpPill, setCurrentSessionId, currentSessionIdRef, skipRestoreRef, setView, navigate]);

  // ─── handleNewSession ───
  const handleNewSession = useCallback(async () => {
    void startNewSession();
  }, [startNewSession]);

  // ─── handleDeleteSession ───
  const handleDeleteSession = useCallback(async (id: string) => {
    try { await sessions.delete(id); loadSessions(); } catch { /* ignore */ }
  }, [loadSessions]);

  return {
    // Utilities
    loadSessions,
    loadTodos,
    generateTitle,
    openChildSession,
    // Session CRUD
    handleShowSessions,
    handleSelectSession,
    handleNewSession,
    startNewSession,
    resetSessionViewState,
    handleArchiveSession,
    handleDeleteSessionContent,
    handleDeleteSession,
    // Clear session modal state
    clearSessionModalOpen, setClearSessionModalOpen,
    clearSessionBusy, setClearSessionBusy,
  };
}
