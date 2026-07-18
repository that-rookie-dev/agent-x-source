// useChatSessionState.ts — extracted from ChatPanel.tsx
// Contains ALL chat session state, refs, handlers, and effects.
// ChatSessionProvider calls this hook and exposes state/dispatch via context.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

import SmartToyIcon from '@mui/icons-material/SmartToy';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import HistoryIcon from '@mui/icons-material/History';

import {
  type PaletteAction,
} from '../ChatEnhancements';
import { chat, sessions, models, crews, crewSuggestions, providers, system, settings, permissions, sessionPermissions, markdownDocuments, type TodoItem, type SessionInfo, type Crew, type ModelInfo, type ConnectionState, type CrewSuggestionEvaluation, type CrewMatchCandidate, type IntegrationActionPreview } from '../../api';
import type { PrebuiltCrew } from '../crew/CrewHubDialog';
import type { ChatInputBarHandle } from '../ChatInputBar';
import { readWebSearchForcePreference, writeWebSearchForcePreference } from '../WebSearchGlobeToggle';
import { readCrewSuggestionRequestedPreference, writeCrewSuggestionRequestedPreference } from '../CrewSuggestionToggle';
import { hasPendingChatInteraction } from '../../chat/utils';
import { supportsVision, isImageMimeType } from '../../chat/vision-support';
import { summarizeMessageForTurnFeedback } from '@agentx/shared/browser';
import { isTurnFeedbackEligible } from '@agentx/shared/browser';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import type { ChildSessionDrawerState } from '../../chat/ChildSessionDrawer';
import { resolveDefaultWorkspace } from '../../utils/default-workspace';
import type { UIMessage, FileAttachment, ChatView, SessionListTab } from '../../chat/types';
import { replaceWarning } from './message-helpers';
import { useChatScroll } from './useChatScroll';
import { useChatTokens } from './useChatTokens';
import { useChatCrew } from './useChatCrew';
import { useChatVoice } from './useChatVoice';
import { useChatSessionLifecycle } from './useChatSessionLifecycle';
import { useChatSend } from './useChatSend';
import { useChatTelemetry } from './useChatTelemetry';
import { useChatSessionUtils } from './useChatSessionUtils';

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
  const [contextExpanded, setContextExpanded] = useState(false);
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
    contextData, setContextData,
    rebuildingContext, setRebuildingContext,
    applyContextPayload, refreshContext, refreshContextRef, handleRebuildContext,
  } = useChatTokens({ currentSessionId, currentModel, modelList });

  // Crew state (fixed per session)
  const [crewList, setCrewList] = useState<Crew[]>([]);
  const crewListRef = useRef(crewList);
  useEffect(() => { crewListRef.current = crewList; }, [crewList]);

  // CWD
  const [cwd, setCwd] = useState('');
  const cwdRef = useRef('');

  // Dropdown anchors
  const [providerMenuAnchor, setProviderMenuAnchor] = useState<null | HTMLElement>(null);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);

  // Send action menu moved to ChatInputBar

  // New session dialog
  // ─── Enhancements: connection health, palette, slash, search, checkpoints ───
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerCallback, setFolderPickerCallback] = useState<((path: string) => void) | null>(null);
  const [folderConsentOpen, setFolderConsentOpen] = useState(false);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const pendingFolderActionRef = useRef<'newSession' | 'changeCwd' | null>(null);

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

  // ─── Voice composer state, handlers, context registration (extracted to useChatVoice) ───
  const {
    voiceCtx,
    composerMode, setComposerMode,
    voiceAutoStart, setVoiceAutoStart,
    scrollAfterVoiceUserRef,
    handleVoiceUserPending, handleVoiceUserDiscarded, handleVoiceTranscript, handleVoiceTiming,
  } = useChatVoice({ setMessages, beginTurnUi, currentSessionId });

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
    scrollMessagesToBottom, loadOlderMessages, resetScrollState,
  } = useChatScroll({
    messages, setMessages, streaming, sessionRestoring, setSessionRestoring,
    sessionRestoringRef, currentSessionIdRef, view, scrollAfterVoiceUserRef,
  });

  // ─── ensureDefaultCwd / ensureSession (shared by useChatCrew and useChatSend) ───
  const { ensureDefaultCwd, ensureSession } = useChatSessionUtils({
    navigate, setCwd, setCurrentSessionId, setWarnings,
    cwdRef, currentSessionIdRef, skipRestoreRef,
  });

  // ─── Crew state, handlers, mission management (extracted to useChatCrew) ───
  // Placed before useChatSessionLifecycle because the lifecycle hook needs setCrewWorkers and crewMissionSessionIdRef.
  const {
    crewWorkers, setCrewWorkers,
    crewMissionActive, setCrewMissionActive,
    crewMissionId, setCrewMissionId,
    crewInterMessages, setCrewInterMessages,
    crewMissionSessionIdRef,
    crewAddQuery, setCrewAddQuery,
    crewAddResults, setCrewAddResults,
    crewAddOpen, setCrewAddOpen,
    crewAddLoading, setCrewAddLoading,
    handleCrewAddSearch, handleCrewAddSelect, handleCrewRemove,
    resetCrewMissionState, isCrewEventForCurrentSession,
  } = useChatCrew({ currentSessionId, currentSessionIdRef, ensureSession, setCrewList, setWarnings });

  // ─── Session lifecycle: load, CRUD, folder consent, restore effect, handleSelectSession ───
  // Placed early because subsequent effects depend on loadSessions/loadTodos.
  const titleGeneratedRef = useRef(false);
  const {
    loadSessions, loadTodos, generateTitle, openChildSession,
    handleShowSessions, handleSelectSession, handleNewSession, startNewSession, resetSessionViewState,
    handleArchiveSession, handleDeleteSessionContent, handleDeleteSession,
    handleFolderConsentConfirm,
    clearSessionModalOpen, setClearSessionModalOpen,
    clearSessionBusy, setClearSessionBusy,
  } = useChatSessionLifecycle({
    navigate, isCrewPrivateSession, coreSession, sessionId, location, crewList,
    setView, setCurrentSessionId, setCurrentSessionTitle, setSessionList, setCrewList, setCwd, setTodoItems,
    setStreaming, setMessages, setWarnings, setPendingFeedbackMessageId,
    setFolderConsentOpen, setFolderPickerLoading, setFolderPickerCallback, setFolderPickerOpen,
    setChildSessionDrawer,
    setTokenUsed, setTokenInput, setTokenOutput, setTokenTotal, setCompactionCount,
    setShowJumpPill, setHasOlderMessages,
    setSessionRestoring, setIsCrewPrivateSession, setCrewPrivateHost, setPrivateHostCrewId,
    setParentSessionId, setCrewWorkers, setBypassPermissionsState,
    setTurnActivity, setCurrentStep,
    currentSessionIdRef, cwdRef, chatReturnToRef, skipRestoreRef, pendingFolderActionRef, titleGeneratedRef,
    sessionRestoringRef, isInitialLoadRef, lastTurnFeedbackCandidateRef, rateLimitSeenRef,
    crewMissionSessionIdRef, tokenInputRef, tokenOutputRef, isAtBottomRef, messagesContainerRef,
    jumpSuppressScrollTopRef, turnActiveRef, activeTurnIdRef, resetScrollState,
  });

  const filteredSessionList = useMemo(() => {
    return sessionList.filter((s) => {
      const kind = s.contextKind ?? 'agent_x';
      if (kind === 'automation' || s.id.startsWith('automation:')) return false;
      return sessionListTab === 'crew_private' ? kind === 'crew_private' : kind !== 'crew_private';
    });
  }, [sessionList, sessionListTab]);

  const agentSessionCount = useMemo(
    () => sessionList.filter((s) => {
      const kind = s.contextKind ?? 'agent_x';
      return kind !== 'crew_private' && kind !== 'automation' && !s.id.startsWith('automation:');
    }).length,
    [sessionList],
  );
  const crewPrivateSessionCount = useMemo(
    () => sessionList.filter((s) => (s.contextKind ?? 'agent_x') === 'crew_private').length,
    [sessionList],
  );

  // Load sessions on mount and when view becomes 'sessions'
  useEffect(() => {
    if (view === 'sessions') loadSessions();
  }, [view, loadSessions]);

  // Load model, provider, crew, cwd, session settings
  useEffect(() => {
    // Get current model/provider - fallback to providers endpoint if models fails
    models.current()
      .then((r) => { setCurrentModel(r.model || ''); setCurrentProvider(r.activeProfile || r.provider || ''); setCurrentProviderId(r.providerId || r.provider || ''); })
      .catch(() => {
        // Fallback: get active provider from /providers endpoint
        fetch('/api/providers', { credentials: 'include' })
          .then(r => r.json())
          .then((data: { active?: string }) => { if (data.active) { setCurrentProvider(data.active); setCurrentProviderId(data.active); } })
          .catch(() => {});
      })
      .finally(() => { setConfigLoaded(true); });
    crews.list().then((list) => { setCrewList(list); }).catch(() => {});
    system.cwd().then(async (r) => {
      if (r.cwd) {
        setCwd(r.cwd);
        cwdRef.current = r.cwd;
        return;
      }
      const folder = await resolveDefaultWorkspace();
      setCwd(folder);
      cwdRef.current = folder;
      await system.setCwd(folder).catch(() => {});
    }).catch(() => {});

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
  }, []);

  // Load models when provider changes
  useEffect(() => {
    if (!currentProvider) { setModelList([]); return; }
    const profile = providerList.find(p => p.id === currentProvider);
    const providerId = profile?.providerId || currentProvider;
    setLoadingModels(true);
    providers.models(providerId).then((m) => { setModelList(m); }).catch(() => { setModelList([]); }).finally(() => setLoadingModels(false));
  }, [currentProvider, providerList]);

  useEffect(() => { loadTodos(); }, [loadTodos]);

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

  // Keep refs in sync so send handlers never capture stale session/cwd from closures.
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // Fetch session permissions when active session changes
  useEffect(() => {
    if (currentSessionId) fetchSessionPermissions(currentSessionId);
  }, [currentSessionId, fetchSessionPermissions]);

  useEffect(() => { viewSessionIdRef.current = sessionId ?? null; }, [sessionId]);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  // ─── Telemetry: SSE subscription, handleEvent, RAF batching, streaming timeout, turn polling (extracted to useChatTelemetry) ───
  useChatTelemetry({
    streaming, crewList, turnActivity,
    isInitialLoadRef, turnActiveRef, activeTurnIdRef, outgoingTurnRef, resendInProgressRef,
    lastTurnFeedbackCandidateRef, viewSessionIdRef, currentSessionIdRef, isCrewPrivateRef,
    crewPrivateHostRef, crewMissionSessionIdRef, crewSuggestionHandledRef, crewGateInFlightRef,
    attachCrewRosterPickerRef, rateLimitSeenRef, tokenInputRef, tokenOutputRef, tokenReservedRef,
    refreshContextRef,
    setMessages, setStreaming, setTurnActivity, setCurrentStep, setTokenStreaming, setTokenUsed,
    setLoadingSteps, setWarnings, setStepCapPrompt, setPermissionPrompt,
    setPendingPermissionCount, setCrewWorkers, setCrewMissionActive, setCrewMissionId,
    setCrewInterMessages, setTokenInput, setTokenOutput, setTokenReserved, setTokenTotal,
    setCompactionCount, setToolEnablePrompt, setConnState,
    setLastEventAt, setBypassPermissionsState,
    endTurnUi, isCrewEventForCurrentSession,
  });

  const handleViewCrewDossier = useCallback(async (candidate: CrewMatchCandidate) => {
    if (candidate.onRoster || candidate.origin === 'custom' || candidate.origin === 'hub_roster') {
      const roster = crewListRef.current.find((c) => c.id === candidate.id);
      if (roster) {
        setCrewDossierCrew({
          name: roster.name,
          title: roster.title ?? '',
          callsign: roster.callsign,
          description: roster.description,
          systemPrompt: roster.systemPrompt,
          tone: roster.tone ?? '',
          expertise: roster.expertise ?? [],
          traits: roster.traits ?? [],
          tools: roster.tools,
        });
        setCrewDossierOpen(true);
        return;
      }
    }
    try {
      const { entry } = await crewSuggestions.getCatalogEntry(candidate.catalogId ?? candidate.id);
      setCrewDossierCrew({
        name: entry.name,
        title: entry.title,
        callsign: entry.callsign,
        description: entry.description,
        systemPrompt: entry.systemPrompt,
        tone: entry.tone ?? '',
        expertise: entry.expertise,
        traits: entry.traits,
        tools: entry.tools,
      });
      setCrewDossierOpen(true);
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to load crew dossier'));
    }
  }, [crewListRef, setCrewDossierCrew, setCrewDossierOpen, setWarnings]);

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

  // ─── Command palette actions ───
  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: 'new-session', label: 'New session', hint: 'N', icon: <AddIcon sx={{ fontSize: 14 }} />, run: () => handleNewSession() },
    { id: 'sessions', label: 'Show all sessions', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => handleShowSessions() },
    { id: 'search', label: 'Search sessions', hint: '⌘F', icon: <SearchIcon sx={{ fontSize: 14 }} />, run: () => setSearchOpen(true) },
    { id: 'checkpoints', label: 'Open checkpoints', icon: <HistoryIcon sx={{ fontSize: 14 }} />, run: () => setCheckpointsOpen(true) },
  ], []);


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
    messagesContainerRef, bottomRef, scrollMessagesToBottom, loadOlderMessages,

    // Model/provider state
    currentModel, setCurrentModel, currentProvider, setCurrentProvider,
    currentProviderId, setCurrentProviderId, providerList, setProviderList,
    modelList, setModelList, loadingModels, setLoadingModels, configLoaded, setConfigLoaded,

    // Crew state
    crewList, setCrewList,

    // Unified permission state
    bypassPermissions, toolPermissions,
    setBypassPermissions, toggleBypassPermissions, revokeSessionPermissions, setToolPermission,

    // CWD
    cwd, setCwd,

    // Dropdown anchors
    providerMenuAnchor, setProviderMenuAnchor,
    modelMenuAnchor, setModelMenuAnchor,

    // Connection/enhancement state
    connState, setConnState, lastEventAt, setLastEventAt,
    paletteOpen, setPaletteOpen, searchOpen, setSearchOpen, checkpointsOpen, setCheckpointsOpen,
    folderPickerOpen, setFolderPickerOpen, folderPickerCallback, setFolderPickerCallback,
    folderConsentOpen, setFolderConsentOpen, folderPickerLoading, setFolderPickerLoading,

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

    // Composer
    composerMode, setComposerMode, voiceAutoStart, setVoiceAutoStart,

    // Sidebar
    todoItems, setTodoItems, contextData, setContextData, rebuildingContext, setRebuildingContext,
    contextExpanded, setContextExpanded, tokenExpanded, setTokenExpanded,
    tasksExpanded, setTasksExpanded, missionExpanded, setMissionExpanded,
    crewAddQuery, setCrewAddQuery, crewAddResults, setCrewAddResults,
    crewAddOpen, setCrewAddOpen, crewAddLoading, setCrewAddLoading,

    // Refs
    fileInputRef, inputBarRef, isCrewPrivateRef, crewPrivateHostRef,
    currentSessionIdRef, viewSessionIdRef, cwdRef, chatReturnToRef,
    pendingFolderActionRef, tokenReservedRef, pendingSendTextRef,
    jumpSuppressScrollTopRef,

    // Handlers
    handlePermissionRespond, handlePermissionRespondBatch,
    handleSend, handleResend, handleCancel, handleStopAndSend, handleAddToQueue, handleSteer,
    handleFileSelect, handleRemoveAttachment, handleShowSessions, handleSelectSession,
    handleNewSession, handleArchiveSession, handleDeleteSessionContent, handleDeleteSession,
    handleFolderConsentConfirm, handleQuestionnaireRespond,
    handleCrewRosterPickerSubmit, handleCrewRosterPickerSkip,
    handleCrewAddSearch, handleCrewAddSelect, handleCrewRemove,
    handleTurnFeedback, handleSaveMarkdown, handleViewCrewDossier,
    handleVoiceUserPending, handleVoiceUserDiscarded, handleVoiceTranscript, handleVoiceTiming,
    handleRebuildContext, openChildSession,

    // Derived values
    sendBlocked, sendBlockedReason, questionnairePending,
    filteredSessionList, agentSessionCount, crewPrivateSessionCount, paletteActions,

    // Voice
    voiceCtx,

    // Helper functions
    endTurnUi, beginTurnUi, ensureSession, ensureDefaultCwd,
    executeSend, runCrewSuggestionGate,
    startNewSession, resetSessionViewState, resetCrewMissionState,
    refreshContext, applyContextPayload, loadSessions, loadTodos, generateTitle,
    fetchSessionPermissions,
  };
}
