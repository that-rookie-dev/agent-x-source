// useChatSessionState.ts — extracted from ChatPanel.tsx
// Contains ALL chat session state, refs, handlers, and effects.
// ChatSessionProvider calls this hook and exposes state/dispatch via context.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

import { chat, sessions, models, crews, crewSuggestions, providers, settings, permissions, sessionPermissions, markdownDocuments, modelBenchmark, type TodoItem, type SessionInfo, type Crew, type ModelInfo, type ConnectionState, type CrewSuggestionEvaluation, type CrewMatchCandidate, type IntegrationActionPreview } from '../../api';
import type { PrebuiltCrew } from '../crew/hub-types';
import type { ChatInputBarHandle } from '../ChatInputBar';
import { readWebSearchForcePreference, writeWebSearchForcePreference } from '../WebSearchGlobeToggle';
import { readCrewSuggestionRequestedPreference, writeCrewSuggestionRequestedPreference } from '../CrewSuggestionToggle';
import { hasPendingChatInteraction } from '../../chat/utils';
import { supportsVision, isImageMimeType } from '../../chat/vision-support';
import { summarizeMessageForTurnFeedback } from '@agentx/shared/browser';
import { isTurnFeedbackEligible } from '@agentx/shared/browser';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import type { ChildSessionDrawerState } from '../../chat/ChildSessionDrawer';
import type { UIMessage, FileAttachment, ChatView, SessionListTab } from '../../chat/types';
import { replaceWarning } from './message-helpers';
import { useChatScroll } from './useChatScroll';
import { useChatTokens } from './useChatTokens';
import { useChatCrew } from './useChatCrew';
import { useChatSessionLifecycle } from './useChatSessionLifecycle';
import { useChatSend } from './useChatSend';
import { useChatTelemetry } from './useChatTelemetry';
import { useChatSessionUtils } from './useChatSessionUtils';
import { onRuntimeConfigChanged } from '../../runtime-config-sync';

export function useChatSessionState(sessionId?: string, coreSession = false) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionListTab: SessionListTab = searchParams.get('tab') === 'crew' ? 'crew_private' : 'agent_x';
  const setSessionListTab = useCallback((tab: SessionListTab) => {
    if (tab === 'crew_private') setSearchParams({ tab: 'crew' });
    else setSearchParams({});
  }, [setSearchParams]);
  const [view, setView] = useState<ChatView>(sessionId ? 'chat' : 'sessions');
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId ?? null);
  const [isCrewPrivateSession, setIsCrewPrivateSession] = useState(false);
  const [crewPrivateHost, setCrewPrivateHost] = useState<{ name: string; callsign: string; title?: string } | null>(null);
  const [privateHostCrewId, setPrivateHostCrewId] = useState<string | null>(null);
  const isCrewPrivateRef = useRef(false);
  const crewPrivateHostRef = useRef<{ name: string; callsign: string; title?: string } | null>(null);
  const chatReturnToRef = useRef<'crew_tab' | '/console/crews' | null>(null);
  const [parentSessionId, setParentSessionId] = useState<string | null>(null);
  const [childSessionDrawer, setChildSessionDrawer] = useState<ChildSessionDrawerState | null>(null);
  const currentSessionIdRef = useRef<string | null>(sessionId ?? null);
  /** URL session id — only set while viewing /console/chat/:sessionId (not the sessions list). */
  const viewSessionIdRef = useRef<string | null>(sessionId ?? null);

  useEffect(() => { isCrewPrivateRef.current = isCrewPrivateSession; }, [isCrewPrivateSession]);
  useEffect(() => { crewPrivateHostRef.current = crewPrivateHost; }, [crewPrivateHost]);

  useEffect(() => {
    let cancelled = false;
    const loadWebSearchStatus = () => {
      settings.webSearch.status()
        .then((status) => { if (!cancelled) setWebSearchAvailable(status.available); })
        .catch(() => { if (!cancelled) setWebSearchAvailable(false); });
    };
    loadWebSearchStatus();
    window.addEventListener('focus', loadWebSearchStatus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', loadWebSearchStatus);
    };
  }, []);

  const handleWebSearchToggle = useCallback((enabled: boolean) => {
    setWebSearchForce(enabled);
    writeWebSearchForcePreference(enabled);
  }, []);

  const handleCrewSuggestionToggle = useCallback((enabled: boolean) => {
    setCrewSuggestionRequested(enabled);
    writeCrewSuggestionRequestedPreference(enabled);
  }, []);

  // Chat state
  const [sessionRestoring, setSessionRestoring] = useState(!!sessionId);
  const sessionRestoringRef = useRef(!!sessionId);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [inputClearSignal] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<{ requestId: string; tool: string; path: string; riskLevel: string; integrationPreview?: IntegrationActionPreview; forAutomation?: boolean } | null>(null);
  const permissionPromptRef = useRef(permissionPrompt);
  useEffect(() => { permissionPromptRef.current = permissionPrompt; }, [permissionPrompt]);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);

  const handlePermissionRespond = useCallback(async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    const prompt = permissionPromptRef.current;
    if (!prompt) return;
    try {
      await permissions.respond(prompt.requestId, choice);
    } catch { /* ignore */ }
    setPermissionPrompt(null);
    setPendingPermissionCount((prev) => Math.max(0, prev - 1));
  }, [setPermissionPrompt, setPendingPermissionCount]);

  const handlePermissionRespondBatch = useCallback(async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await permissions.respondBatch(choice);
    } catch { /* ignore */ }
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
  }, []);

  const [toolEnablePrompt, setToolEnablePrompt] = useState<{ toolId: string; toolName: string } | null>(null);

  // Unified permission state
  const [bypassPermissions, setBypassPermissionsState] = useState(false);
  const [toolPermissions, setToolPermissions] = useState<Record<string, { targetPath: string | null; decision: string }>>({});

  const fetchSessionPermissions = useCallback(async (sessionId: string) => {
    try {
      const result = await sessionPermissions.get(sessionId);
      setBypassPermissionsState(result.bypassPermissions);
      const map: Record<string, { targetPath: string | null; decision: string }> = {};
      for (const d of result.decisions) {
        map[d.toolName] = { targetPath: d.targetPath, decision: d.decision };
      }
      setToolPermissions(map);
    } catch { /* ignore */ }
  }, []);

  const setBypassPermissions = useCallback(async (enabled: boolean) => {
    const sessionId = currentSessionIdRef.current ?? currentSessionId;
    if (!sessionId) return;
    try {
      await sessionPermissions.setBypass(sessionId, enabled);
      setBypassPermissionsState(enabled);
    } catch { /* ignore */ }
  }, [currentSessionId]);

  /** Enable session bypass and approve all pending prompts so the turn can continue. */
  const handleSwitchToBypassMode = useCallback(async () => {
    await setBypassPermissions(true);
    try {
      await permissions.respondBatch('allow_once');
    } catch { /* ignore */ }
    const prompt = permissionPromptRef.current;
    if (prompt) {
      try {
        await permissions.respond(prompt.requestId, 'allow_once');
      } catch { /* ignore */ }
    }
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
  }, [setBypassPermissions]);

  const toggleBypassPermissions = useCallback(async () => {
    await setBypassPermissions(!bypassPermissions);
  }, [bypassPermissions, setBypassPermissions]);

  const revokeSessionPermissions = useCallback(async () => {
    const sessionId = currentSessionIdRef.current ?? currentSessionId;
    if (!sessionId) return;
    try {
      await sessionPermissions.revoke(sessionId);
      setBypassPermissionsState(false);
      setToolPermissions({});
    } catch { /* ignore */ }
  }, [currentSessionId]);

  const setToolPermission = useCallback(async (toolName: string, decision: 'allow_always' | 'deny' | 'revoke') => {
    const sessionId = currentSessionIdRef.current ?? currentSessionId;
    if (!sessionId) return;
    try {
      await sessionPermissions.setTool(sessionId, toolName, decision);
      if (decision === 'revoke') {
        setToolPermissions((prev) => { const next = { ...prev }; delete next[toolName]; return next; });
      } else {
        setToolPermissions((prev) => ({ ...prev, [toolName]: { targetPath: null, decision } }));
      }
    } catch { /* ignore */ }
  }, [currentSessionId]);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [webSearchForce, setWebSearchForce] = useState(() => readWebSearchForcePreference());
  const [crewSuggestionRequested, setCrewSuggestionRequested] = useState(() => readCrewSuggestionRequestedPreference());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const skipRestoreRef = useRef(false);
  const isInitialLoadRef = useRef(true);

  // Loading step indicator state
  const [loadingSteps, setLoadingSteps] = useState<Array<{ id: string; label: string; status: string }> | null>(null);

  // Provider error band state — array of messages for unified warning band
  const [warnings, setWarnings] = useState<string[]>([]);

  // Clarification prompt — only shown while agent is actively waiting (streaming)
  const rateLimitSeenRef = useRef(false);

  // formatWarningMessage and replaceWarning extracted to ./chat/message-helpers.ts

  // Session-restore effect and handleSelectSession have been moved to useChatSessionLifecycle.

  // Right sidebar state
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);

  // Collapsible sidebar sections
  const [tokenExpanded, setTokenExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [missionExpanded, setMissionExpanded] = useState(true);

  // Model/Provider state
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentProviderId, setCurrentProviderId] = useState('');
  const [providerList, setProviderList] = useState<Array<{ id: string; label: string; providerId: string }>>([]);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // ─── Token state, context data, refresh logic (extracted to useChatTokens) ───
  const {
    tokenUsed, setTokenUsed,
    tokenInput, setTokenInput,
    tokenOutput, setTokenOutput,
    tokenReserved, setTokenReserved,
    tokenStreaming, setTokenStreaming,
    tokenTotal, setTokenTotal,
    compactionCount, setCompactionCount,
    tokenPercent,
    tokenInputRef, tokenOutputRef, tokenReservedRef,
  } = useChatTokens({ currentSessionId, currentModel, modelList });

  // Crew state (fixed per session)
  const [crewList, setCrewList] = useState<Crew[]>([]);
  const crewListRef = useRef(crewList);
  useEffect(() => { crewListRef.current = crewList; }, [crewList]);

  // Dropdown anchors
  const [providerMenuAnchor, setProviderMenuAnchor] = useState<null | HTMLElement>(null);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);

  // ─── Enhancements: connection health, slash, search, checkpoints ───
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);

  // Step cap prompt
  const [stepCapPrompt, setStepCapPrompt] = useState<{ currentSteps: number; maxSteps: number } | null>(null);
  const [turnActivity, setTurnActivity] = useState<{ stage: string; step: number; elapsedMs: number } | null>(null);
  const [pendingFeedbackMessageId, setPendingFeedbackMessageId] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const lastTurnFeedbackCandidateRef = useRef<{ messageId: string; elapsedMs: number } | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const turnActiveRef = useRef(false);
  /** Sync marker for an outgoing user turn so WS handlers don't overwrite the prior assistant before React commits setMessages. */
  const outgoingTurnRef = useRef<{ userId: string; userContent: string; placeholderId: string } | null>(null);
  const resendInProgressRef = useRef(false);

  // Single replaceable "current step" line shown during streaming — each new
  // tool/deep-search/thinking event replaces the previous label (no card accumulation).
  const [currentStep, setCurrentStep] = useState<string | null>(null);

  const endTurnUi = useCallback(() => {
    turnActiveRef.current = false;
    activeTurnIdRef.current = null;
    outgoingTurnRef.current = null;
    resendInProgressRef.current = false;
    setStreaming(false);
    setTurnActivity(null);
    setCurrentStep(null);
    setTokenStreaming(0);
  }, []);

  const beginTurnUi = useCallback(() => {
    turnActiveRef.current = true;
    isInitialLoadRef.current = false;
    setStreaming(true);
    setTurnActivity(null);
    setCurrentStep(null);
    setLoadingSteps(null);
    setPendingFeedbackMessageId(null);
  }, []);

  const [crewDossierOpen, setCrewDossierOpen] = useState(false);
  const [crewDossierCrew, setCrewDossierCrew] = useState<PrebuiltCrew | null>(null);
  const pendingSendTextRef = useRef<string | null>(null);
  const crewSuggestionHandledRef = useRef(false);
  const crewGateInFlightRef = useRef(false);
  const attachCrewRosterPickerRef = useRef<(
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ) => Promise<boolean>>(async () => false);

  const handleTurnFeedback = useCallback(async (messageId: string, rating: TurnFeedbackRating) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;
    setFeedbackSubmitting(true);
    setPendingFeedbackMessageId(null);
    const msg = messagesRef.current.find((m) => m.id === messageId);
    const turnSummary = summarizeMessageForTurnFeedback({ content: msg?.content, parts: msg?.parts });
    const prevRating = msg?.turnFeedback?.rating;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, turnFeedback: { rating } } : m)));
    try {
      await sessions.submitTurnFeedback(sessionId, {
        messageId,
        rating,
        turnSummary: turnSummary || undefined,
        metadata: msg?.crew ? { crewId: msg.crew.crewId } : undefined,
      });
    } catch (err) {
      setMessages((prev) => prev.map((m) => (
        m.id === messageId ? { ...m, turnFeedback: prevRating ? { rating: prevRating } : undefined } : m
      )));
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to save feedback'));
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [replaceWarning, setFeedbackSubmitting, setPendingFeedbackMessageId, setMessages, setWarnings, currentSessionIdRef, messagesRef]);

  const handleSaveMarkdown = useCallback(async (message: UIMessage) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || message.streaming) return;
    const { messageToMarkdownDocument, deriveMarkdownTitleFromMessage } = await import('../../markdown/markdown-export');
    const contentMarkdown = messageToMarkdownDocument(message);
    if (!contentMarkdown.trim()) return;
    const title = deriveMarkdownTitleFromMessage(message);
    try {
      await markdownDocuments.create({
        sessionId,
        title,
        contentMarkdown,
        messageId: message.id,
        sourceRole: message.role === 'user' ? 'user' : 'assistant',
      });
      const { notify } = await import('../NotificationToast');
      notify('checkpoint', 'Saved to Markdown — open the sidebar to view or export PDF.');
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to save markdown'));
    }
  }, [replaceWarning]);

  useEffect(() => {
    sessionRestoringRef.current = sessionRestoring;
  }, [sessionRestoring]);

  useEffect(() => {
    const candidate = lastTurnFeedbackCandidateRef.current;
    if (!candidate || sessionRestoringRef.current) return;
    const msg = messages.find((m) => m.id === candidate.messageId);
    lastTurnFeedbackCandidateRef.current = null;
    if (!msg || msg.turnFeedback || msg.streaming) return;
    if (isTurnFeedbackEligible({
      role: 'assistant',
      content: msg.content,
      parts: msg.parts,
      toolCalls: msg.toolCalls,
      elapsedMs: candidate.elapsedMs,
    })) {
      setPendingFeedbackMessageId(candidate.messageId);
    }
  }, [messages]);

  // ─── Scroll state, refs, effects (extracted to useChatScroll) ───
  const {
    showJumpPill, setShowJumpPill,
    hasOlderMessages, setHasOlderMessages,
    loadingOlderMessages, setLoadingOlderMessages,
    freezeMessageLayout, setFreezeMessageLayout,
    initialScrollDone, setInitialScrollDone,
    messagesContainerRef, bottomRef, isAtBottomRef, jumpSuppressScrollTopRef,
    scrollMessagesToBottom, loadOlderMessages, resetToLatestMessages, resetScrollState,
  } = useChatScroll({
    messages, setMessages, streaming, sessionRestoring, setSessionRestoring,
    sessionRestoringRef, currentSessionIdRef, view,
  });

  // ─── ensureSession (shared by useChatSend) ───
  const { ensureSession } = useChatSessionUtils({
    navigate, setCurrentSessionId, setWarnings,
    currentSessionIdRef, skipRestoreRef,
  });

  // ─── Crew state / mission management (extracted to useChatCrew) ───
  // Placed before useChatSessionLifecycle because the lifecycle hook needs setCrewWorkers and crewMissionSessionIdRef.
  const {
    crewWorkers, setCrewWorkers,
    crewMissionActive, setCrewMissionActive,
    crewMissionId, setCrewMissionId,
    crewInterMessages, setCrewInterMessages,
    crewMissionSessionIdRef,
    resetCrewMissionState, isCrewEventForCurrentSession,
  } = useChatCrew({ currentSessionId, currentSessionIdRef });

  // ─── Session lifecycle: load, CRUD, restore effect, handleSelectSession ───
  // Placed early because subsequent effects depend on loadSessions/loadTodos.
  const titleGeneratedRef = useRef(false);
  const {
    loadSessions, loadTodos, generateTitle, openChildSession,
    handleShowSessions, handleSelectSession, handleNewSession, startNewSession, resetSessionViewState,
    handleArchiveSession, handleDeleteSessionContent, handleDeleteSession,
    clearSessionModalOpen, setClearSessionModalOpen,
    clearSessionBusy, setClearSessionBusy,
  } = useChatSessionLifecycle({
    navigate, isCrewPrivateSession, coreSession, sessionId, location, crewList,
    setView, setCurrentSessionId, setCurrentSessionTitle, setSessionList, setCrewList, setTodoItems,
    setStreaming, setMessages, setWarnings, setPendingFeedbackMessageId,
    setChildSessionDrawer,
    setTokenUsed, setTokenInput, setTokenOutput, setTokenTotal, setCompactionCount,
    setShowJumpPill, setHasOlderMessages,
    setSessionRestoring, setIsCrewPrivateSession, setCrewPrivateHost, setPrivateHostCrewId,
    setParentSessionId, setCrewWorkers, setBypassPermissionsState,
    setTurnActivity, setCurrentStep,
    currentSessionIdRef, chatReturnToRef, skipRestoreRef, titleGeneratedRef,
    sessionRestoringRef, isInitialLoadRef, lastTurnFeedbackCandidateRef, rateLimitSeenRef,
    crewMissionSessionIdRef, tokenInputRef, tokenOutputRef, isAtBottomRef, messagesContainerRef,
    jumpSuppressScrollTopRef, turnActiveRef, activeTurnIdRef, messagesRef, resetScrollState,
  });

  const filteredSessionList = useMemo(() => {
    return sessionList.filter((s) => {
      const kind = s.contextKind ?? 'agent_x';
      if (kind === 'automation' || s.id.startsWith('automation:') || s.id.startsWith('voice:')) return false;
      return sessionListTab === 'crew_private' ? kind === 'crew_private' : kind !== 'crew_private';
    });
  }, [sessionList, sessionListTab]);

  const agentSessionCount = useMemo(
    () => sessionList.filter((s) => {
      const kind = s.contextKind ?? 'agent_x';
      return kind !== 'crew_private' && kind !== 'automation' && !s.id.startsWith('automation:') && !s.id.startsWith('voice:');
    }).length,
    [sessionList],
  );
  const crewPrivateSessionCount = useMemo(
    () => sessionList.filter((s) =>
      (s.contextKind ?? 'agent_x') === 'crew_private' && !s.id.startsWith('voice:'),
    ).length,
    [sessionList],
  );

  // Load sessions on mount and when view becomes 'sessions'
  useEffect(() => {
    if (view === 'sessions') loadSessions();
  }, [view, loadSessions]);

  const providerListRef = useRef(providerList);
  useEffect(() => { providerListRef.current = providerList; }, [providerList]);
  const currentModelRef = useRef(currentModel);
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);

  /** Reload cleared-model picker for a profile; always include the active model so Settings↔Chat stay aligned. */
  const reloadClearedModelList = useCallback(async (
    profileId: string,
    providerIdHint?: string,
    ensureModelId?: string,
  ) => {
    if (!profileId) {
      setModelList([]);
      return;
    }
    const profile = providerListRef.current.find((p) => p.id === profileId);
    const providerId = profile?.providerId || providerIdHint || profileId;
    const ensureId = ensureModelId || currentModelRef.current || undefined;
    setLoadingModels(true);
    try {
      const [all, cleared] = await Promise.all([
        providers.models(providerId),
        modelBenchmark.cleared(providerId).catch(() => ({ models: [] as Array<{ modelId: string }> })),
      ]);
      const allowed = new Set(cleared.models.map((m) => m.modelId));
      if (ensureId) allowed.add(ensureId);
      setModelList(all.filter((m) => allowed.has(m.id)));
    } catch {
      setModelList([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  /**
   * Re-read active provider/model from the server.
   * Required because Chat stays mounted (hidden) while Settings changes config.
   */
  const syncRuntimeSelection = useCallback(async () => {
    try {
      const r = await models.current();
      const model = r.model || '';
      const profileId = r.activeProfile || r.provider || '';
      const providerId = r.providerId || r.provider || '';
      setCurrentModel(model);
      setCurrentProvider(profileId);
      setCurrentProviderId(providerId);
      if (profileId) {
        await reloadClearedModelList(profileId, providerId, model || undefined);
      } else {
        setModelList([]);
      }
    } catch {
      try {
        const res = await fetch('/api/providers', { credentials: 'include' });
        const data = await res.json() as { active?: string };
        if (data.active) {
          setCurrentProvider(data.active);
          setCurrentProviderId(data.active);
        }
      } catch { /* ignore */ }
    }
  }, [reloadClearedModelList]);

  // Load model, provider, crew, session settings
  useEffect(() => {
    void syncRuntimeSelection().finally(() => { setConfigLoaded(true); });
    crews.list().then((list) => { setCrewList(list); }).catch(() => {});

    // Load configured provider profiles
    fetch('/api/providers', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { active?: string; providers?: Array<{ id: string; activeProfile?: string; profiles?: Array<{ id: string; label: string }> }> }) => {
        if (data.providers) {
          const allProfiles: Array<{ id: string; label: string; providerId: string }> = [];
          data.providers.forEach(p => {
            if (p.profiles && p.profiles.length > 0) {
              p.profiles.forEach(prof => allProfiles.push({ id: prof.id, label: prof.label, providerId: p.id }));
            } else {
              // Fallback: single default profile
              allProfiles.push({ id: p.id + '-default', label: p.id, providerId: p.id });
            }
          });
          setProviderList(allProfiles);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap; syncRuntimeSelection is re-bound via event below
  }, []);

  // Settings (and toolbar) can change the active model while Chat is still mounted/hidden.
  useEffect(() => onRuntimeConfigChanged(() => { void syncRuntimeSelection(); }), [syncRuntimeSelection]);

  // Load cleared (benchmarked) models when provider/profile list changes.
  // Active model inclusion is handled by syncRuntimeSelection (Settings→Chat resync).
  useEffect(() => {
    if (!currentProvider) { setModelList([]); return; }
    let cancelled = false;
    void reloadClearedModelList(currentProvider, currentProviderId).then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [currentProvider, currentProviderId, providerList, reloadClearedModelList]);

  // Hydrate TASKS panel whenever the active session changes (restore also calls loadTodos).
  useEffect(() => {
    if (!currentSessionId) {
      setTodoItems([]);
      return;
    }
    loadTodos(currentSessionId);
  }, [currentSessionId, loadTodos, setTodoItems]);

  // Helper to immutably update the last assistant message — extracted to ./chat/message-helpers.ts


  // Load history on mount — only if no sessionId (session restore handles it instead)
  useEffect(() => {
    if (sessionId) return;
    chat.history().then((h) => {
      const visible = h.filter((m) => m.role !== 'system');
      setMessages(visible.map((m) => ({ ...m, streaming: false })));
      const totalTokens = h.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenUsed(totalTokens);
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
      isInitialLoadRef.current = false;
    }).catch(() => {
      isInitialLoadRef.current = false;
    });
  }, [sessionId]);


  // Compute whether send is blocked due to missing provider/model or unsupported image attachments
  const questionnairePending = useMemo(() => hasPendingChatInteraction(messages), [messages]);

  const hasImageAttachment = attachments.some((a) => isImageMimeType(a.mimeType));
  const visionSupported = supportsVision(currentProvider, currentModel);
  const imageSendBlocked = hasImageAttachment && !visionSupported;
  const sendBlocked = !currentProvider || !currentModel || imageSendBlocked;
  const sendBlockedReason = !currentProvider
    ? 'Select a provider before sending'
    : !currentModel
      ? 'Select a model before sending'
      : imageSendBlocked
        ? 'Current model does not support images. Switch to a vision model to send this message.'
        : '';

  // Keep refs in sync so send handlers never capture stale session from closures.
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // Fetch session permissions when active session changes
  useEffect(() => {
    if (currentSessionId) fetchSessionPermissions(currentSessionId);
  }, [currentSessionId, fetchSessionPermissions]);

  // URL may clear sessionId (session list) while ChatPanel stays mounted.
  // Keep filtering against the live thread so mid-turn SSE is not dropped.
  useEffect(() => {
    viewSessionIdRef.current = sessionId ?? currentSessionIdRef.current;
  }, [sessionId]);

  // ─── Telemetry: SSE subscription, handleEvent, RAF batching, streaming timeout, turn polling (extracted to useChatTelemetry) ───
  useChatTelemetry({
    streaming, crewList, turnActivity,
    isInitialLoadRef, turnActiveRef, activeTurnIdRef, outgoingTurnRef, resendInProgressRef,
    lastTurnFeedbackCandidateRef, viewSessionIdRef, currentSessionIdRef, isCrewPrivateRef,
    crewPrivateHostRef, crewMissionSessionIdRef, crewSuggestionHandledRef, crewGateInFlightRef,
    attachCrewRosterPickerRef, rateLimitSeenRef, tokenInputRef, tokenOutputRef, tokenReservedRef,
    setMessages, setStreaming, setTurnActivity, setCurrentStep, setTokenStreaming, setTokenUsed,
    setLoadingSteps, setWarnings, setStepCapPrompt, setPermissionPrompt,
    setPendingPermissionCount, setCrewWorkers, setCrewMissionActive, setCrewMissionId,
    setCrewInterMessages, setTokenInput, setTokenOutput, setTokenReserved, setTokenTotal,
    setCompactionCount, setToolEnablePrompt, setConnState,
    setLastEventAt, setBypassPermissionsState, setTodoItems, setTasksExpanded,
    endTurnUi, isCrewEventForCurrentSession,
  });

  const openCrewDossierFromFields = useCallback((crew: {
    name: string;
    title?: string;
    callsign: string;
    description?: string;
    systemPrompt: string;
    tone?: string;
    expertise?: string[];
    traits?: string[];
    tools?: string[];
    catalogId?: string;
  }) => {
    setCrewDossierCrew({
      name: crew.name,
      title: crew.title ?? '',
      callsign: crew.callsign,
      description: crew.description,
      systemPrompt: crew.systemPrompt,
      tone: crew.tone ?? '',
      expertise: crew.expertise ?? [],
      traits: crew.traits ?? [],
      tools: crew.tools,
      catalogId: crew.catalogId,
    });
    setCrewDossierOpen(true);
  }, [setCrewDossierCrew, setCrewDossierOpen]);

  const handleViewCrewDossier = useCallback(async (candidate: CrewMatchCandidate) => {
    if (candidate.onRoster || candidate.origin === 'custom' || candidate.origin === 'hub_roster') {
      const roster = crewListRef.current.find((c) => c.id === candidate.id);
      if (roster) {
        openCrewDossierFromFields(roster);
        return;
      }
    }
    try {
      const { entry } = await crewSuggestions.getCatalogEntry(candidate.catalogId ?? candidate.id);
      openCrewDossierFromFields({
        name: entry.name,
        title: entry.title,
        callsign: entry.callsign,
        description: entry.description,
        systemPrompt: entry.systemPrompt,
        tone: entry.tone ?? '',
        expertise: entry.expertise,
        traits: entry.traits,
        tools: entry.tools,
        catalogId: entry.id ?? candidate.catalogId,
      });
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to load crew dossier'));
    }
  }, [crewListRef, openCrewDossierFromFields, setWarnings]);

  /** Open hub/roster profile from an inline @crew chip in the message list. */
  const handleViewCrewByCallsign = useCallback(async (callsign: string, name?: string) => {
    const key = callsign.trim().toLowerCase();
    if (!key) return;
    const roster = crewListRef.current.find((c) => c.callsign.toLowerCase() === key);
    if (roster) {
      openCrewDossierFromFields(roster);
      return;
    }
    const catalogIds = [
      key.startsWith('hub-') ? key : `hub-${key}`,
      key,
    ];
    for (const catalogId of catalogIds) {
      try {
        const { entry } = await crewSuggestions.getCatalogEntry(catalogId);
        openCrewDossierFromFields({
          name: entry.name || name || callsign,
          title: entry.title,
          callsign: entry.callsign,
          description: entry.description,
          systemPrompt: entry.systemPrompt,
          tone: entry.tone ?? '',
          expertise: entry.expertise,
          traits: entry.traits,
          tools: entry.tools,
          catalogId: entry.id ?? catalogId,
        });
        return;
      } catch {
        /* try next id */
      }
    }
    setWarnings((prev) => replaceWarning(
      prev,
      `Couldn't load profile for @${callsign}${name ? ` (${name})` : ''}`,
    ));
  }, [crewListRef, openCrewDossierFromFields, setWarnings]);

  // ─── Send/resend/steer/queue, crew suggestion gate, roster picker, questionnaire (extracted to useChatSend) ───
  const {
    executeSend, runCrewSuggestionGate,
    handleSend, handleResend, handleStopAndSend, handleAddToQueue, handleSteer,
    handleCrewRosterPickerSubmit, handleCrewRosterPickerSkip, handleQuestionnaireRespond,
    handleFileSelect, handleRemoveAttachment,
  } = useChatSend({
    messages, streaming, attachments, currentProvider, currentModel,
    isCrewPrivateSession, webSearchAvailable, webSearchForce, crewSuggestionRequested, currentSessionId,
    coreSession,
    setMessages, setAttachments, setWarnings, setCrewList,
    setTurnActivity, setLoadingSteps, setStreaming,
    beginTurnUi, endTurnUi, ensureSession, scrollMessagesToBottom,
    rateLimitSeenRef,
    outgoingTurnRef, activeTurnIdRef, resendInProgressRef,
    crewSuggestionHandledRef, crewGateInFlightRef, attachCrewRosterPickerRef,
    pendingSendTextRef, inputBarRef,
    setCrewSuggestionRequested,
  });


  const handleCancel = useCallback(async () => {
    endTurnUi();
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
    try { await chat.cancel(); } catch { /* ignore */ }
  }, [endTurnUi]);

  // handleSelectSession has been moved to useChatSessionLifecycle.

  return {
    // Router
    navigate, location: location, searchParams, setSearchParams,
    sessionListTab, setSessionListTab,
    coreSession,

    // View state
    view, setView, sessionList, setSessionList, currentSessionTitle, setCurrentSessionTitle,
    currentSessionId, setCurrentSessionId, isCrewPrivateSession, setIsCrewPrivateSession,
    crewPrivateHost, setCrewPrivateHost, privateHostCrewId, setPrivateHostCrewId,
    parentSessionId, setParentSessionId, childSessionDrawer, setChildSessionDrawer,

    // Chat state
    messages, setMessages, streaming, setStreaming, sessionRestoring, setSessionRestoring,
    inputClearSignal, crewWorkers, crewMissionActive, crewMissionId, crewInterMessages,
    permissionPrompt, setPermissionPrompt, pendingPermissionCount, setPendingPermissionCount,
    toolEnablePrompt, setToolEnablePrompt, attachments, setAttachments,
    loadingSteps, setLoadingSteps, warnings, setWarnings,

    // Token state
    tokenUsed, setTokenUsed, tokenInput, setTokenInput, tokenOutput, setTokenOutput,
    tokenReserved, setTokenReserved, tokenStreaming, setTokenStreaming,
    tokenTotal, setTokenTotal, compactionCount, setCompactionCount, tokenPercent,

    // Turn state
    turnActivity, setTurnActivity, pendingFeedbackMessageId, setPendingFeedbackMessageId,
    feedbackSubmitting, setFeedbackSubmitting, currentStep, setCurrentStep,

    // Scroll state
    showJumpPill, setShowJumpPill, hasOlderMessages, setHasOlderMessages,
    loadingOlderMessages, setLoadingOlderMessages, freezeMessageLayout, setFreezeMessageLayout,
    initialScrollDone, setInitialScrollDone,
    messagesContainerRef, bottomRef, scrollMessagesToBottom, loadOlderMessages, resetToLatestMessages,

    // Model/provider state
    currentModel, setCurrentModel, currentProvider, setCurrentProvider,
    currentProviderId, setCurrentProviderId, providerList, setProviderList,
    modelList, setModelList, loadingModels, setLoadingModels, configLoaded, setConfigLoaded,

    // Crew state
    crewList, setCrewList,

    // Unified permission state
    bypassPermissions, toolPermissions,
    setBypassPermissions, toggleBypassPermissions, revokeSessionPermissions, setToolPermission,

    // Dropdown anchors
    providerMenuAnchor, setProviderMenuAnchor,
    modelMenuAnchor, setModelMenuAnchor,

    // Connection/enhancement state
    connState, setConnState, lastEventAt, setLastEventAt,
    searchOpen, setSearchOpen, checkpointsOpen, setCheckpointsOpen,

    // Agent gate modals
    stepCapPrompt, setStepCapPrompt,

    // Crew dossier
    crewDossierOpen, setCrewDossierOpen, crewDossierCrew, setCrewDossierCrew,

    // Clear session
    clearSessionModalOpen, setClearSessionModalOpen, clearSessionBusy, setClearSessionBusy,

    // Web search
    webSearchAvailable, setWebSearchAvailable, webSearchForce, setWebSearchForce,
    handleWebSearchToggle,

    // Crew suggestion requested (one-shot toggle)
    crewSuggestionRequested, setCrewSuggestionRequested, handleCrewSuggestionToggle,

    // Sidebar
    todoItems, setTodoItems,
    tokenExpanded, setTokenExpanded,
    tasksExpanded, setTasksExpanded, missionExpanded, setMissionExpanded,

    // Refs
    fileInputRef, inputBarRef, isCrewPrivateRef, crewPrivateHostRef,
    currentSessionIdRef, viewSessionIdRef, chatReturnToRef,
    tokenReservedRef, pendingSendTextRef,
    jumpSuppressScrollTopRef,

    // Handlers
    handlePermissionRespond, handlePermissionRespondBatch, handleSwitchToBypassMode,
    handleSend, handleResend, handleCancel, handleStopAndSend, handleAddToQueue, handleSteer,
    handleFileSelect, handleRemoveAttachment, handleShowSessions, handleSelectSession,
    handleNewSession, handleArchiveSession, handleDeleteSessionContent, handleDeleteSession,
    handleQuestionnaireRespond,
    handleCrewRosterPickerSubmit, handleCrewRosterPickerSkip,
    handleTurnFeedback, handleSaveMarkdown, handleViewCrewDossier, handleViewCrewByCallsign,
    openChildSession,

    // Derived values
    sendBlocked, sendBlockedReason, questionnairePending,
    filteredSessionList, agentSessionCount, crewPrivateSessionCount,

    // Helper functions
    endTurnUi, beginTurnUi, ensureSession,
    executeSend, runCrewSuggestionGate,
    startNewSession, resetSessionViewState, resetCrewMissionState,
    loadSessions, loadTodos, generateTitle,
    fetchSessionPermissions,
  };
}
