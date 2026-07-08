import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ArticleIcon from '@mui/icons-material/Article';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { CheckCircle } from './CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import BoltIcon from '@mui/icons-material/Bolt';

import ReplayIcon from '@mui/icons-material/Replay';
import RouteIcon from '@mui/icons-material/Route';
import SearchIcon from '@mui/icons-material/Search';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HistoryIcon from '@mui/icons-material/History';
import ForumIcon from '@mui/icons-material/Forum';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import GroupsIcon from '@mui/icons-material/Groups';
import MicIcon from '@mui/icons-material/Mic';
import KeyboardIcon from '@mui/icons-material/Keyboard';

import {
  ConnectionHealthDot,
  ScrollToBottomPill,
  CommandPalette,
  SessionSearchModal,
  CheckpointDrawer,
  type PaletteAction,
} from './ChatEnhancements';
import { chat, sessions, todos, tools, models, crews, crewSuggestions, crewCatalog, providers, system, sessionSettings, agent, settings, permissions, type TelemetryEvent, type ChatMessage, type TodoItem, type SessionInfo, type Crew, type AgentMode, type ModelInfo, type ConnectionState, type CrewSuggestionEvaluation, type CrewMatchCandidate, type CatalogSummary, type IntegrationActionPreview } from '../api';
import { subscribeTelemetry } from '../telemetry-hub';
import { collectClientSituation } from '../client-situation.js';
import { eventBelongsToViewSession } from '../chat/session-stream-filter';
import { ActionPreviewCard } from './integrations/ActionPreviewCard';
import { colors, alphaColor } from '../theme';
import { hyperdrive } from '../styles/brands';
import ModeEscalationModal from './ModeEscalationModal';
import StepCapModal from './StepCapModal';
import ModeSuggestionModal, { DISMISS_KEY, shouldSuggestMode } from './ModeSuggestionModal';
import { CrewProfileDialog } from './crew/CrewProfileDialog';
import type { PrebuiltCrew } from './crew/CrewHubDialog';
import { ChatInputBar, type ChatInputBarHandle } from './ChatInputBar';
import { ChatVoicePanel } from './voice/ChatVoicePanel';
import type { VoiceTurnTimings } from '../voice/VoiceSessionClient';
import { useVoiceOptional } from './voice/VoiceProvider';
import { WebSearchGlobeToggle, readWebSearchForcePreference, writeWebSearchForcePreference } from './WebSearchGlobeToggle';
import { applyOperationEventToAssistant } from '../chat/operation-tool-patch';
import { ChatMessageList } from '../chat/ChatMessageList';
import { PlanModeContext } from '../chat/PlanModeContext';
import { ChildSessionDrawer, type ChildSessionDrawerState } from '../chat/ChildSessionDrawer';
import { ExecutionStatusChip } from '../chat/ExecutionStatusChip';
import { crewTheme } from '../styles/crew-theme';
import { stripToolNoise, sanitizeForJson, repairStreamTextGlitches, hasPendingChatInteraction, stripTrailingStreamPreamble, lastMessageIsQuestionnaireCard, mergeIncomingMessageParts, applyToolCompleteMetadata, reconcileStreamingMessageParts } from '../chat/utils';
import { CHAT_INITIAL_MESSAGES_PER_ROLE, CORE_SESSION_MESSAGES_PER_ROLE, mapHistoryToUiMessages, buildSessionShellPatch, applyTurnFeedbackRows } from '../chat/restoreMessages';
import { summarizeMessageForTurnFeedback } from '@agentx/shared/browser';
import { hydrateCrewDeliverables } from '../chat/restoreCrewHydration';
import { createCrewSuggestionEvalMessage, shouldOfferCrewRosterPicker } from '../chat/crew-suggestion-flow';
import { isTurnFeedbackEligible, crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import {
  upsertDeepSearchPart,
  parseDeepSearchProgressLine,
  parseDeepSearchProgressFromStream,
  deepSearchBundleFromMetadata,
  dedupeToolParts,
  type MessagePart,
} from '@agentx/shared/browser';
import { MedicalDisclaimerChatSessionStrip } from './crew/MedicalDisclaimerBanner';
import { CrewMissionCard, type CrewInterMessage } from './CrewMissionCard';
import type { CrewWorkerState } from './CrewWorkerPanel';
import { SessionGridCard } from './SessionGridCard';
import { FolderPickerModal } from './FolderPickerModal';
import { resolveDefaultWorkspace } from '../utils/default-workspace';
import { copyToClipboard } from '../utils/clipboard';

// ─── CSS Keyframes (injected once) ───
const styleId = 'agentx-chat-keyframes';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes agentx-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
    @keyframes agentx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes agentx-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes agentx-scanlines {
      0% { transform: translateY(0); }
      100% { transform: translateY(4px); }
    }
    @keyframes agentx-flicker {
      0%, 100% { opacity: 0.2; }
      15% { opacity: 0.7; }
      30% { opacity: 0.1; }
      45% { opacity: 0.8; }
      60% { opacity: 0.2; }
      75% { opacity: 0.6; }
      90% { opacity: 0.3; }
    }
    @keyframes agentx-hyperdrive-glow {
      0%, 100% { box-shadow: 0 0 5px ${alphaColor(hyperdrive.magenta, '40')}; border-color: ${alphaColor(hyperdrive.magenta, '30')}; }
      25% { box-shadow: 0 0 12px ${alphaColor(hyperdrive.magenta, '60')}, 0 0 20px ${alphaColor(hyperdrive.magenta, '20')}; border-color: ${alphaColor(hyperdrive.magenta, '50')}; }
      50% { box-shadow: 0 0 8px ${alphaColor(hyperdrive.magenta, '40')}, 0 0 15px ${alphaColor(hyperdrive.cyan, '20')}; border-color: ${alphaColor(hyperdrive.magenta, '30')}; }
      75% { box-shadow: 0 0 14px ${alphaColor(hyperdrive.magenta, '50')}, 0 0 25px ${alphaColor(hyperdrive.magenta, '30')}; border-color: ${alphaColor(hyperdrive.magenta, '60')}; }
    }
    @keyframes agentx-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

/** Shared height for chat header and right-sidebar section headers. */
const CHAT_HEADER_HEIGHT = 36;

const panelHeaderRowSx = {
  px: 1.5,
  py: 0.5,
  height: CHAT_HEADER_HEIGHT,
  boxSizing: 'border-box' as const,
  borderBottom: `1px solid ${colors.border.default}`,
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  flexShrink: 0,
};

const sidebarSectionHeaderSx = (expanded: boolean) => ({
  ...panelHeaderRowSx,
  borderBottom: expanded ? `1px solid ${colors.border.default}` : 'none',
  cursor: 'pointer',
  '&:hover': { bgcolor: alphaColor(colors.bg.tertiary, '40') },
});

const sidebarSectionHeaderWithDividerSx = (expanded: boolean) => ({
  ...sidebarSectionHeaderSx(expanded),
  borderTop: `1px solid ${colors.border.default}`,
});

const sidebarSectionContentSx = {
  px: 1.5,
  pt: 1,
  pb: 1.5,
};

interface UIMessage extends ChatMessage {
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
  attachments?: { name: string }[];
  turnTokens?: number;
  turnCostUsd?: number;
  voiceInput?: boolean;
  voiceTextOnly?: boolean;

  crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
  parts?: PartEntry[];
  isModeChange?: { from: string; to: string };
  turnFeedback?: { rating: TurnFeedbackRating };
}

interface PartEntry {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire' | 'crew_roster_picker' | 'deep_search';
  id: string;
  content?: string;
  tool?: ToolCall;
  agent?: SubAgent;
  questionnaire?: import('@agentx/shared/browser').QuestionnaireRecord;
  crewRosterPicker?: import('./crew/CrewRosterPickerMessage').CrewRosterPickerRecord;
  deepSearch?: {
    bundle?: import('@agentx/shared/browser').DeepSearchResultBundle;
    progress?: import('@agentx/shared/browser').DeepSearchProgress;
    running?: boolean;
  };
}

function upsertDeepSearchPartEntry(parts: PartEntry[], payload: Parameters<typeof upsertDeepSearchPart>[1]): PartEntry[] {
  return upsertDeepSearchPart(parts as MessagePart[], payload) as PartEntry[];
}

interface ToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  streamOutput?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  toolCalls?: ToolCall[];
}

interface FileAttachment {
  name: string;
  content: string;
}

type ChatView = 'sessions' | 'chat';
type SessionListTab = 'agent_x' | 'crew_private';

interface ChatPanelProps {
  sessionId?: string;
  coreSession?: boolean;
}

export function ChatPanel({ sessionId, coreSession = false }: ChatPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const voiceCtx = useVoiceOptional();
  const [composerMode, setComposerMode] = useState<'text' | 'voice'>('text');
  const [voiceAutoStart, setVoiceAutoStart] = useState(false);
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
  const [copiedSessionId, setCopiedSessionId] = useState(false);
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

  // Chat state
  const [sessionRestoring, setSessionRestoring] = useState(!!sessionId);
  const sessionRestoringRef = useRef(!!sessionId);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [inputClearSignal] = useState(0);
  const [crewWorkers, setCrewWorkers] = useState<CrewWorkerState[]>([]);
  const [crewMissionActive, setCrewMissionActive] = useState(false);
  const [crewMissionId, setCrewMissionId] = useState<string | null>(null);
  const [crewInterMessages, setCrewInterMessages] = useState<CrewInterMessage[]>([]);
  const crewMissionSessionIdRef = useRef<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<{ requestId: string; tool: string; path: string; riskLevel: string; integrationPreview?: IntegrationActionPreview; forAutomation?: boolean } | null>(null);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);

  const handlePermissionRespond = useCallback(async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    if (!permissionPrompt) return;
    try {
      await permissions.respond(permissionPrompt.requestId, choice);
    } catch { /* ignore */ }
    setPermissionPrompt(null);
    setPendingPermissionCount((prev) => Math.max(0, prev - 1));
  }, [permissionPrompt]);

  const handlePermissionRespondBatch = useCallback(async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await permissions.respondBatch(choice);
    } catch { /* ignore */ }
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
  }, []);
  const [toolEnablePrompt, setToolEnablePrompt] = useState<{ toolId: string; toolName: string } | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [webSearchForce, setWebSearchForce] = useState(() => readWebSearchForcePreference());
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const skipRestoreRef = useRef(false);
  const streamChunkRAFRef = useRef<number | null>(null);
  const streamChunkPendingRef = useRef<string | null>(null);
  // Batch thinking/reasoning deltas — same coalescing strategy as stream_chunk
  const thinkingPendingRef = useRef<string>('');
  const thinkingFlushRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);

  // Loading step indicator state
  const [loadingSteps, setLoadingSteps] = useState<Array<{ id: string; label: string; status: string }> | null>(null);

  // Provider error band state — array of messages for unified warning band
  const [warnings, setWarnings] = useState<string[]>([]);

  // Clarification prompt — only shown while agent is actively waiting (streaming)
  const providerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitSeenRef = useRef(false);

  // Extract a clean, human-readable message from raw provider errors
  const extractProviderError = useCallback((raw: string): string => {
    // Try to extract the "message" field from JSON error responses
    const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
    let msg = '';
    if (msgMatch?.[1]) {
      msg = msgMatch[1];
    } else {
      // Try pattern: "Provider API error (CODE): ..."
      const prefixMatch = raw.match(/^\w+\s+API\s+error\s*\(\d+\):\s*(.*)/is);
      msg = prefixMatch?.[1] ?? raw;
    }
    // Decode unicode escapes, escaped sequences, and strip non-readable chars
    try { msg = JSON.parse(`"${msg.replace(/"/g, '\\"')}"`); } catch { /* use as-is */ }
    msg = msg
      .replace(/\\n/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\r/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Strip variable retry time suffix so dedup works across retries
    msg = msg.replace(/\s*Please retry in [\d.]+s\.?\s*$/, '');
    return msg;
  }, []);

  // Replace a warning if one with the same tool name (doom loop) exists, else append
  const replaceWarning = useCallback((prev: string[], newMsg: string): string[] => {
    // Detect doom-loop style: "toolName called Nx consecutively" or "[DOOM LOOP DETECTED] toolName"
    const doomMatch = newMsg.match(/(\[DOOM LOOP DETECTED\])?\s*(\S+?)\s*(?:called|repeated)/i);
    if (doomMatch) {
      const toolName = doomMatch[2];
      const idx = prev.findIndex(w => w.includes(toolName) && /(called|repeated)\s+\d+\s*x?/i.test(w));
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = newMsg;
        return copy;
      }
    }
    return prev.includes(newMsg) ? prev : [...prev, newMsg];
  }, []);

  // Sync view with sessionId prop from URL — also restore session history on mount/refresh
  useEffect(() => {
    if (sessionId) {
      if (skipRestoreRef.current) {
        skipRestoreRef.current = false;
        setView('chat');
        return;
      }
      setView('chat');
      setCurrentSessionId(sessionId);
      setShowJumpPill(false);
      prevRealCountRef.current = 0;
      isAtBottomRef.current = false;
      paginationReadyRef.current = false;
      needsInitialScrollRef.current = true;
      lastScrollTopRef.current = 0;
      setInitialScrollDone(false);
      initialScrollDoneRef.current = false;
      paginationAnchorRef.current = null;
      paginationAnchorMessageIdRef.current = null;
      paginationAnchorOffsetRef.current = null;
      titleGeneratedRef.current = false;
      setHasOlderMessages(false);
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
        if (shell.agentMode) setAgentMode(shell.agentMode);
        setCurrentSessionTitle(shell.title);
        if (shell.crewPrivate) {
          const navState = location.state as { fromCrews?: boolean } | null;
          chatReturnToRef.current = navState?.fromCrews ? '/console/crews' : 'crew_tab';
        }
      }).catch(() => { /* full restore follows */ });

      sessions.restore(sessionId, {
        perRole: coreSession ? CORE_SESSION_MESSAGES_PER_ROLE : CHAT_INITIAL_MESSAGES_PER_ROLE,
      }).then(async ({ messages: historyMsgs, session, scopePath, turnFeedback, messagesMeta }) => {
        if (currentSessionIdRef.current !== sessionId) return;
        if (session.parentId) {
          setSessionRestoring(false);
          sessionRestoringRef.current = false;
          isInitialLoadRef.current = false;
          setChildSessionDrawer({
            childSessionId: sessionId,
            label: session.title ?? 'Background work',
            kind: sessionId.startsWith('crew-worker') ? 'crew_worker' : 'sub_agent',
          });
          navigate(`/console/chat/${session.parentId}`, { replace: true });
          return;
        }
        const resolvedScope = scopePath || session.scopePath;
        const mapped = mapHistoryToUiMessages(historyMsgs);
        const shell = buildSessionShellPatch(session);

        let feedbackRows = turnFeedback ?? [];
        if (!feedbackRows.length) {
          try {
            const fb = await sessions.listTurnFeedback(sessionId);
            feedbackRows = fb.feedback;
          } catch { /* best-effort */ }
        }
        const withFeedback = applyTurnFeedbackRows(mapped, feedbackRows);

        setMessages(withFeedback);
        setHasOlderMessages(messagesMeta?.truncated ?? false);
        setIsCrewPrivateSession(shell.crewPrivate);
        setCrewPrivateHost(shell.privateHost);
        setPrivateHostCrewId(shell.privateHostCrewId);
        if (shell.agentMode) setAgentMode(shell.agentMode);
        setCurrentSessionTitle(shell.title);
        if (shell.crewPrivate) {
          const navState = location.state as { fromCrews?: boolean } | null;
          chatReturnToRef.current = navState?.fromCrews ? '/console/crews' : 'crew_tab';
        }
        setParentSessionId(session.parentId ?? null);
        const visible = historyMsgs.filter((m) => m.role !== 'part' && m.role !== 'system');
        const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const persistedUsed = (session as { tokenUsed?: number; tokensUsed?: number }).tokenUsed ?? session.tokensUsed ?? 0;
        const tokenAvail = Number((session as { tokenAvailable?: number; token_available?: number }).tokenAvailable ?? (session as { token_available?: number }).token_available ?? 0);
        if (tokenAvail > 0) setTokenTotal(tokenAvail);
        setTokenUsed(persistedUsed > 0 ? persistedUsed : inputEst + outputEst);
        setCompactionCount((session as { compactionCount?: number }).compactionCount ?? 0);
        setTokenInput(inputEst);
        setTokenOutput(outputEst);
        tokenInputRef.current = inputEst;
        tokenOutputRef.current = outputEst;
        if (resolvedScope) setCwd(resolvedScope);
        loadTodos();
        setSessionRestoring(false);
        sessionRestoringRef.current = false;
        isInitialLoadRef.current = false;
        if (!session.title || session.title === 'New Session' || session.title === 'Child Session') {
          generateTitle(sessionId, visible);
        }

        if (!shell.crewPrivate && !coreSession) {
          void (async () => {
            try {
              let roster = crewList;
              if (!roster.length) {
                roster = await crews.list();
                setCrewList(roster);
              }
              const hydrated = await hydrateCrewDeliverables(sessionId, withFeedback, roster);
              if (hydrated.crewWorkers.length > 0) {
                setCrewWorkers(hydrated.crewWorkers);
                crewMissionSessionIdRef.current = sessionId;
              }
              setMessages(applyTurnFeedbackRows(hydrated.messages, feedbackRows));
              if (isAtBottomRef.current) {
                requestAnimationFrame(() => {
                  const el = messagesContainerRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                });
              }
            } catch { /* best-effort */ }
          })();
        }
      }).catch((err) => {
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

  // Right sidebar state
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [tokenUsed, setTokenUsed] = useState(0);
  const [tokenInput, setTokenInput] = useState(0);
  const [tokenOutput, setTokenOutput] = useState(0);
  const [tokenReserved, setTokenReserved] = useState(0);
  const [tokenStreaming, setTokenStreaming] = useState(0);
  const [tokenInputPrice, setTokenInputPrice] = useState(0);
  const [tokenOutputPrice, setTokenOutputPrice] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(128000);
  const [compactionCount, setCompactionCount] = useState(0);
  const tokenInputRef = useRef(0);
  const tokenOutputRef = useRef(0);
  const tokenReservedRef = useRef(0);

  // Collapsible sidebar sections
  const [contextExpanded, setContextExpanded] = useState(false);
  const [tokenExpanded, setTokenExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [missionExpanded, setMissionExpanded] = useState(true);
  const [crewAddQuery, setCrewAddQuery] = useState('');
  const [crewAddResults, setCrewAddResults] = useState<CatalogSummary[]>([]);
  const [crewAddOpen, setCrewAddOpen] = useState(false);
  const [crewAddLoading, setCrewAddLoading] = useState(false);
  const [contextData, setContextData] = useState('');
  const [rebuildingContext, setRebuildingContext] = useState(false);

  const applyContextPayload = useCallback((d: { context?: string; compaction?: string }) => {
    const parts: string[] = [];
    if (d.compaction?.trim()) parts.push(`[Compaction summaries]\n${d.compaction.trim()}`);
    if (d.context?.trim()) parts.push(`[Conversation]\n${d.context.trim()}`);
    setContextData(parts.length > 0 ? parts.join('\n\n') : '');
  }, []);

  const refreshContext = useCallback(() => {
    if (!currentSessionId) return;
    fetch(`/api/sessions/${currentSessionId}/context`, { credentials: 'include' })
      .then(r => r.json())
      .then(applyContextPayload)
      .catch(() => {});
  }, [currentSessionId, applyContextPayload]);

  const refreshContextRef = useRef(refreshContext);
  useEffect(() => { refreshContextRef.current = refreshContext; }, [refreshContext]);

  const handleRebuildContext = useCallback(async () => {
    if (!currentSessionId || rebuildingContext) return;
    setRebuildingContext(true);
    try {
      const r = await fetch(`/api/sessions/${currentSessionId}/context/rebuild`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) refreshContext();
    } catch { /* ignore */ }
    setRebuildingContext(false);
  }, [currentSessionId, rebuildingContext, refreshContext]);

  // Model/Provider state
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentProviderId, setCurrentProviderId] = useState('');
  const [providerList, setProviderList] = useState<Array<{ id: string; label: string; providerId: string }>>([]);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Crew state (fixed per session)
  const [crewList, setCrewList] = useState<Crew[]>([]);


  // Agent mode — plan is default (especially for Agent-X super-session)
  const [agentMode, setAgentMode] = useState<AgentMode>('plan');

  // Hyperdrive — full autonomous mode
  const [hyperdriveMode, setHyperdriveMode] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const hyperdrivePromptShownRef = useRef(false);   // show disclaimer once per session
  const lastShiftRef = useRef(0);                    // double-Shift detection
  const prevModeBeforeHyperdrive = useRef<AgentMode>('plan'); // restore on exit

  // Hyperdrive shimmer — random interval flash sweep across the chip
  const [hyperdriveShimmer, setHyperdriveShimmer] = useState(false);
  useEffect(() => {
    if (hyperdriveMode) { setHyperdriveShimmer(false); return; }
    const trigger = () => {
      setHyperdriveShimmer(true);
      setTimeout(() => setHyperdriveShimmer(false), 800);
    };
    const nextInterval = () => 3000 + Math.random() * 7000;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { trigger(); schedule(); }, nextInterval()); };
    schedule();
    return () => clearTimeout(timer);
  }, [hyperdriveMode]);  

  // CWD
  const [cwd, setCwd] = useState('');
  const cwdRef = useRef('');

  // Dropdown anchors
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  const [providerMenuAnchor, setProviderMenuAnchor] = useState<null | HTMLElement>(null);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);

  // Send action menu moved to ChatInputBar

  // New session dialog
  // ─── Enhancements: connection health, palette, slash, search, checkpoints ───
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const lastEventAtWrittenRef = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerCallback, setFolderPickerCallback] = useState<((path: string) => void) | null>(null);
  const [folderConsentOpen, setFolderConsentOpen] = useState(false);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const pendingFolderActionRef = useRef<'newSession' | 'changeCwd' | null>(null);

  // Agent gate modals (plan approval, mode escalation, step cap)
  const [modeEscalation, setModeEscalation] = useState<{ tool: string; reason: string } | null>(null);
  const [stepCapPrompt, setStepCapPrompt] = useState<{ currentSteps: number; maxSteps: number } | null>(null);
  const [turnActivity, setTurnActivity] = useState<{ stage: string; step: number; elapsedMs: number } | null>(null);
  const [pendingFeedbackMessageId, setPendingFeedbackMessageId] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const lastTurnFeedbackCandidateRef = useRef<{ messageId: string; elapsedMs: number } | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const turnActiveRef = useRef(false);
  const resendInProgressRef = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const isTimeoutWarning = (msg: string) => /timeout|timed out|aborted due to timeout/i.test(msg);
  const clearTimeoutWarnings = useCallback((prev: string[]) => prev.filter(w => !isTimeoutWarning(w)), []);
  const isAgentRecentlyActive = useCallback((withinMs = 45000) => Date.now() - lastActivityRef.current < withinMs, []);

  const endTurnUi = useCallback(() => {
    turnActiveRef.current = false;
    activeTurnIdRef.current = null;
    resendInProgressRef.current = false;
    setStreaming(false);
    setTurnActivity(null);
    setTokenStreaming(0);
  }, []);

  const beginTurnUi = useCallback(() => {
    turnActiveRef.current = true;
    isInitialLoadRef.current = false;
    setStreaming(true);
    setTurnActivity(null);
    setLoadingSteps(null);
    setPendingFeedbackMessageId(null);
  }, []);

  const voicePendingUserIdRef = useRef<string | null>(null);

  const appendVoiceUserTurn = useCallback((text: string, messageId?: string) => {
    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) return;
    setMessages((prev) => {
      for (let i = Math.max(0, prev.length - 8); i < prev.length; i += 1) {
        const m = prev[i];
        if (m?.role === 'user' && m.content === trimmed) {
          if (m.voiceInput) return prev;
          return prev.map((msg, idx) => (
            idx === i
              ? { ...msg, voiceInput: true, id: messageId ?? msg.id }
              : msg
          ));
        }
      }
      return [
        ...prev,
        { id: messageId ?? crypto.randomUUID(), role: 'user', content: trimmed, streaming: false, voiceInput: true },
      ];
    });
  }, []);

  const handleVoiceUserPending = useCallback(() => {
    if (voicePendingUserIdRef.current) return;
    const id = crypto.randomUUID();
    voicePendingUserIdRef.current = id;
    appendVoiceUserTurn('…', id);
    requestAnimationFrame(() => scrollAfterVoiceUserRef.current());
  }, [appendVoiceUserTurn]);

  const handleVoiceUserDiscarded = useCallback(() => {
    const pendingId = voicePendingUserIdRef.current;
    voicePendingUserIdRef.current = null;
    if (!pendingId) return;
    setMessages((prev) => prev.filter((m) => m.id !== pendingId));
  }, []);

  const beginVoiceAgentTurn = useCallback(() => {
    beginTurnUi();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.streaming) return prev;
      if (last?.role === 'user') {
        return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
      }
      return prev;
    });
  }, [beginTurnUi]);

  const scrollAfterVoiceUserRef = useRef<() => void>(() => {});

  const handleVoiceTranscript = useCallback((text: string, empty: boolean) => {
    if (empty) {
      handleVoiceUserDiscarded();
      return;
    }
    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) {
      handleVoiceUserDiscarded();
      return;
    }
    const pendingId = voicePendingUserIdRef.current;
    voicePendingUserIdRef.current = null;
    if (pendingId) {
      setMessages((prev) => prev.map((m) => (
        m.id === pendingId ? { ...m, content: trimmed, voiceInput: true } : m
      )));
    } else {
      appendVoiceUserTurn(trimmed);
    }
    beginVoiceAgentTurn();
    requestAnimationFrame(() => scrollAfterVoiceUserRef.current());
  }, [appendVoiceUserTurn, beginVoiceAgentTurn, handleVoiceUserDiscarded]);

  const handleVoiceTiming = useCallback((timings: VoiceTurnTimings) => {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const msg = prev[i];
        if (msg?.role !== 'assistant') continue;
        return [...prev.slice(0, i), { ...msg, voiceTimings: timings }, ...prev.slice(i + 1)];
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    voiceCtx?.registerChatSession(currentSessionId);
    return () => voiceCtx?.registerChatSession(null);
  }, [currentSessionId, voiceCtx]);

  useEffect(() => {
    if (!voiceCtx) return;
    voiceCtx.registerInlineVoiceHandler((autoStart) => {
      setComposerMode('voice');
      requestAnimationFrame(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      if (autoStart) setVoiceAutoStart(true);
    });
    voiceCtx.registerVoiceChatBridge({
      onVoiceUserPending: handleVoiceUserPending,
      onVoiceUserDiscarded: handleVoiceUserDiscarded,
      onTranscriptFinal: handleVoiceTranscript,
      onAgentRunning: () => {},
    });
    return () => {
      voiceCtx.registerInlineVoiceHandler(null);
      voiceCtx.registerVoiceChatBridge(null);
    };
  }, [voiceCtx, handleVoiceUserPending, handleVoiceUserDiscarded, handleVoiceTranscript]);
  const [modeSuggestOpen, setModeSuggestOpen] = useState(false);
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
    const msg = messages.find((m) => m.id === messageId);
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
  }, [messages, replaceWarning]);

  useEffect(() => {
    sessionRestoringRef.current = sessionRestoring;
  }, [sessionRestoring]);

  useEffect(() => {
    const candidate = lastTurnFeedbackCandidateRef.current;
    if (!candidate || sessionRestoringRef.current) return;
    const msg = messages.find((m) => m.id === candidate.messageId);
    lastTurnFeedbackCandidateRef.current = null;
    if (!msg || msg.turnFeedback || msg.streaming || msg.isModeChange) return;
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

  // Smart auto-scroll state
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const jumpSuppressScrollTopRef = useRef<number | null>(null);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const loadingOlderRef = useRef(false);
  const paginationAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const paginationAnchorMessageIdRef = useRef<string | null>(null);
  const paginationAnchorOffsetRef = useRef<number | null>(null);
  const paginationCooldownUntilRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const paginationReadyRef = useRef(false);
  const needsInitialScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const [freezeMessageLayout, setFreezeMessageLayout] = useState(false);

  // RAF-batched tool event accumulator (prevents render storm on long-running tasks)
  const toolBatchRef = useRef<TelemetryEvent[]>([]);
  const toolFlushRef = useRef<number | null>(null);
  const prevStreamingRef = useRef(false);

  const scrollMessagesToBottom = useCallback((behavior: 'smooth' | 'instant' = 'instant') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  scrollAfterVoiceUserRef.current = () => scrollMessagesToBottom('smooth');

  const loadOlderMessages = useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId || loadingOlderRef.current || !hasOlderMessages) return;
    if (!paginationReadyRef.current) return;
    if (Date.now() < paginationCooldownUntilRef.current) return;
    const first = messages.find((m) => m.role === 'user' || m.role === 'assistant');
    if (!first?.id) return;
    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    setFreezeMessageLayout(true);
    const el = messagesContainerRef.current;
    if (el) {
      const anchorEl = el.querySelector(`[data-message-id="${first.id}"]`);
      if (anchorEl) {
        paginationAnchorMessageIdRef.current = first.id;
        paginationAnchorOffsetRef.current = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
      } else {
        paginationAnchorMessageIdRef.current = null;
        paginationAnchorOffsetRef.current = null;
        paginationAnchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
      }
    }
    paginationCooldownUntilRef.current = Date.now() + 1000;
    try {
      const page = await sessions.getMessagesPage(sessionId, { limit: 20, before: first.id });
      const older = mapHistoryToUiMessages(page.messages);
      if (older.length === 0) {
        setHasOlderMessages(false);
        paginationAnchorMessageIdRef.current = null;
        paginationAnchorOffsetRef.current = null;
        paginationAnchorRef.current = null;
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !seen.has(m.id));
        return prepend.length ? [...prepend, ...prev] : prev;
      });
      setHasOlderMessages(page.hasMore);
    } catch {
      paginationAnchorMessageIdRef.current = null;
      paginationAnchorOffsetRef.current = null;
      paginationAnchorRef.current = null;
      /* best-effort */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
      window.setTimeout(() => setFreezeMessageLayout(false), 120);
    }
  }, [hasOlderMessages, messages]);

  // ─── Smart auto-scroll: track user scroll position ───
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const prevTop = lastScrollTopRef.current;
      const scrolledUp = el.scrollTop < prevTop - 4;
      lastScrollTopRef.current = el.scrollTop;

      if (
        paginationReadyRef.current
        && scrolledUp
        && Date.now() >= paginationCooldownUntilRef.current
        && el.scrollTop < 64
        && hasOlderMessages
        && !loadingOlderRef.current
      ) {
        void loadOlderMessages();
      }
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        jumpSuppressScrollTopRef.current = null;
        setShowJumpPill(false);
        return;
      }
      if (jumpSuppressScrollTopRef.current !== null) {
        const scrolledUpEnough = el.scrollTop < jumpSuppressScrollTopRef.current - 100;
        if (!scrolledUpEnough) {
          setShowJumpPill(false);
          return;
        }
        jumpSuppressScrollTopRef.current = null;
      }
      if (distanceFromBottom > 120) {
        setShowJumpPill(true);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view, hasOlderMessages, loadOlderMessages]);

  // Auto-scroll to bottom on session load/restore
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  useEffect(() => {
    initialScrollDoneRef.current = initialScrollDone;
  }, [initialScrollDone]);

  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const anchorId = paginationAnchorMessageIdRef.current;
    const anchorOffset = paginationAnchorOffsetRef.current;
    if (anchorId && anchorOffset != null) {
      const anchorEl = el.querySelector(`[data-message-id="${anchorId}"]`);
      if (anchorEl) {
        const nextOffset = anchorEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += nextOffset - anchorOffset;
      }
      paginationAnchorMessageIdRef.current = null;
      paginationAnchorOffsetRef.current = null;
      paginationCooldownUntilRef.current = Date.now() + 400;
      return;
    }

    const anchor = paginationAnchorRef.current;
    if (anchor) {
      paginationAnchorRef.current = null;
      const delta = el.scrollHeight - anchor.scrollHeight;
      el.scrollTop = anchor.scrollTop + delta;
      paginationCooldownUntilRef.current = Date.now() + 400;
      return;
    }

    if (needsInitialScrollRef.current && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (atBottom) {
        needsInitialScrollRef.current = false;
        initialScrollDoneRef.current = true;
        setInitialScrollDone(true);
        paginationReadyRef.current = true;
        isAtBottomRef.current = true;
        lastScrollTopRef.current = el.scrollTop;
        paginationCooldownUntilRef.current = Date.now() + 600;
      }
    }
  }, [messages]);

  useEffect(() => {
    if (!needsInitialScrollRef.current || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const el = messagesContainerRef.current;
      if (!el || !needsInitialScrollRef.current) return;
      scrollMessagesToBottom('instant');
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (atBottom) {
        needsInitialScrollRef.current = false;
        initialScrollDoneRef.current = true;
        setInitialScrollDone(true);
        paginationReadyRef.current = true;
        isAtBottomRef.current = true;
        lastScrollTopRef.current = el.scrollTop;
        paginationCooldownUntilRef.current = Date.now() + 600;
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [messages.length, scrollMessagesToBottom]);

  // Auto-scroll only when user is at bottom — also on streaming content updates
  const prevRealCountRef = useRef(0);
  useEffect(() => {
    const realMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const countChanged = realMsgs.length > prevRealCountRef.current;
    if (countChanged) prevRealCountRef.current = realMsgs.length;
    if (!countChanged && !streaming) return;
    if (isAtBottomRef.current) {
      scrollMessagesToBottom(countChanged ? 'smooth' : 'instant');
    } else if (countChanged) {
      setShowJumpPill(true);
    }
  }, [messages, streaming, scrollMessagesToBottom]);

  // Pin scroll to bottom when a turn finishes — content-visibility/layout reflow can jump upward
  useLayoutEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming || !isAtBottomRef.current) return;
    scrollMessagesToBottom('instant');
    requestAnimationFrame(() => scrollMessagesToBottom('instant'));
  }, [streaming, messages, scrollMessagesToBottom]);

  // Load sessions
  const loadSessions = useCallback(() => {
    sessions.list().then((list) => setSessionList(list.filter((s) => !s.parentId))).catch(() => {});
  }, []);

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
  }, []);

  const titleGeneratedRef = useRef(false);
  const generateTitle = async (sid: string, msgs: any[]) => {
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
  };

  // Load sessions on mount and when view becomes 'sessions'
  useEffect(() => {
    if (view === 'sessions') loadSessions();
  }, [view, loadSessions]);

  // Load todos
  const loadTodos = useCallback(() => {
    todos.list().then(setTodoItems).catch(() => {});
  }, []);

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
    sessionSettings.get().then((s) => { if (!sessionId && (s.mode === 'agent' || s.mode === 'plan')) setAgentMode(s.mode); }).catch(() => {});
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

  // Update tokenTotal when model's context window is known
  useEffect(() => {
    if (!currentModel || modelList.length === 0) return;
    const match = modelList.find(m => m.id === currentModel);
    if (match?.contextWindow) {
      setTokenTotal(match.contextWindow);
      const reserve = Math.min(20000, Math.round(match.contextWindow * 0.15));
      setTokenReserved(reserve);
      tokenReservedRef.current = reserve;
    }
  }, [currentModel, modelList]);

  // Helper to immutably update the last assistant message (avoids React mutation anti-pattern).
  const updateLastMessage = (msgs: UIMessage[], updates: Partial<UIMessage>): UIMessage[] => {
    if (msgs.length === 0) return msgs;
    const last = msgs[msgs.length - 1];
    if (last?.role !== 'assistant') return msgs;
    return [...msgs.slice(0, -1), { ...last, ...updates }];
  };

  const attachChildSessionToAssistant = (
    prev: UIMessage[],
    childSessionId: string,
    label: string,
    kind: 'sub_agent' | 'crew_worker',
    task = '',
  ): UIMessage[] => {
    if (kind === 'crew_worker') return prev;
    const last = prev[prev.length - 1];
    if (last?.role !== 'assistant') return prev;
    const existing = last.subAgents ?? [];
    if (existing.some((a) => a.id === childSessionId)) return prev;
    const upgraded = existing.map((a) =>
      (a.id === 'subagent' || a.id === childSessionId)
        ? { ...a, id: childSessionId, name: label, kind, task: task || a.task, status: 'running' as const }
        : a,
    );
    const hasMatch = upgraded.some((a) => a.id === childSessionId);
    const subAgents = hasMatch
      ? upgraded
      : [...existing, { id: childSessionId, name: label, task, status: 'running' as const, kind }];
    const parts = (last.parts ?? []).map((p) =>
      p.type === 'subagent' && (p.agent?.id === 'subagent' || p.agent?.id === childSessionId)
        ? { ...p, id: childSessionId, agent: { ...p.agent!, id: childSessionId, name: label, kind, task: task || p.agent!.task, status: 'running' as const } }
        : p,
    );
    const hasPart = parts.some((p) => p.type === 'subagent' && p.agent?.id === childSessionId);
    const nextParts = hasPart
      ? parts
      : [...(last.parts ?? []), { type: 'subagent' as const, id: childSessionId, agent: { id: childSessionId, name: label, task, status: 'running' as const, kind } }];
    return updateLastMessage(prev, { subAgents, parts: nextParts });
  };

  // Connect SSE for streaming events
  useEffect(() => {
    const stopTurnIndicator = () => {
      turnActiveRef.current = false;
      activeTurnIdRef.current = null;
      resendInProgressRef.current = false;
      setStreaming(false);
      setTurnActivity(null);
      setTokenStreaming(0);
    };

    // Pure function to apply a single tool event to messages state (used by RAF batch)
    const applyToolEvent = (prev: UIMessage[], ev: TelemetryEvent): UIMessage[] => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant') return prev;
      switch (ev.type) {
        case 'tool_executing': {
          const toolName = (ev.tool as string) ?? 'unknown';
          const desc = (ev.description as string) ?? '';
          const eventArgs = (ev.args as Record<string, unknown> | string | undefined) ?? desc;
          const existingParts = last.parts || [];
          let callId = (ev.callId as string) ?? '';
          if (!callId) {
            const running = existingParts.find(
              (p) => p.type === 'tool' && p.tool?.name === toolName && p.tool.status === 'running',
            );
            callId = running?.tool?.id
              ?? `tool-${toolName}-${existingParts.filter((p) => p.type === 'tool' && p.tool?.name === toolName).length}`;
          }
          if (toolName === 'delegate_to_subagent') {
            if ((last.subAgents ?? []).some((a) => a.id === callId)) return prev;
            const sa: SubAgent = { id: callId, name: 'Sub-Agent', task: desc, status: 'running' };
            const saPart: PartEntry = { type: 'subagent', id: callId, agent: sa };
            return updateLastMessage(prev, {
              subAgents: [...(last.subAgents ?? []), sa],
              parts: [...(last.parts || []), saPart],
            });
          }
          if (existingParts.some((p) => p.type === 'tool' && p.tool?.id === callId)) return prev;
          if (!last.streaming && existingParts.some((p) => p.type === 'tool' && p.tool?.name === toolName && p.tool.status === 'done')) {
            return prev;
          }
          const tc: ToolCall = { id: callId, name: toolName, args: eventArgs, status: 'running' };
          const toolPart: PartEntry = { type: 'tool', id: callId, tool: tc };
          const priorToolCalls = (last.toolCalls ?? []).filter((t) => t.id !== callId);
          return updateLastMessage(prev, { toolCalls: [...priorToolCalls, tc], parts: [...existingParts, toolPart] });
        }
        case 'tool_output': {
          const outputCallId = (ev.callId as string) ?? '';
          const outputText = (ev.output as string) ?? '';
          if (!outputCallId || !outputText) return prev;
          const newParts = (last.parts || []).map((p: PartEntry) =>
            p.type === 'tool' && p.tool?.id === outputCallId && p.tool?.status === 'running'
              ? { ...p, tool: { ...p.tool, streamOutput: (p.tool.streamOutput || '') + outputText } } : p);
          const newToolCalls = (last.toolCalls || []).map((t: ToolCall) =>
            t.id === outputCallId && t.status === 'running'
              ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t);
          const matched = newToolCalls.find((t) => t.id === outputCallId);
          let partsWithSearch = newParts;
          if (matched?.name === 'deep_web_search') {
            const progress = parseDeepSearchProgressLine(outputText.trim())
              ?? parseDeepSearchProgressFromStream(matched.streamOutput);
            if (progress) {
              partsWithSearch = upsertDeepSearchPartEntry(newParts, {
                toolCallId: outputCallId,
                progress,
                running: true,
              });
            }
          }
          return updateLastMessage(prev, { toolCalls: newToolCalls, parts: partsWithSearch });
        }
        case 'tool_complete': {
          const toolName = (ev.tool as string) ?? '';
          const elapsed = (ev.elapsed as number) ?? 0;
          const callId = (ev.callId as string) ?? '';
          const result = (ev as any).result ?? (ev as any).output as string ?? '';
          const resultStr = typeof result === 'string' ? result
            : (result && typeof result === 'object' ? ((result as any).output || (result as any).message || JSON.stringify(result)) : '');
          if (toolName === 'delegate_to_subagent' && last.subAgents) {
            const newSubAgents = last.subAgents.map((a: SubAgent) =>
              a.status !== 'running' ? a : { ...a, status: 'done' as const, result: resultStr });
            const newParts = (last.parts || []).map((p: PartEntry) =>
              p.type === 'subagent' && p.agent?.id === callId
                ? { ...p, agent: { ...p.agent!, status: 'done' as const, result: resultStr } } : p);
            return updateLastMessage(prev, { subAgents: newSubAgents, parts: newParts });
          }
          const newToolCalls = (last.toolCalls || []).map((t: ToolCall) => {
            if (callId && t.id !== callId) return t;
            if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
            return { ...t, status: 'done' as const, result: resultStr, elapsed };
          });
          const newParts = (last.parts || []).map((p: PartEntry) => {
            if (p.type === 'tool' && p.tool) {
              if (callId && p.tool.id !== callId) return p;
              if (!callId && (p.tool.name !== toolName || p.tool.status !== 'running')) return p;
              return { ...p, tool: { ...p.tool, status: 'done' as const, result: resultStr, elapsed } };
            }
            return p;
          });
          const resObj = typeof (ev as any).result === 'object' && (ev as any).result !== null ? (ev as any).result as Record<string, unknown> : null;
          const meta = ((ev as any).metadata ?? resObj?.metadata) as Record<string, unknown> | undefined;
          if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') setToolEnablePrompt({ toolId: toolName, toolName });
          let finalParts = newParts.map((p) => (
            p.type === 'tool' && p.tool
              ? { ...p, tool: applyToolCompleteMetadata(p.tool, meta, callId, toolName) }
              : p
          ));
          const toolCallsWithMeta = newToolCalls.map((t) => applyToolCompleteMetadata(t, meta, callId, toolName));
          if (toolName === 'deep_web_search') {
            const resolvedId = callId || finalParts.find((p) => p.type === 'tool' && p.tool?.name === 'deep_web_search')?.tool?.id;
            if (resolvedId) {
              const bundle = deepSearchBundleFromMetadata(meta);
              const progress = (meta?.deepSearchProgress as import('@agentx/shared/browser').DeepSearchProgress | undefined);
              finalParts = upsertDeepSearchPartEntry(finalParts, {
                toolCallId: resolvedId,
                bundle,
                progress,
                running: !bundle,
              });
            }
          }
          return updateLastMessage(prev, {
            toolCalls: toolCallsWithMeta,
            parts: finalParts,
          });
        }
        default:
          return prev;
      }
    };

    const handleEvent = (ev: TelemetryEvent) => {
      if (!eventBelongsToViewSession(ev, viewSessionIdRef.current)) return;

      // Reset activity timer on every event from the agent
      const now = Date.now();
      lastActivityRef.current = now;
      // Throttle the state write — lastEventAt only feeds the connection-health
      // dot, so refreshing it at most every 2s avoids re-rendering the whole
      // panel on every telemetry event.
      if (now - lastEventAtWrittenRef.current > 2000) {
        lastEventAtWrittenRef.current = now;
        setLastEventAt(now);
      }

      if (ev.type === 'message_sent') {
        if (isInitialLoadRef.current) return;
        const msg = ev.message as { id?: string; content?: string; role?: string } | undefined;
        const text = typeof msg?.content === 'string' ? msg.content.trim() : '';
        if (!text || msg?.role !== 'user') return;
        // Text chat already added the user bubble locally — only sync voice-only turns.
        setMessages((prev) => {
          if (prev.some((m) => m.role === 'user' && m.content === text)) return prev;
          return [
            ...prev,
            {
              id: msg?.id ?? crypto.randomUUID(),
              role: 'user',
              content: text,
              streaming: false,
              voiceInput: true,
            },
          ];
        });
        return;
      }

      // RAF-batch high-frequency tool events to prevent render storm on long-running tasks
      if (ev.type === 'tool_executing' || ev.type === 'tool_output' || ev.type === 'tool_complete') {
        // Ignore stale tool events replayed from telemetry buffer on page load
        if (isInitialLoadRef.current) return;
        toolBatchRef.current.push(ev);
        if (toolFlushRef.current === null) {
          toolFlushRef.current = requestAnimationFrame(() => {
            toolFlushRef.current = null;
            const batch = toolBatchRef.current;
            toolBatchRef.current = [];
            if (batch.length === 0) return;
            setMessages(prev => {
              let current = prev;
              for (const e of batch) {
                current = applyToolEvent(current, e);
              }
              const last = current[current.length - 1];
              if (last?.parts?.length) {
                const dedupedParts = dedupeToolParts(last.parts as MessagePart[]);
                if (dedupedParts !== last.parts) {
                  current = updateLastMessage(current, { parts: dedupedParts as PartEntry[] });
                }
              }
              return current;
            });
          });
        }
        return;
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];

        switch (ev.type) {
          case 'loading_start': {
            // Ignore stale loading_start events replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) { return prev; }
            if (!turnActiveRef.current) return prev;
            streamChunkPendingRef.current = null;
            if (streamChunkRAFRef.current !== null) {
              clearTimeout(streamChunkRAFRef.current);
              streamChunkRAFRef.current = null;
            }
            thinkingPendingRef.current = '';
            if (thinkingFlushRef.current !== null) {
              clearTimeout(thinkingFlushRef.current);
              thinkingFlushRef.current = null;
            }
            setLoadingSteps(null);
            const loadingStage = (ev as { stage?: string }).stage;
            // Crew missions / private chats stream crew-attributed messages — no Agent-X placeholder
            if (loadingStage === 'crew_mission' || loadingStage === 'crew_private') {
              setStreaming(true);
              if (loadingStage === 'crew_mission') return prev;
              if (last?.role === 'user' && isCrewPrivateRef.current && crewPrivateHostRef.current) {
                const host = crewPrivateHostRef.current;
                return [...prev, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: '',
                  streaming: true,
                  crew: { crewId: '', name: host.name, callsign: host.callsign },
                }];
              }
              if (lastMessageIsQuestionnaireCard(prev) && isCrewPrivateRef.current && last?.crew) {
                return [...prev, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: '',
                  streaming: true,
                  crew: last.crew,
                }];
              }
              return prev;
            }
            if (lastMessageIsQuestionnaireCard(prev)) {
              setStreaming(true);
              return [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                streaming: true,
                ...(last?.crew ? { crew: last.crew } : {}),
              }];
            }
            // Only create a placeholder when a user message just arrived (new turn).
            // If the last message is a completed assistant (race with handleSend),
            // let stream_chunk or message_received handle the placeholder instead.
            if (last?.role === 'user') {
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
            }
            if (last?.role === 'assistant' && (last.streaming || resendInProgressRef.current)) {
              setStreaming(true);
              return prev;
            }
            if (!last) {
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
            }
            setStreaming(true);
            return prev;
          }

          case 'loading_step_update':
            setLoadingSteps((prevSteps) => {
              const step = { id: ev.stepId as string, label: ev.label as string, status: ev.status as string };
              if (!prevSteps) return [step];
              const exists = prevSteps.some(s => s.id === step.id);
              if (!exists) return [...prevSteps, step];
              return prevSteps.map((s) =>
                s.id === ev.stepId ? { ...s, status: ev.status as string } : s,
              );
            });
            return prev;

          case 'stream_chunk': {
            // Ignore stale stream chunks replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) return prev;
            if (!turnActiveRef.current) return prev;
            setStreaming(true);
            const rawDelta = (ev.content as string) ?? '';
            if (/Calling:|✅ Result:|\[STEP \d+\]/.test(rawDelta)) return prev;
            const rawFull = (ev.fullContent as string) ?? '';
            if (!rawFull && !rawDelta) return prev;
            if (last?.role === 'assistant' && lastMessageIsQuestionnaireCard(prev)) {
              const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
              return [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: rawFull || rawDelta,
                streaming: true,
                parts: [textPart],
                ...(last.crew ? { crew: last.crew } : {}),
              }];
            }
            if (last?.role === 'assistant') {
              streamChunkPendingRef.current = rawFull || null;
              if (streamChunkRAFRef.current === null) {
                // ~12 fps flush: markdown re-parses the full message on every
                // update, so a modest interval slashes CPU vs per-frame flushes
                // with no perceptible loss of streaming smoothness.
                streamChunkRAFRef.current = window.setTimeout(() => {
                  streamChunkRAFRef.current = null;
                  const fullContent = streamChunkPendingRef.current ?? '';
                  streamChunkPendingRef.current = null;
                  if (!fullContent) return;
                  setMessages(p => {
                    const l = p[p.length - 1];
                    if (l?.role !== 'assistant') return p;
                    const parts = l.parts || [];
                    const lastPart = parts[parts.length - 1];
                    const prefixEnd = lastPart?.type === 'text' ? parts.length - 1 : parts.length;
                    let prefixLen = 0;
                    for (let i = 0; i < prefixEnd; i++) {
                      const part = parts[i];
                      if (part?.type === 'text' && part.content) prefixLen += part.content.length;
                    }
                    const segmentText = fullContent.slice(prefixLen);
                    if (lastPart?.type === 'text') {
                      const updatedParts = [...parts.slice(0, -1), { ...lastPart, content: segmentText }];
                      return updateLastMessage(p, { content: fullContent, parts: updatedParts, streaming: true });
                    }
                    const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: segmentText };
                    return updateLastMessage(p, { content: fullContent, parts: [...parts, textPart], streaming: true });
                  });
                  const streamingEst = Math.ceil(fullContent.length / 4);
                  setTokenStreaming(streamingEst);
                  setTokenUsed(tokenInputRef.current + tokenOutputRef.current + streamingEst + tokenReservedRef.current);
                }, 80);
              }
              return prev;
            }
            setStreaming(true);
            const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
            return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: rawFull || rawDelta, streaming: true, parts: [textPart] }];
          }

          case 'loading_end':
            setLoadingSteps(null);
            setCrewWorkers((cw) => {
              if (cw.length > 0 && cw.every((x) => x.status === 'done' || x.status === 'error')) {
                setCrewMissionActive(false);
              }
              return cw;
            });
            // Keep streaming true until message_received — background work may still be running
            return prev;

          case 'message_received': {
            // Ignore stale message_received events replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) return prev;
            const isUpdate = (ev as { isUpdate?: boolean }).isUpdate === true;
            const msg = ev.message as {
              id?: string;
              content?: string;
              role?: string;
              parts?: PartEntry[];
              toolCalls?: ToolCall[];
              crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
              tokenCount?: number;
            } | undefined;
            const crew = msg?.crew;
            const msgId = msg?.id || crypto.randomUUID();
            const hasQuestionnaire = msg?.parts?.some((p) => p.type === 'questionnaire');
            const hasCrewPicker = msg?.parts?.some((p) => p.type === 'crew_roster_picker');
            const questionnairePending = hasQuestionnaire
              && msg?.parts?.some((p) => p.type === 'questionnaire' && p.questionnaire?.status === 'pending');
            const crewPickerPending = hasCrewPicker
              && msg?.parts?.some((p) => p.type === 'crew_roster_picker' && p.crewRosterPicker?.status === 'pending');
            const interactionPending = questionnairePending || crewPickerPending;
            const turnContinues = isUpdate || interactionPending;

            if (!turnContinues) {
              stopTurnIndicator();
              if (msg?.role === 'assistant') {
                lastTurnFeedbackCandidateRef.current = {
                  messageId: msgId,
                  elapsedMs: (ev as { elapsed?: number }).elapsed ?? turnActivity?.elapsedMs ?? 0,
                };
              }
            } else {
              setTokenStreaming(0);
            }

            if (msgId && prev.some((m) => m.id === msgId)) {
              const idx = prev.findIndex((m) => m.id === msgId);
              if (idx >= 0 && msg) {
                if (isUpdate && !interactionPending) {
                  setStreaming(true);
                } else if (interactionPending) {
                  setStreaming(false);
                } else {
                  setStreaming(false);
                }
                const text = repairStreamTextGlitches(stripToolNoise(msg.content ?? ''));
                const mergedParts = reconcileStreamingMessageParts(
                  mergeIncomingMessageParts(prev[idx]!.parts, msg.parts) ?? prev[idx]!.parts,
                  prev[idx]!.toolCalls ?? msg.toolCalls,
                  msg.parts,
                );
                const updated: UIMessage = {
                  ...prev[idx]!,
                  content: text || prev[idx]!.content,
                  parts: mergedParts,
                  streaming: false,
                  ...(crew ? { crew } : {}),
                };
                return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
              }
            }

            if (msg?.role === 'user' && msg.content?.trim()) {
              // User turns are added locally on send; engine emits message_sent, not message_received.
              setStreaming(false);
              return prev;
            }

            if (!msg || msg.role === 'system') return prev;
            const text = repairStreamTextGlitches(stripToolNoise(msg.content ?? ''));
            if (msg.role === 'assistant' && (hasQuestionnaire || hasCrewPicker)) {
              setStreaming(interactionPending ? false : true);
              const base = stripTrailingStreamPreamble(prev);
              return [...base, {
                id: msgId,
                role: 'assistant' as const,
                content: '',
                streaming: false,
                parts: msg.parts,
                timestamp: new Date().toISOString(),
                ...(crew ? { crew } : {}),
              } as UIMessage];
            }

            setStreaming(false);
            if (last?.role === 'assistant') {
              const incomingCrewId = crew?.crewId;
              const lastCrewId = last.crew?.crewId;
              const crewPrivateMerge = isCrewPrivateRef.current && last.streaming;
              const sameSpeaker = crewPrivateMerge
                || (incomingCrewId
                  ? incomingCrewId === lastCrewId
                  : !lastCrewId);
              const shouldMerge = sameSpeaker && (last.streaming || (!text && !!last.content));
              if (shouldMerge) {
                const mergedParts = reconcileStreamingMessageParts(
                  (last.parts && last.parts.length > 0) ? last.parts : msg.parts,
                  last.toolCalls?.length ? last.toolCalls : msg.toolCalls,
                  msg.parts,
                );
                return updateLastMessage(prev, {
                  id: msg.id || last.id,
                  content: text || stripToolNoise(last.content || ''),
                  parts: mergedParts,
                  toolCalls: last.toolCalls?.length ? last.toolCalls : msg.toolCalls,
                  streaming: false,
                  ...(crew ? { crew } : {}),
                });
              }
            }
            if (msg.role === 'assistant' && (text || msg.parts?.length)) {
              const msgId = msg.id || crypto.randomUUID();
              if (prev.some((m) => m.id === msgId)) return prev;
              const parts = msg.parts || [{ type: 'text' as const, id: crypto.randomUUID(), content: text }];
              return [...prev, { id: msgId, role: 'assistant' as const, content: text, streaming: false, parts, ...(crew ? { crew } : {}) } as UIMessage];
            }
            return prev;
          }

          case 'permission_required':
            // Ignore stale permission prompts replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) { return prev; }
            setPendingPermissionCount((prev) => prev + 1);
            setPermissionPrompt({
              requestId: (ev.requestId as string) ?? `${ev.tool}-${Date.now()}`,
              tool: (ev.tool as string) ?? 'unknown',
              path: (ev.path as string) ?? '',
              riskLevel: (ev.riskLevel as string) ?? 'medium',
              integrationPreview: ev.integrationPreview as IntegrationActionPreview | undefined,
              forAutomation: ev.forAutomation === true,
            });
            return prev;

          case 'token_usage': {
            const cw = ev.contextWindow as number | undefined;
            if (cw != null && cw > 0) setTokenTotal(cw);
            const inp = ev.inputTokens as number | undefined;
            const out = ev.outputTokens as number | undefined;
            const reserved = ev.reservedTokens as number | undefined;
            const streaming = ev.streamingTokens as number | undefined;
            if (inp != null) {
              setTokenInput(inp);
              tokenInputRef.current = inp;
            }
            if (out != null) {
              setTokenOutput(out);
              tokenOutputRef.current = out;
            }
            if (reserved != null) {
              setTokenReserved(reserved);
              tokenReservedRef.current = reserved;
            }
            if (streaming != null) setTokenStreaming(streaming);
            const used = ev.totalTokens as number | undefined;
            if (used != null) setTokenUsed(used);
            const ip = ev.inputPrice as number | undefined;
            if (ip !== undefined) setTokenInputPrice(ip);
            const op = ev.outputPrice as number | undefined;
            if (op !== undefined) setTokenOutputPrice(op);
            if (last?.role !== 'assistant') return prev;
            const turn = ev.turnTokens as number | undefined;
            const cost = ev.costUsd as number | undefined;
            const updates: Partial<UIMessage> = {};
            if (turn != null) updates.turnTokens = turn;
            if (cost != null) updates.turnCostUsd = cost;
            return Object.keys(updates).length > 0 ? updateLastMessage(prev, updates) : prev;
          }

          case 'command_action': {
            const action = ev.action as string | undefined;
            if (action === 'model_switched') {
              const cw = ev.contextWindow as number | undefined;
              if (cw != null && cw > 0) setTokenTotal(cw);
            }
            return prev;
          }

          case 'compaction_complete':
            setCompactionCount(c => c + 1);
            refreshContextRef.current();
            return prev;

          case 'reasoning_delta':
          case 'thinking_delta': {
            if (last?.role !== 'assistant') return prev;
            const delta = (ev.content as string) ?? (ev.text as string) ?? '';
            // Coalesce reasoning tokens — flushing per-delta causes a render
            // storm on reasoning-heavy models.
            thinkingPendingRef.current += delta;
            if (thinkingFlushRef.current === null) {
              thinkingFlushRef.current = window.setTimeout(() => {
                thinkingFlushRef.current = null;
                const pending = thinkingPendingRef.current;
                thinkingPendingRef.current = '';
                if (!pending) return;
                setMessages(p => {
                  const l = p[p.length - 1];
                  if (l?.role !== 'assistant') return p;
                  return updateLastMessage(p, {
                    thinking: (l.thinking ?? '') + pending,
                    thinkingStartedAt: l.thinkingStartedAt ?? Date.now(),
                  });
                });
              }, 120);
            }
            return prev;
          }

          case 'reasoning_end':
          case 'thinking_end':
            return last?.role === 'assistant' && last.thinking ? updateLastMessage(prev, { thinkingDoneAt: Date.now() }) : prev;

          case 'decision_made': {
            // Show decision as thinking phase on the streaming assistant message
            if (last?.role !== 'assistant' || !last.streaming) return prev;
            const path = (ev.executionPath as string) ?? '';
            const cls = (ev.messageClass as string) ?? '';
            return updateLastMessage(prev, { thinking: `${cls} → ${path}` });
          }

          case 'provider_error': {
            const providerMsg = (ev.message as string) ?? 'Provider error';
            const msg = extractProviderError(providerMsg);
            // Rate-limit errors suppress all subsequent warnings for this turn
            if (/rate.?limit|429|too many requests|quota/i.test(providerMsg)) {
              rateLimitSeenRef.current = true;
            }
            setWarnings(prev => replaceWarning(prev, msg));
            if (providerErrorTimerRef.current) clearTimeout(providerErrorTimerRef.current);
            setStreaming(false);
            if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
              return prev.slice(0, -1);
            }
            if (last?.role !== 'assistant') return prev;
            return updateLastMessage(prev, { streaming: false });
          }

          case 'clarification_required':
            setStreaming(false);
            return prev;

          case 'stream_clear':
            return stripTrailingStreamPreamble(prev);

          case 'error': {
            // Suppress cascaded errors after a rate-limit — only show the first warning
            if (rateLimitSeenRef.current) {
              setStreaming(false);
              return prev;
            }
            const errorText = (ev.message as string) ?? (ev.error as string) ?? 'Unknown error';
            // Ignore stale timeout errors while the agent is still actively working
            if (isTimeoutWarning(errorText) && isAgentRecentlyActive()) {
              return prev;
            }
            // Route to warning band — errors should not pollute the chat bubble
            setWarnings(prev => replaceWarning(prev, errorText));
            setStreaming(false);
            if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
              return prev.slice(0, -1);
            }
            if (last?.role !== 'assistant') return prev;
            return updateLastMessage(prev, { streaming: false });
          }

          case 'plan_mode_entered':
            if (prev.length === 0) return prev; // skip default mode on fresh session
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Agent', to: 'Plan' },
            }];

          case 'plan_mode_exited':
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Plan', to: 'Agent' },
            }];

          case 'plan_mode_violation': {
            const rolledBack = (ev as { rolledBack?: boolean }).rolledBack;
            const count = ((ev as { violations?: unknown[] }).violations ?? []).length;
            setWarnings(prev => replaceWarning(prev, rolledBack
              ? `Plan mode violation: ${count} write operation(s) detected — session rolled back to checkpoint.`
              : `Plan mode violation: ${count} write operation(s) detected.`));
            return prev;
          }

          case 'mode_restricted':
            // Do not auto-switch — ModeEscalationModal handles user choice
            return prev;

          case 'crew_suggestion':
          case 'crew_suggestion_required': {
            if (isInitialLoadRef.current) return prev;
            if (isCrewPrivateRef.current || crewSuggestionHandledRef.current) return prev;
            const evaluation = (ev as { evaluation?: CrewSuggestionEvaluation }).evaluation;
            const message = (ev as { message?: string }).message;
            if (!evaluation || !message || !shouldOfferCrewRosterPicker(evaluation)) return prev;
            if (ev.type === 'crew_suggestion_required') setStreaming(false);
            crewSuggestionHandledRef.current = true;
            void attachCrewRosterPickerRef.current(message, evaluation);
            return prev;
          }

          case 'mode_escalation_required': {
            if (isCrewPrivateRef.current) return prev;
            const tool = (ev as { tool?: string }).tool ?? 'tool';
            const reason = (ev as { reason?: string }).reason ?? 'Plan mode blocks this operation.';
            setModeEscalation({ tool, reason });
            return prev;
          }

          case 'mode_escalation_accepted':
            if (isCrewPrivateRef.current) return prev;
            setAgentMode('agent');
            sessionSettings.setMode('agent').catch(() => {});
            setModeEscalation(null);
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Plan', to: 'Agent' },
            }];

          case 'mode_escalation_declined':
            setModeEscalation(null);
            setStreaming(false);
            return prev;

          case 'step_cap_reached': {
            const currentSteps = (ev as { currentSteps?: number }).currentSteps ?? 25;
            const maxSteps = (ev as { maxSteps?: number }).maxSteps ?? 25;
            setStepCapPrompt({ currentSteps, maxSteps });
            return prev;
          }

          case 'turn_heartbeat': {
            if (!turnActiveRef.current) return prev;
            setTurnActivity({
              stage: (ev as { stage?: string }).stage ?? 'working',
              step: (ev as { step?: number }).step ?? 0,
              elapsedMs: (ev as { elapsedMs?: number }).elapsedMs ?? 0,
            });
            setStreaming(true);
            setWarnings(clearTimeoutWarnings);
            return prev;
          }

          case 'turn_state': {
            const phase = (ev as { phase?: string }).phase;
            if (phase === 'running') {
              if (turnActiveRef.current) setStreaming(true);
            } else if (phase === 'awaiting_permission' || phase === 'awaiting_plan'
              || phase === 'awaiting_mode' || phase === 'awaiting_step_cap') {
              setStreaming(false);
            } else if (phase === 'done' || phase === 'cancelled' || phase === 'idle') {
              stopTurnIndicator();
              setPermissionPrompt(null);
              setPendingPermissionCount(0);
            }
            return prev;
          }

          case 'task_aborted':
            setPermissionPrompt(null);
            setPendingPermissionCount(0);
            stopTurnIndicator();
            return prev;

          case 'operation_file_edited':
          case 'operation_file_created':
          case 'operation_file_read':
          case 'operation_search_glob':
          case 'operation_search_grep':
          case 'operation_list_files':
          case 'operation_command_executed':
            return applyOperationEventToAssistant(prev, ev as Record<string, unknown> & { type: string });

          case 'agent_thinking':
          case 'step_indicator':
            return prev;

          case 'hyperdrive_entered':
            setAgentMode('agent');
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: (ev as any).wasPlan ? 'Plan' : 'Agent', to: 'Hyperdrive' },
            }];

          case 'hyperdrive_exited':
            setAgentMode((ev as any).mode);
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Hyperdrive', to: (ev as any).wasPlan ? 'Plan' : 'Agent' },
            }];

          case 'crew_mission_start': {
            const sid = currentSessionIdRef.current;
            if (!sid) return prev;
            crewMissionSessionIdRef.current = sid;
            setCrewMissionActive(true);
            setCrewWorkers([]);
            setCrewInterMessages([]);
            setCrewMissionId((ev as unknown as { missionId?: string }).missionId ?? null);
            return prev;
          }

          case 'crew_mission_complete':
            if (!isCrewEventForCurrentSession()) return prev;
            setCrewMissionActive(false);
            setCrewWorkers((cw) => cw.map((x) =>
              (x.status === 'running' || x.status === 'verifying' || x.status === 'retrying')
                ? { ...x, status: 'done' as const, message: 'Complete' }
                : x,
            ));
            return prev;

          case 'crew_inter_message': {
            if (!isCrewEventForCurrentSession()) return prev;
            const m = ev as unknown as { from: string; to: string; content: string };
            setCrewInterMessages((msgs) => [...msgs, {
              id: crypto.randomUUID(),
              from: m.from,
              to: m.to,
              content: m.content,
              timestamp: new Date().toISOString(),
            }]);
            return prev;
          }

          case 'crew_mission_retry':
            if (!isCrewEventForCurrentSession()) return prev;
            setCrewWorkers((cw) => cw.map((x) => ({ ...x, status: 'retrying' as const, message: 'Retrying…' })));
            return prev;

          case 'crew_worker_spawned': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; crewId: string; crewName: string; callsign: string };
            const color = crewList.find((c) => c.id === w.crewId)?.color;
            setCrewWorkers((cw) => [...cw.filter((x) => x.workerId !== w.workerId), {
              workerId: w.workerId,
              crewId: w.crewId,
              crewName: w.crewName,
              callsign: w.callsign,
              color,
              status: 'running',
              message: 'Starting…',
            }]);
            return prev;
          }

          case 'crew_worker_progress': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; status: CrewWorkerState['status']; message?: string };
            setCrewWorkers((cw) => cw.map((x) =>
              x.workerId === w.workerId ? { ...x, status: w.status, message: w.message ?? x.message } : x,
            ));
            return prev;
          }

          case 'crew_worker_complete': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; success: boolean; elapsed: number; output?: string };
            setCrewWorkers((cw) => {
              const updated = cw.map((x) =>
                x.workerId === w.workerId
                  ? {
                    ...x,
                    status: w.success ? 'done' as const : 'error' as const,
                    elapsed: w.elapsed,
                    message: w.success ? 'Complete' : 'Failed',
                  }
                  : x,
              );
              if (updated.length > 0 && updated.every((x) => x.status === 'done' || x.status === 'error')) {
                setCrewMissionActive(false);
              }
              return updated;
            });
            return prev;
          }

          case 'child_session_started': {
            const c = ev as unknown as { childSessionId: string; label: string; kind: 'sub_agent' | 'crew_worker' };
            if (!c.childSessionId) return prev;
            // Crew mission panel above the input already tracks workers — skip duplicate inline cards.
            if (c.kind === 'crew_worker') return prev;
            return attachChildSessionToAssistant(prev, c.childSessionId, c.label || 'Background work', c.kind ?? 'sub_agent');
          }

          case 'agent_spawned': {
            const agentId = ev.agentId as string;
            const task = (ev.task as string) ?? '';
            if (!agentId) return prev;
            return attachChildSessionToAssistant(prev, agentId, 'Sub-Agent', 'sub_agent', task.slice(0, 200));
          }

          case 'subagent_event': {
            const subagentId = (ev as any).subagentId as string;
            const parentEvent = (ev as any).parentEvent as Record<string, unknown>;
            if (!subagentId || !parentEvent || !last?.subAgents) return prev;
            switch (parentEvent.type) {
              case 'tool_executing': {
                const toolName = (parentEvent.tool as string) ?? 'unknown';
                const desc = (parentEvent.description as string) ?? '';
                const eventArgs = parentEvent.args ?? desc;
                const callId = (parentEvent.callId as string) ?? crypto.randomUUID();
                const tc: ToolCall = { id: callId, name: toolName, args: eventArgs as any, status: 'running' };
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : { ...a, toolCalls: [...(a.toolCalls || []), tc] });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              case 'tool_output': {
                const outputCallId = (parentEvent.callId as string) ?? '';
                const outputText = (parentEvent.output as string) ?? '';
                if (!outputCallId || !outputText) return prev;
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : {
                    ...a,
                    toolCalls: (a.toolCalls || []).map((t: ToolCall) =>
                      t.id === outputCallId && t.status === 'running'
                        ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t),
                  });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              case 'tool_complete': {
                const toolName = (parentEvent.tool as string) ?? '';
                const elapsed = (parentEvent.elapsed as number) ?? 0;
                const callId = (parentEvent.callId as string) ?? '';
                const result = (parentEvent as any).result ?? (parentEvent as any).output ?? '';
                const resultStr = typeof result === 'string' ? result
                  : (result && typeof result === 'object' ? ((result as any).output || (result as any).message || JSON.stringify(result)) : '');
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : {
                    ...a,
                    toolCalls: (a.toolCalls || []).map((t: ToolCall) => {
                      if (callId && t.id !== callId) return t;
                      if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
                      return { ...t, status: 'done' as const, result: resultStr, elapsed };
                    }),
                  });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              default:
                return prev;
            }
          }

          default:
            return prev;
        }
      });
    };

    disconnectRef.current = subscribeTelemetry(
      handleEvent,
      (state) => {
        setConnState(state);
        if (state === 'open') {
          setLastEventAt(Date.now());
        } else if (state === 'reconnecting') {
          // On reconnect, fetch current agent state to recover any missed updates
          fetch('/api/agent/state', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
              const viewSessionId = viewSessionIdRef.current;
              if (!viewSessionId || data.session?.id !== viewSessionId) {
                stopTurnIndicator();
                return;
              }
              if (data.processing) {
                turnActiveRef.current = true;
                setStreaming(true);
              } else {
                stopTurnIndicator();
              }
            })
            .catch(() => {});
        }
      },
    );
    return () => {
      disconnectRef.current?.();
    };
  }, []);

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

  // Streaming timeout — tracks activity via SSE events.
  // - All SSE events (tool, chunk, status) reset the activity timer.
  // - After 2 minutes of inactivity, tries to recover the response from the API.
  // - Retries recovery every tick until streaming ends or a complete response is found.
  // - Never force-closes streaming — the agent may be processing tools for minutes.
  useEffect(() => {
    if (!streaming) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > 120000) {
        // 2 min inactivity — SSE may be disconnected. Try to recover by fetching
        // /api/chat/history. If the agent already produced a response, display it.
        // Keep retrying on every tick until streaming ends.
        fetch(`/api/chat/history`, { credentials: 'include' })
          .then(r => r.json())
          .then(data => {
            const msgs = Array.isArray(data) ? data : [];
            // Iterate backwards to find the most recent complete assistant response
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i];
              if (m.role === 'assistant' && m.content && !m.toolCalls) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  // Only apply if our local content is shorter (stale/partial)
                  if (last.streaming || !last.content || last.content.length < m.content.length) {
                    return updateLastMessage(prev, { content: m.content, streaming: false });
                  }
                  return prev;
                });
                setStreaming(false);
                break;
              }
            }
          })
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [streaming]);

  // Poll async turn status when SSE may miss completion/error
  useEffect(() => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || !streaming) return;
    const poll = setInterval(() => {
      chat.getTurn(turnId).then((record) => {
        if (record.status === 'error') {
          const err = record.error ?? 'Turn failed';
          // Turn registry may mark timeout while SSE still shows live activity
          if (isTimeoutWarning(err) && isAgentRecentlyActive()) return;
          setWarnings(prev => replaceWarning(prev, err));
          if (record.partialContent) {
            setMessages(p => {
              const last = p[p.length - 1];
              if (last?.role === 'assistant') {
                return updateLastMessage(p, { content: record.partialContent!, streaming: false });
              }
              return p;
            });
          }
          endTurnUi();
        } else if (record.status === 'complete' || record.status === 'cancelled') {
          endTurnUi();
        }
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(poll);
  }, [streaming, endTurnUi]);

  // Compute whether send is blocked due to missing provider/model
  const questionnairePending = useMemo(() => hasPendingChatInteraction(messages), [messages]);

  const showMedicalSessionDisclaimer = useMemo(() => {
    const rosterCrew = privateHostCrewId ? crewList.find((c) => c.id === privateHostCrewId) : undefined;
    if (isCrewPrivateSession && crewPrivateHost) {
      const catalogId = rosterCrew?.catalogId
        ?? (crewPrivateHost.callsign ? `hub-${crewPrivateHost.callsign}` : undefined);
      return crewRequiresMedicalDisclaimer({
        catalogId,
        crewId: rosterCrew?.id,
        categoryId: (rosterCrew as Crew & { categoryId?: string })?.categoryId,
      });
    }
    return messages.some((m) => {
      if (m.role !== 'assistant' || !m.crew) return false;
      const catalogId = m.crew.callsign ? `hub-${m.crew.callsign}` : undefined;
      return crewRequiresMedicalDisclaimer({ catalogId, crewId: m.crew.crewId || undefined });
    });
  }, [isCrewPrivateSession, crewPrivateHost, privateHostCrewId, crewList, messages]);

  const sendBlocked = !currentProvider || !currentModel;
  const sendBlockedReason = !currentProvider
    ? 'Select a provider before sending'
    : !currentModel ? 'Select a model before sending' : '';

  // Keep refs in sync so send handlers never capture stale session/cwd from closures.
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { viewSessionIdRef.current = sessionId ?? null; }, [sessionId]);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  const ensureDefaultCwd = useCallback(async (): Promise<string> => {
    if (cwdRef.current) return cwdRef.current;
    const folder = await resolveDefaultWorkspace();
    setCwd(folder);
    cwdRef.current = folder;
    try {
      await system.setCwd(folder);
    } catch { /* best-effort */ }
    return folder;
  }, []);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current;
    const scopePath = await ensureDefaultCwd();
    try {
      const result = await sessions.create(scopePath);
      const newId = result?.sessionId;
      if (newId) {
        setCurrentSessionId(newId);
        currentSessionIdRef.current = newId;
        skipRestoreRef.current = true;
        navigate(`/console/chat/${newId}`);
        return newId;
      }
      setWarnings(['Failed to create session. Please try again.']);
    } catch (e) {
      setWarnings([`Failed to create session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
    return null;
  }, [navigate, ensureDefaultCwd]);

  const handleViewCrewDossier = useCallback(async (candidate: CrewMatchCandidate) => {
    if (candidate.onRoster || candidate.origin === 'custom' || candidate.origin === 'hub_roster') {
      const roster = crewList.find((c) => c.id === candidate.id);
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
  }, [crewList]);

  const attachCrewRosterPicker = useCallback(async (
    text: string,
    evaluation: CrewSuggestionEvaluation,
    opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  ): Promise<boolean> => {
    if (isCrewPrivateSession) return false;
    if (!shouldOfferCrewRosterPicker(evaluation)) return false;

    const trimmed = sanitizeForJson(text.trim());
    if (!trimmed) return false;
    const sessionId = await ensureSession();
    if (!sessionId) return false;

    const alreadyPending = messages.some((m) =>
      m.parts?.some((p) =>
        p.type === 'crew_roster_picker'
        && p.crewRosterPicker?.status === 'pending'
        && p.crewRosterPicker.pendingUserText === trimmed,
      ),
    );
    if (alreadyPending) return true;

    try {
      const persisted = await crewSuggestions.offerRosterPicker(sessionId, {
        userText: trimmed,
        evaluation,
        attachments: attachments.map((a) => ({ name: a.name })),
        userMessageId: opts?.userMessageId,
      });

      const pickerRecord = {
        id: persisted.pickerPartId,
        status: 'pending' as const,
        evaluation,
        pendingUserText: trimmed,
      };
      const pickerMsg: UIMessage = {
        id: persisted.pickerMessageId,
        role: 'assistant',
        content: '',
        streaming: false,
        parts: [{
          type: 'crew_roster_picker',
          id: persisted.pickerPartId,
          crewRosterPicker: pickerRecord,
        }],
      };

      setMessages((prev) => {
        if (opts?.userMessageId && opts?.evalAssistantMessageId) {
          return prev.map((m) => {
            if (m.id === opts.userMessageId) {
              return {
                ...m,
                id: persisted.userMessageId,
                content: trimmed,
              };
            }
            if (m.id === opts.evalAssistantMessageId) return pickerMsg;
            return m;
          });
        }

        if (opts?.userMessageId) {
          return [
            ...prev.map((m) => (m.id === opts.userMessageId ? { ...m, id: persisted.userMessageId } : m)),
            pickerMsg,
          ];
        }

        const userMsg: UIMessage = {
          id: persisted.userMessageId,
          role: 'user',
          content: trimmed,
          streaming: false,
          attachments: attachments.map((a) => ({ name: a.name })),
        };
        return [...prev, userMsg, pickerMsg];
      });
      inputBarRef.current?.clear();
      setAttachments([]);
      return true;
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to offer crew roster'));
      return false;
    }
  }, [attachments, isCrewPrivateSession, ensureSession, replaceWarning, messages]);

  useEffect(() => {
    attachCrewRosterPickerRef.current = attachCrewRosterPicker;
  }, [attachCrewRosterPicker]);

  const executeSend = useCallback(async (
    text: string,
    delegateCrewIds?: string[],
    options?: {
      crewSuggestionResolved?: boolean;
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
      skipUserMessage?: boolean;
      userMessagePersisted?: boolean;
    },
  ) => {
    const trimmed = sanitizeForJson(text.trim());
    if ((!trimmed && attachments.length === 0) && !options?.skipUserMessage) return;
    if (!currentProvider || !currentModel) return;
    rateLimitSeenRef.current = false;
    if (!(await ensureSession())) return;

    const priorUserMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(-3);

    beginTurnUi();
    if (!options?.skipUserMessage) {
      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        streaming: false,
        attachments: attachments.map((a) => ({ name: a.name })),
      };
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true },
      ]);
      inputBarRef.current?.clear();
    }

    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);

    const crewResolved = options?.crewSuggestionResolved ?? Boolean(delegateCrewIds?.length);

    try {
      const clientSituation = await collectClientSituation();
      const result = await chat.send(
        trimmed,
        fileRefs,
        undefined,
        delegateCrewIds,
        crewResolved,
        priorUserMessages,
        options?.crewIntakeFromPicker,
        options?.primaryCrewId,
        webSearchAvailable && webSearchForce,
        options?.userMessagePersisted ?? options?.skipUserMessage,
        clientSituation,
      );
      if (result?.crewSuggestionRequired && result.evaluation) {
        endTurnUi();
        let existingUserId: string | undefined;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const next = last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
          existingUserId = next.find((m) => m.role === 'user' && m.content === trimmed)?.id;
          return next;
        });
        crewSuggestionHandledRef.current = true;
        await attachCrewRosterPicker(trimmed, result.evaluation, existingUserId
          ? { userMessageId: existingUserId }
          : undefined);
        return;
      }
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        const msg = result.message;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            const fullContent = msg.content || '';
            if (fullContent) return [...prev.slice(0, -1), { ...last, ...msg, streaming: false } as UIMessage];
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
      endTurnUi();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const displayError = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '...' : errorMsg;
      const isProviderErr = /429|quota|billing|suspended|rate.?limit|api.?key|unauthorized|forbidden|exceeded|invalid.*key|disabled|expired|insufficient|credits|balance|dunning|deny/i.test(errorMsg);
      if (isProviderErr) {
        setWarnings(prev => replaceWarning(prev, extractProviderError(errorMsg)));
        chat.cancel().catch(() => {});
      } else {
        setWarnings(prev => replaceWarning(prev, displayError));
        chat.cancel().catch(() => {});
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) return prev.slice(0, -1);
        return prev;
      });
      endTurnUi();
    }
  }, [attachments, currentProvider, currentModel, agentMode, ensureSession, messages, attachCrewRosterPicker, beginTurnUi, endTurnUi, webSearchAvailable, webSearchForce]);

  const runCrewSuggestionGate = useCallback(async (trimmed: string): Promise<boolean> => {
    if (isCrewPrivateSession || coreSession) return false;
    if (/(?<!\w)@([\w][\w.-]*)/.test(trimmed)) return false;
    if (crewGateInFlightRef.current) return false;

    const sessionId = await ensureSession();
    if (!sessionId) return false;

    crewGateInFlightRef.current = true;
    try {
    const userMessageId = crypto.randomUUID();
    const evalAssistant = createCrewSuggestionEvalMessage();
    const userMsg: UIMessage = {
      id: userMessageId,
      role: 'user',
      content: sanitizeForJson(trimmed),
      streaming: false,
      attachments: attachments.map((a) => ({ name: a.name })),
    };

    setMessages((prev) => [...prev, userMsg, evalAssistant]);
    inputBarRef.current?.clear();
    setAttachments([]);

    const priorUserMessages = [
      ...messages.filter((m) => m.role === 'user').map((m) => m.content),
      trimmed,
    ].slice(-3);

    try {
      const evaluation = await crewSuggestions.evaluate(trimmed, sessionId, priorUserMessages);
      if (evaluation?.reasons.includes('catalog-unavailable')) {
        setWarnings((prev) => replaceWarning(prev, 'Crew catalog unavailable — continuing with Agent-X only.'));
      }

      if (evaluation && shouldOfferCrewRosterPicker(evaluation)) {
        crewSuggestionHandledRef.current = true;
        const attached = await attachCrewRosterPicker(trimmed, evaluation, {
          userMessageId,
          evalAssistantMessageId: evalAssistant.id,
        });
        if (attached) return true;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        const msg = err instanceof Error ? err.message : 'Crew suggestion check failed';
        setWarnings((prev) => replaceWarning(prev, `Crew suggestion: ${msg}`));
      }
    }

    setMessages((prev) => prev.filter((m) => m.id !== evalAssistant.id));
    await executeSend(trimmed, undefined, { crewSuggestionResolved: true, skipUserMessage: true });
    return true;
    } finally {
      crewGateInFlightRef.current = false;
    }
  }, [
    attachments,
    attachCrewRosterPicker,
    coreSession,
    ensureSession,
    executeSend,
    isCrewPrivateSession,
    messages,
    replaceWarning,
  ]);

  const sendAfterModeChoice = useCallback(async (text: string, switchToAgent: boolean) => {
    if (switchToAgent) {
      setAgentMode('agent');
      await sessionSettings.setMode('agent').catch(() => {});
    }
    if (await runCrewSuggestionGate(text)) return;
    await executeSend(text, undefined, { crewSuggestionResolved: true });
  }, [runCrewSuggestionGate, executeSend]);

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0)) return;
    crewSuggestionHandledRef.current = false;
    if (agentMode === 'plan' && shouldSuggestMode(trimmed) && !localStorage.getItem(DISMISS_KEY)) {
      pendingSendTextRef.current = trimmed;
      setModeSuggestOpen(true);
      return;
    }

    if (await runCrewSuggestionGate(trimmed)) return;
    await executeSend(trimmed);
  }, [attachments.length, agentMode, executeSend, runCrewSuggestionGate]);

  // Retry last user message — re-sends without duplicating the user message,
  // replaces the existing assistant response on success.
  const handleResend = useCallback(async (text: string) => {
    if (!text || streaming || !currentProvider || !currentModel) return;
    if (!(await ensureSession())) return;

    try { await chat.cancel(); } catch { /* ignore */ }
    resendInProgressRef.current = true;
    setTurnActivity(null);
    setLoadingSteps(null);
    beginTurnUi();

    // Remove the old assistant response — SSE will update the placeholder
    setMessages(prev => {
      const last = prev[prev.length - 1];
      return last?.role === 'assistant' ? prev.slice(0, -1) : prev;
    });

    try {
      const clientSituation = await collectClientSituation();
      const result = await chat.send(sanitizeForJson(text), undefined, true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clientSituation);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          if (!last.content && result?.message?.content) {
            return [...prev.slice(0, -1), { ...result.message, streaming: false }];
          }
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      endTurnUi();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const displayError = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '...' : errorMsg;
      const isProviderErr = /429|quota|billing|suspended|rate.?limit|api.?key|unauthorized|forbidden|exceeded|invalid.*key|disabled|expired|insufficient|credits|balance|dunning|deny/i.test(errorMsg);
      if (isProviderErr) {
        const msg = extractProviderError(errorMsg);
        setWarnings(prev => replaceWarning(prev, msg));
        chat.cancel().catch(() => {});
      } else {
        setWarnings(prev => replaceWarning(prev, displayError));
        chat.cancel().catch(() => {});
      }
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      endTurnUi();
    }
  }, [streaming, currentProvider, currentModel, ensureSession, beginTurnUi, endTurnUi]);

  // --- Clarification response ---
  const markCrewRosterPickerResolved = useCallback((
    messageId: string,
    status: 'answered' | 'skipped',
    selectedCandidateIds?: string[],
  ) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.parts) return m;
      return {
        ...m,
        parts: m.parts.map((p) => {
          if (p.type !== 'crew_roster_picker' || !p.crewRosterPicker) return p;
          return {
            ...p,
            crewRosterPicker: {
              ...p.crewRosterPicker,
              status,
              selectedCandidateIds,
            },
          };
        }),
      };
    }));
  }, []);

  const revertCrewRosterPickerPending = useCallback((messageId: string) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.parts) return m;
      return {
        ...m,
        parts: m.parts.map((p) => {
          if (p.type !== 'crew_roster_picker' || !p.crewRosterPicker) return p;
          return {
            ...p,
            crewRosterPicker: {
              ...p.crewRosterPicker,
              status: 'pending' as const,
              selectedCandidateIds: undefined,
            },
          };
        }),
      };
    }));
  }, []);

  const handleCrewRosterPickerSubmit = useCallback(async (messageId: string, selected: CrewMatchCandidate[]) => {
    const pickerMsg = messages.find((m) => m.id === messageId);
    const pickerPart = pickerMsg?.parts?.find((p) => p.type === 'crew_roster_picker');
    const record = pickerPart?.crewRosterPicker;
    if (!record || record.status !== 'pending') return;

    const text = record.pendingUserText;
    const pickerPartId = pickerPart?.id;
    const selectedIds = selected.map((c) => c.id);
    markCrewRosterPickerResolved(messageId, 'answered', selectedIds);

    try {
      const sessionId = await ensureSession();
      if (!sessionId) {
        revertCrewRosterPickerPending(messageId);
        return;
      }
      const result = await crewSuggestions.resolve({
        sessionId,
        action: 'deploy',
        selectedCandidateIds: selectedIds,
        candidates: record.evaluation.candidates,
      });
      if (!result.deployedCrewIds?.length) {
        setWarnings((prev) => replaceWarning(prev, 'Selected specialists could not be recruited or enabled.'));
        await crewSuggestions.updateRosterPicker(sessionId, {
          pickerMessageId: messageId,
          status: 'skipped',
          evaluation: record.evaluation,
          pendingUserText: text,
          pickerPartId,
        });
        markCrewRosterPickerResolved(messageId, 'skipped');
        await executeSend(text, undefined, { crewSuggestionResolved: true, skipUserMessage: true, userMessagePersisted: true });
        return;
      }
      const primaryCrewId = result.deployedPrimaryCrewId
        ?? result.deployedCrewIds[0];
      await crewSuggestions.updateRosterPicker(sessionId, {
        pickerMessageId: messageId,
        status: 'answered',
        selectedCandidateIds: selectedIds,
        evaluation: record.evaluation,
        pendingUserText: text,
        pickerPartId,
      });
      crews.list().then((list) => setCrewList(list)).catch(() => {});
      await executeSend(text, result.deployedCrewIds, {
        crewSuggestionResolved: true,
        primaryCrewId,
        skipUserMessage: true,
        userMessagePersisted: true,
        crewIntakeFromPicker: true,
      });
    } catch (err) {
      revertCrewRosterPickerPending(messageId);
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to deploy crew'));
    }
  }, [messages, markCrewRosterPickerResolved, revertCrewRosterPickerPending, ensureSession, executeSend, replaceWarning]);

  const handleCrewRosterPickerSkip = useCallback(async (messageId: string, dismissForSession = false) => {
    const pickerMsg = messages.find((m) => m.id === messageId);
    const pickerPart = pickerMsg?.parts?.find((p) => p.type === 'crew_roster_picker');
    const record = pickerPart?.crewRosterPicker;
    if (!record || record.status !== 'pending') return;

    markCrewRosterPickerResolved(messageId, 'skipped');

    try {
      const sessionId = await ensureSession();
      if (sessionId) {
        await crewSuggestions.resolve({
          sessionId,
          action: dismissForSession ? 'dismiss' : 'skip',
          dismissForSession,
        });
        await crewSuggestions.updateRosterPicker(sessionId, {
          pickerMessageId: messageId,
          status: 'skipped',
          evaluation: record.evaluation,
          pendingUserText: record.pendingUserText,
          pickerPartId: pickerPart?.id,
        });
      }
      await executeSend(record.pendingUserText, undefined, {
        crewSuggestionResolved: true,
        skipUserMessage: true,
        userMessagePersisted: true,
      });
    } catch (err) {
      revertCrewRosterPickerPending(messageId);
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to skip crew picker'));
    }
  }, [messages, markCrewRosterPickerResolved, revertCrewRosterPickerPending, ensureSession, executeSend, replaceWarning]);

  // ── Sidebar crew mission: manual add/remove ───────────────────────────
  const crewAddSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCrewAddSearch = useCallback((q: string) => {
    setCrewAddQuery(q);
    if (crewAddSearchRef.current) clearTimeout(crewAddSearchRef.current);
    if (q.trim().length < 2) {
      setCrewAddResults([]);
      setCrewAddLoading(false);
      return;
    }
    setCrewAddLoading(true);
    crewAddSearchRef.current = setTimeout(async () => {
      try {
        const res = await crewCatalog.search(q.trim(), 8);
        setCrewAddResults(res.crews ?? []);
      } catch {
        setCrewAddResults([]);
      } finally {
        setCrewAddLoading(false);
      }
    }, 250);
  }, []);

  const handleCrewAddSelect = useCallback(async (entry: CatalogSummary) => {
    setCrewAddOpen(false);
    setCrewAddQuery('');
    setCrewAddResults([]);
    try {
      const sessionId = await ensureSession();
      if (!sessionId) return;
      const candidate: CrewMatchCandidate = {
        id: entry.id,
        origin: 'hub_catalog',
        callsign: entry.callsign,
        name: entry.name,
        title: entry.title,
        categoryId: entry.categoryId,
        categoryLabel: entry.categoryLabel,
        description: entry.description,
        expertise: entry.expertise,
        traits: entry.traits,
        tone: entry.tone,
        matchScore: 1,
        reasons: ['manual-add'],
        onRoster: false,
        catalogId: entry.id,
        requiresMedicalDisclaimer: entry.requiresMedicalDisclaimer,
        honorsDoctorate: entry.honorsDoctorate,
      };
      await crewSuggestions.resolve({
        sessionId,
        action: 'deploy',
        selectedCandidateIds: [entry.id],
        candidates: [candidate],
      });
      crews.list().then((list) => setCrewList(list)).catch(() => {});
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to add crew member'));
    }
  }, [ensureSession, replaceWarning]);

  const handleCrewRemove = useCallback(async (crewId: string, crewName: string) => {
    try {
      await crews.toggle(crewId, false);
      crews.list().then((list) => setCrewList(list)).catch(() => {});
      setCrewWorkers((prev) => prev.filter((w) => w.crewId !== crewId));
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : `Failed to remove ${crewName}`));
    }
  }, [replaceWarning]);

  const handleQuestionnaireRespond = useCallback(async (messageId: string, response: string) => {
    const markAnswered = () => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId || !m.parts) return m;
        return {
          ...m,
          parts: m.parts.map((p) => {
            if (p.type !== 'questionnaire' || !p.questionnaire) return p;
            return {
              ...p,
              questionnaire: {
                ...p.questionnaire,
                status: 'answered' as const,
                answer: response,
                answeredAt: new Date().toISOString(),
              },
            };
          }),
        };
      }));
    };

    try {
      markAnswered();
      const result = await agent.respondToClarification(response, currentSessionId ?? undefined);
      if (result.ok) {
        setStreaming(true);
      }
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to send questionnaire response'));
    }
  }, [replaceWarning, currentSessionId]);

  const resetCrewMissionState = useCallback(() => {
    setCrewWorkers([]);
    setCrewMissionActive(false);
    setCrewMissionId(null);
    setCrewInterMessages([]);
    crewMissionSessionIdRef.current = null;
  }, []);

  const isCrewEventForCurrentSession = useCallback(() => {
    const bound = crewMissionSessionIdRef.current;
    const current = currentSessionIdRef.current;
    return bound != null && current != null && bound === current;
  }, []);

  useEffect(() => {
    pendingSendTextRef.current = null;
    crewSuggestionHandledRef.current = false;
  }, [currentSessionId]);
  useEffect(() => { resetCrewMissionState(); }, [currentSessionId, resetCrewMissionState]);

  const handleCancel = useCallback(async () => {
    endTurnUi();
    setPermissionPrompt(null);
    setPendingPermissionCount(0);
    try { await chat.cancel(); } catch { /* ignore */ }
  }, [endTurnUi]);

  // ─── Slash command handler ───
  // ─── Global keyboard shortcuts ───
  // Tab key cycles mode when not typing in input
  const handleToggleMode = useCallback(() => {
    setAgentMode(prev => {
      const next = prev === 'agent' ? 'plan' : 'agent';
      sessionSettings.setMode(next).catch(() => {});
      return next;
    });
  }, []);

  // ─── Hyperdrive toggle ───
  const engageHyperdrive = useCallback(async (skipDisclaimer = false) => {
    if (isCrewPrivateRef.current) {
      if (hyperdriveMode) {
        try {
          const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
          const data = await res.json();
          setHyperdriveMode(false);
          if (data.mode) setAgentMode(data.mode);
          else setAgentMode(prevModeBeforeHyperdrive.current);
        } catch { /* best-effort */ }
      }
      return;
    }
    if (hyperdriveMode) {
      // Deactivate hyperdrive — restore previous mode
      try {
        const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        setHyperdriveMode(false);
        if (data.mode) setAgentMode(data.mode);
        else setAgentMode(prevModeBeforeHyperdrive.current);
      } catch {}
      return;
    }
    // Activate hyperdrive
    if (!skipDisclaimer && !hyperdrivePromptShownRef.current) {
      setShowDisclaimer(true);
      return;
    }
    // Skip disclaimer — directly engage
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentMode;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [hyperdriveMode, agentMode]);

  const handleHyperdriveToggle = useCallback(() => {
    engageHyperdrive();
  }, [engageHyperdrive]);

  const confirmHyperdrive = useCallback(async () => {
    setShowDisclaimer(false);
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentMode;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [agentMode]);

  // Check hyperdrive mode on mount (disabled for crew private chats)
  useEffect(() => {
    hyperdrivePromptShownRef.current = false;
    if (isCrewPrivateSession) {
      setHyperdriveMode(false);
      fetch('/api/mode/hyperdrive', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (d.hyperdriveMode) {
            return fetch('/api/mode/hyperdrive', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return undefined;
        })
        .catch(() => {});
      return;
    }
    fetch('/api/mode/hyperdrive', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.hyperdriveMode) {
          setHyperdriveMode(true);
          if (d.mode) setAgentMode(d.mode);
        }
      })
      .catch(() => {});
  }, [currentSessionId, isCrewPrivateSession]);

  // Refresh context data when session loads or changes
  useEffect(() => {
    if (!currentSessionId) return;
    refreshContext();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshContext();
    }, 30000);
    return () => clearInterval(interval);
  }, [currentSessionId, refreshContext]);

  // Double-Esc ref for cancel
  const lastEscRef = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        // Hyperdrive active → TAB deactivates it, restores previous mode
        if (hyperdriveMode) {
          e.preventDefault();
          engageHyperdrive();
          return;
        }
        e.preventDefault();
        handleToggleMode();
      } else if (e.key === 'Shift') {
        if (isCrewPrivateRef.current) return;
        // Double-Shift → engage/disengage hyperdrive
        const now = Date.now();
        if (now - lastShiftRef.current < 500) {
          lastShiftRef.current = 0;
          engageHyperdrive(); // toggles: off→on (with/without disclaimer), on→off
        } else {
          lastShiftRef.current = now;
        }
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleResend(messages.filter(m => m.role === 'user').pop()?.content ?? '');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (streaming) {
          handleCancel();
        } else {
          // Double-Esc within 500ms = cancel any active processing
          const now = Date.now();
          if (now - lastEscRef.current < 500) {
            handleCancel();
            lastEscRef.current = 0;
          } else {
            lastEscRef.current = now;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSessionId, streaming, messages, handleResend, view, handleToggleMode, hyperdriveMode, engageHyperdrive]);

  // ─── Command palette actions ───
  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: 'new-session', label: 'New session', hint: 'N', icon: <AddIcon sx={{ fontSize: 14 }} />, run: () => handleNewSession() },
    { id: 'sessions', label: 'Show all sessions', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => handleShowSessions() },
    { id: 'search', label: 'Search sessions', hint: '⌘F', icon: <SearchIcon sx={{ fontSize: 14 }} />, run: () => setSearchOpen(true) },
    { id: 'checkpoints', label: 'Open checkpoints', icon: <HistoryIcon sx={{ fontSize: 14 }} />, run: () => setCheckpointsOpen(true) },
    { id: 'mode-agent', label: 'Switch mode → Agent', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); } },
    { id: 'mode-plan', label: 'Switch mode → Plan', icon: <RouteIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); } },
  ], []);

  const handleStopAndSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    beginTurnUi();
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, streaming: false, attachments: attachments.map((a) => ({ name: a.name })) };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.stopAndSend(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    endTurnUi();
  }, [attachments, ensureSession, beginTurnUi, endTurnUi]);

  const handleAddToQueue = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    try { await chat.queue(trimmed, fileRefs); } catch { /* ignore */ }
    setAttachments([]);
  }, [attachments]);

  const handleSteer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    beginTurnUi();
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: `↑ ${trimmed}`, streaming: false };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.steer(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    endTurnUi();
  }, [attachments, ensureSession, beginTurnUi, endTurnUi]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { name: file.name, content: reader.result as string }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  }, []);

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleShowSessions = () => {
    setStreaming(false);
    loadSessions();
    const returnTo = chatReturnToRef.current;
    chatReturnToRef.current = null;
    if (returnTo === '/console/crews') {
      navigate('/console/crews');
    } else if (returnTo === 'crew_tab' || isCrewPrivateSession) {
      navigate('/console/chat?tab=crew');
    } else {
      navigate('/console/chat');
    }
  };

  const handleSelectSession = async (s: SessionInfo) => {
    setWarnings([]);
    rateLimitSeenRef.current = false;
    setStreaming(false);
    setHasOlderMessages(false);
    setInitialScrollDone(false);
    initialScrollDoneRef.current = false;
    paginationReadyRef.current = false;
    needsInitialScrollRef.current = true;
    lastScrollTopRef.current = 0;
    isAtBottomRef.current = false;
    paginationAnchorRef.current = null;
    paginationAnchorMessageIdRef.current = null;
    paginationAnchorOffsetRef.current = null;
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
    if (previewShell.agentMode) setAgentMode(previewShell.agentMode);
    setCurrentSessionTitle(previewShell.title);
    if (previewShell.crewPrivate) chatReturnToRef.current = 'crew_tab';
    try {
      const { messages: historyMsgs, session, scopePath, turnFeedback, messagesMeta } = await sessions.restore(s.id, { perRole: CHAT_INITIAL_MESSAGES_PER_ROLE });
      if (session?.parentId || s.parentId) {
        setSessionRestoring(false);
        sessionRestoringRef.current = false;
        isInitialLoadRef.current = false;
        const parentId = session?.parentId ?? s.parentId!;
        setChildSessionDrawer({
          childSessionId: s.id,
          label: s.title ?? 'Background work',
          kind: s.id.startsWith('crew-worker') ? 'crew_worker' : 'sub_agent',
        });
        navigate(`/console/chat/${parentId}`);
        return;
      }
      const mapped = mapHistoryToUiMessages(historyMsgs);
      const shell = buildSessionShellPatch({ ...s, ...session, id: s.id });
      let feedbackRows = turnFeedback ?? [];
      if (!feedbackRows.length) {
        try {
          const fb = await sessions.listTurnFeedback(s.id);
          feedbackRows = fb.feedback;
        } catch { /* best-effort */ }
      }
      const withFeedback = applyTurnFeedbackRows(mapped, feedbackRows);
      setMessages(withFeedback);
      setHasOlderMessages(messagesMeta?.truncated ?? false);
      setIsCrewPrivateSession(shell.crewPrivate);
      setCrewPrivateHost(shell.privateHost);
      setPrivateHostCrewId(shell.privateHostCrewId);
      if (shell.agentMode) setAgentMode(shell.agentMode);
      setCurrentSessionTitle(shell.title);
      if (shell.crewPrivate) chatReturnToRef.current = 'crew_tab';
      setParentSessionId(session?.parentId ?? s.parentId ?? null);
      setCurrentSessionId(s.id);
      setShowJumpPill(false);
      jumpSuppressScrollTopRef.current = null;
      const visible = historyMsgs.filter((m) => m.role !== 'part' && m.role !== 'system');
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const persistedUsed = (s as { tokenUsed?: number; tokensUsed?: number }).tokenUsed ?? s.tokensUsed ?? 0;
      const tokenAvail = Number((s as { tokenAvailable?: number; token_available?: number }).tokenAvailable ?? (s as { token_available?: number }).token_available ?? 0);
      if (tokenAvail > 0) setTokenTotal(tokenAvail);
      setTokenUsed(persistedUsed > 0 ? persistedUsed : inputEst + outputEst);
      setCompactionCount((s as { compactionCount?: number }).compactionCount ?? 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
      tokenInputRef.current = inputEst;
      tokenOutputRef.current = outputEst;
      const restoredCwd = scopePath || session?.scopePath || '';
      if (restoredCwd) setCwd(restoredCwd);
      loadTodos();
      setSessionRestoring(false);
      sessionRestoringRef.current = false;
      isInitialLoadRef.current = false;
      navigate(`/console/chat/${s.id}`);

      if (!shell.crewPrivate) {
        void (async () => {
          try {
            let roster = crewList;
            if (!roster.length) {
              roster = await crews.list();
              setCrewList(roster);
            }
            const hydrated = await hydrateCrewDeliverables(s.id, withFeedback, roster);
            if (hydrated.crewWorkers.length > 0) {
              setCrewWorkers(hydrated.crewWorkers);
              crewMissionSessionIdRef.current = s.id;
            }
            setMessages(applyTurnFeedbackRows(hydrated.messages, feedbackRows));
            if (isAtBottomRef.current) {
              requestAnimationFrame(() => {
                const el = messagesContainerRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              });
            }
          } catch { /* best-effort */ }
        })();
      }
    } catch (e) {
      setSessionRestoring(false);
      sessionRestoringRef.current = false;
      isInitialLoadRef.current = false;
      setWarnings([`Failed to restore session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
  };

  const handleNewSession = async () => {
    const folder = await resolveDefaultWorkspace();
    void startNewSession(folder);
  };

  // Clear session view: soft-archives messages (kept in DB + memory), two-step confirm
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimerRef = useRef<number | null>(null);
  const handleClearSession = async () => {
    const sid = currentSessionIdRef.current;
    if (!sid) return;
    if (!clearArmed) {
      setClearArmed(true);
      if (clearArmTimerRef.current) window.clearTimeout(clearArmTimerRef.current);
      clearArmTimerRef.current = window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    if (clearArmTimerRef.current) { window.clearTimeout(clearArmTimerRef.current); clearArmTimerRef.current = null; }
    setClearArmed(false);
    try {
      await sessions.archiveMessages(sid);
      setMessages([]);
      setHasOlderMessages(false);
      setPendingFeedbackMessageId(null);
    } catch (e) {
      setWarnings([`Failed to clear session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
  };

  const startNewSession = async (folder: string) => {
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
    setCwd(folder);
    cwdRef.current = folder;
    try {
      await system.setCwd(folder);
      const { sessionId: newSessionId } = await sessions.create(folder);
      setCurrentSessionId(newSessionId);
      currentSessionIdRef.current = newSessionId;
      skipRestoreRef.current = true;
      setView('chat');
      navigate(`/console/chat/${newSessionId}`);
    } catch (e) {
      setCurrentSessionId(null);
      currentSessionIdRef.current = null;
      setWarnings([`Failed to start session: ${e instanceof Error ? e.message : 'Please try a different folder.'}`]);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try { await sessions.delete(id); loadSessions(); } catch { /* ignore */ }
  };

  const handleFolderConsentConfirm = async () => {
    const action = pendingFolderActionRef.current;
    pendingFolderActionRef.current = null;
    setFolderConsentOpen(false);
    if (!action) return;

    if (action === 'newSession') {
      const folder = await resolveDefaultWorkspace();
      void startNewSession(folder);
      return;
    }

    setFolderPickerLoading(true);
    await new Promise(r => setTimeout(r, 400));
    setFolderPickerLoading(false);

    setFolderPickerCallback(() => (path: string) => {
      system.setCwd(path).then(r => setCwd(r.cwd)).catch(() => {});
    });
    setFolderPickerOpen(true);
  };

  // Token percentage
  const tokenPercent = tokenTotal > 0 ? Math.min((tokenUsed / tokenTotal) * 100, 100) : 0;

  // ─── Chat view ───
  // Memoized visibleMessages + isLastUser flags to avoid O(n²) computation on every render
  const visibleMessagesWithFlags = useMemo(() => {
    const visible = messages.filter((m) => {
      if (m.role === 'system' && !m.isModeChange) return false;
      if (m.role === 'assistant' && !m.content && !m.thinking && (!m.toolCalls || m.toolCalls.length === 0) && (!m.subAgents || m.subAgents.length === 0) && (!m.parts || m.parts.length === 0)) return false;
      return true;
    });
    
    // Pre-compute isLastUser in a single O(n) pass: only the final user
    // message gets the flag.
    let lastUserIdx = -1;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i]!.role === 'user') { lastUserIdx = i; break; }
    }
    return visible.map((msg, idx) => ({ msg, isLastUser: idx === lastUserIdx }));
  }, [messages]);
  
  const visibleMessages = visibleMessagesWithFlags.map(item => item.msg);

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      {view === 'sessions' ? (
        <Box sx={{ height: '100%', flex: 1, display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary, position: 'relative', overflow: 'hidden' }}>
          {/* Subtle background grid effect */}
          <Box sx={{
            position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
            backgroundImage: `linear-gradient(${colors.border.subtle} 1px, transparent 1px), linear-gradient(90deg, ${colors.border.subtle} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }} />

          {/* Header — HUD style */}
          <Box sx={{
            px: 3, py: 2, borderBottom: `1px solid ${alphaColor(colors.accent.blue, '20')}`,
            display: 'flex', alignItems: 'center', gap: 1.5, position: 'relative', zIndex: 1,
            background: `linear-gradient(180deg, ${alphaColor(colors.accent.blue, '05')} 0%, transparent 100%)`,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.accent.green, boxShadow: `0 0 8px ${alphaColor(colors.accent.green, '80')}` }} />
              <Typography sx={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', fontWeight: 700,
                color: colors.accent.green, letterSpacing: '3px',
              }}>
                SESSIONS
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
              {([
                { id: 'agent_x' as const, label: 'AGENT-X', count: agentSessionCount },
                { id: 'crew_private' as const, label: 'CREW PRIVATE', count: crewPrivateSessionCount },
              ]).map((tab) => (
                <Button
                  key={tab.id}
                  size="small"
                  onClick={() => setSessionListTab(tab.id)}
                  sx={{
                    minWidth: 0,
                    px: 1.25,
                    py: 0.35,
                    fontSize: '0.55rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '1px',
                    color: sessionListTab === tab.id ? colors.accent.blue : colors.text.dim,
                    bgcolor: sessionListTab === tab.id ? alphaColor(colors.accent.blue, '12') : 'transparent',
                    border: `1px solid ${sessionListTab === tab.id ? alphaColor(colors.accent.blue, '40') : colors.border.subtle}`,
                    borderRadius: '4px',
                    '&:hover': { bgcolor: alphaColor(colors.accent.blue, '18'), borderColor: alphaColor(colors.accent.blue, '50') },
                  }}
                >
                  {tab.label}
                  <Box component="span" sx={{ ml: 0.75, opacity: 0.7 }}>({tab.count})</Box>
                </Button>
              ))}
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim }}>
              {filteredSessionList.length} SHOWN
            </Typography>
            {sessionListTab === 'agent_x' && (
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 12 }} />}
              onClick={() => handleNewSession()}
              sx={{
                color: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace",
                border: `1px solid ${alphaColor(colors.accent.blue, '30')}`, px: 1.5, py: 0.4, borderRadius: '4px',
                '&:hover': { bgcolor: alphaColor(colors.accent.blue, '15'), borderColor: alphaColor(colors.accent.blue, '60') },
              }}
            >
              NEW SESSION
            </Button>
            )}
            {sessionListTab === 'crew_private' && (
            <Button
              size="small"
              startIcon={<ForumIcon sx={{ fontSize: 12 }} />}
              onClick={() => navigate('/console/crews')}
              sx={{
                color: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace",
                border: `1px solid ${alphaColor(colors.accent.blue, '30')}`, px: 1.5, py: 0.4, borderRadius: '4px',
                '&:hover': { bgcolor: alphaColor(colors.accent.blue, '15'), borderColor: alphaColor(colors.accent.blue, '60') },
              }}
            >
              OPEN CREWS
            </Button>
            )}
          </Box>

          {/* Session list */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 2, position: 'relative', zIndex: 1 }}>
            {filteredSessionList.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                <Box sx={{
                  width: 64, height: 64, borderRadius: '50%',
                  border: `1px solid ${alphaColor(colors.border.strong, '30')}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: colors.bg.tertiary,
                }}>
                  {sessionListTab === 'crew_private' ? (
                    <ForumIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
                  ) : (
                    <SmartToyIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
                  )}
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: colors.text.dim, letterSpacing: '2px', mb: 0.5 }}>
                    {sessionListTab === 'crew_private' ? 'NO CREW PRIVATE CHATS' : 'NO SESSIONS'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, opacity: 0.6 }}>
                    {sessionListTab === 'crew_private'
                      ? 'Start a private 1:1 chat from the crew roster or Crew Hub'
                      : 'Send a message to start your first session'}
                  </Typography>
                </Box>
                {sessionListTab === 'crew_private' ? (
                  <Button
                    size="small"
                    onClick={() => navigate('/console/crews')}
                    sx={{
                      mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.65rem',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    GO TO CREWS
                  </Button>
                ) : (
                  <Button
                    size="small"
                    onClick={() => handleNewSession()}
                    sx={{
                      mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.65rem',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    NEW SESSION
                  </Button>
                )}
              </Box>
            ) : (
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 1.25,
              }}>
                {filteredSessionList.map((s) => (
                  <SessionGridCard
                    key={s.id}
                    session={s}
                    onOpen={handleSelectSession}
                    onDelete={handleDeleteSession}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      ) : (<>
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative',
        ...(hyperdriveMode ? {
          borderRadius: 2,
          transition: 'all 0.6s ease',
          '&::before': {
            content: '""',
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,255,0.03) 2px, rgba(255,0,255,0.03) 4px)',
            animation: 'agentx-scanlines 4s linear infinite',
            borderRadius: 'inherit',
          },
        } : {}),
      }}>
        {/* Hyperdrive cosmic particles background */}
        {hyperdriveMode && (
          <Box sx={{
            position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
            borderRadius: 'inherit',
          }}>
            {Array.from({ length: 30 }).map((_, i) => (
              <Box key={i} sx={{
                position: 'absolute',
                width: 1 + Math.random() * 2, height: 1 + Math.random() * 2,
                bgcolor: i % 3 === 0 ? hyperdrive.magenta : i % 3 === 1 ? hyperdrive.cyan : colors.ink,
                borderRadius: '50%',
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                opacity: 0.3 + Math.random() * 0.7,
                animation: `agentx-flicker ${2 + Math.random() * 4}s ease-in-out ${Math.random() * 3}s infinite`,
              }} />
            ))}
          </Box>
        )}
        {/* Header */}
        <Box sx={{
          ...panelHeaderRowSx,
          borderBottom: `1px solid ${hyperdriveMode ? alphaColor(hyperdrive.magenta, '20') : colors.border.default}`,
          position: 'relative',
          zIndex: 1,
          transition: 'border-color 0.6s ease',
        }}>
          {!coreSession && (
            <IconButton size="small" onClick={handleShowSessions} sx={{ color: colors.text.dim, p: 0.5 }}>
              <ArrowBackIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
          {parentSessionId && (
            <Chip size="small"
              icon={<ArrowBackIcon sx={{ fontSize: 10 }} />}
              label="Parent"
              onClick={() => navigate(`/console/chat/${parentSessionId}`)}
              sx={{
                fontSize: '0.50rem', fontFamily: "'JetBrains Mono', monospace", height: 18,
                bgcolor: alphaColor(colors.accent.blue, '10'),
                border: `1px solid ${alphaColor(colors.accent.blue, '20')}`,
                color: colors.accent.blue,
                cursor: 'pointer',
                '&:hover': { filter: 'brightness(1.2)' },
                mr: 0.5,
              }}
            />
          )}
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentSessionTitle ?? 'New Session'}
          </Typography>
          <ConnectionHealthDot state={connState} lastEventAt={lastEventAt} />
          <Tooltip title="Search all sessions (⌘F)" arrow>
            <IconButton size="small" onClick={() => setSearchOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
              <SearchIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Checkpoints (rollback)" arrow>
            <IconButton size="small" onClick={() => setCheckpointsOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
              <HistoryIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export trajectory (JSON)" arrow>
            <IconButton
              size="small"
              onClick={() => { if (currentSessionId) sessions.exportTrajectory(currentSessionId); }}
              disabled={!currentSessionId}
              sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.green } }}
            >
              <DownloadIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          {coreSession && (
            <Tooltip title={clearArmed ? 'Click again to confirm clear' : 'Clear session view (archives messages; DB & memory untouched)'} arrow>
              <IconButton
                size="small"
                onClick={() => { void handleClearSession(); }}
                sx={{
                  color: clearArmed ? colors.accent.red : colors.text.dim,
                  p: 0.5,
                  '&:hover': { color: colors.accent.red },
                }}
              >
                <DeleteSweepIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          )}
          {!coreSession && (
            <Tooltip title="Command palette (⌘K)" arrow>
              <IconButton size="small" onClick={() => setPaletteOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.purple } }}>
                <BoltIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {!coreSession && (
            <Button size="small" startIcon={<AddIcon sx={{ fontSize: 12 }} />} onClick={() => handleNewSession()}
              sx={{ color: colors.accent.green, fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto' }}>
              New
            </Button>
          )}
        </Box>

        {showMedicalSessionDisclaimer && <MedicalDisclaimerChatSessionStrip />}

        {/* Messages */}
        <Box
          ref={messagesContainerRef}
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 2,
            py: 1.5,
            position: 'relative',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {sessionRestoring && visibleMessagesWithFlags.length === 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <CircularProgress size={22} sx={{ color: colors.text.dim }} />
            </Box>
          )}

          {visibleMessagesWithFlags.length === 0 && !streaming && !sessionRestoring && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Box sx={{ textAlign: 'center', maxWidth: 300 }}>
                <SmartToyIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 500, color: colors.text.secondary, mb: 0.5 }}>How can I help?</Typography>
                <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, lineHeight: 1.5 }}>
                  Send a message, attach files, or ask me to execute tasks.
                </Typography>
              </Box>
            </Box>
          )}

          {(loadingOlderMessages || hasOlderMessages) && visibleMessagesWithFlags.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.75 }}>
              {loadingOlderMessages ? (
                <CircularProgress size={14} sx={{ color: colors.text.dim }} />
              ) : (
                <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>Scroll up for older messages</Typography>
              )}
            </Box>
          )}

          <PlanModeContext.Provider value={agentMode === 'plan'}>
            <ChatMessageList
              items={visibleMessagesWithFlags}
              loadingSteps={loadingSteps}
              onResend={handleResend}
              bottomRef={bottomRef}
              onOpenChildSession={openChildSession}
              onQuestionnaireRespond={handleQuestionnaireRespond}
              onCrewRosterPickerSubmit={handleCrewRosterPickerSubmit}
              onCrewRosterPickerSkip={handleCrewRosterPickerSkip}
              onViewCrewDossier={handleViewCrewDossier}
              pendingFeedbackMessageId={sessionRestoring ? null : pendingFeedbackMessageId}
              onTurnFeedback={handleTurnFeedback}
              feedbackSubmitting={feedbackSubmitting}
              freezeLayout={freezeMessageLayout || loadingOlderMessages}
            />
          </PlanModeContext.Provider>

          {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
            <ThinkingIndicator label={loadingSteps?.[0]?.label} />
          )}

           {toolEnablePrompt && (
            <ToolEnableBanner toolId={toolEnablePrompt.toolId} toolName={toolEnablePrompt.toolName} onRespond={() => setToolEnablePrompt(null)} />
          )}

          <ScrollToBottomPill
            visible={showJumpPill}
            onClick={() => {
              const el = messagesContainerRef.current;
              if (el) jumpSuppressScrollTopRef.current = el.scrollTop;
              setShowJumpPill(false);
              scrollMessagesToBottom('smooth');
            }}
          />
        </Box>

        {/* ─── Unified Input Module ─── */}
        <Box sx={{ px: 2, pb: 1.5, pt: 1, position: 'relative' }}>
          {/* Unified warning band — combines provider errors and send-blocked notifications */}
          {(() => {
            const allWarnings: string[] = [...warnings];
            if (sendBlocked && configLoaded && sendBlockedReason) {
              allWarnings.unshift(sendBlockedReason);
            }
            const hasWarnings = allWarnings.length > 0;

            return (
          <Box sx={{
            position: 'relative',
            zIndex: 0,
            overflow: 'hidden',
            maxHeight: hasWarnings ? 260 : 0,
            opacity: hasWarnings ? 1 : 0,
            transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
            mb: hasWarnings ? '-20px' : 0,
          }}>
    <Box sx={{
      bgcolor: alphaColor(colors.accent.orange, '18'),
      border: `1px solid ${alphaColor(colors.accent.orange, '30')}`,
      borderBottom: 'none',
      borderRadius: '14px 14px 0 0',
      px: 1.5, pt: 1, pb: 1.5,
      display: 'flex', alignItems: 'flex-start', gap: 0.75,
      maxHeight: 250,
    }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.3, overflowY: 'auto', maxHeight: 240, pb: 1 }}>
                {allWarnings.map((msg, i) => (
                  <Typography key={i} sx={{
                    fontSize: '0.58rem',
                    color: colors.accent.orange,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 500,
                    letterSpacing: '0.2px',
                    lineHeight: 1.5,
                    flexShrink: 0,
                  }}>
                    ⚠ {msg}
                  </Typography>
                ))}
              </Box>
              <IconButton
                size="small"
                onClick={() => setWarnings([])}
                sx={{ color: alphaColor(colors.accent.orange, 'cc'), p: 0, minWidth: 0, '&:hover': { bgcolor: alphaColor(colors.accent.orange, '20') } }}
              >
                <CloseIcon sx={{ fontSize: 11 }} />
              </IconButton>
            </Box>
          </Box>
            );
          })()}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
              {attachments.map((a, i) => (
                <Chip
                  key={i}
                  size="small"
                  icon={<InsertDriveFileIcon sx={{ fontSize: '13px !important' }} />}
                  label={a.name}
                  onDelete={() => handleRemoveAttachment(i)}
                  deleteIcon={<CloseIcon sx={{ fontSize: '13px !important' }} />}
                  sx={{ fontSize: '0.6rem', height: 22, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}
                />
              ))}
            </Box>
          )}


          {/* Single unified box: input + toolbar — border tinted by mode */}
          <Box sx={{
            position: 'relative',
            zIndex: 1,
            border: `1px solid ${hyperdriveMode ? alphaColor(hyperdrive.magenta, '60') : agentMode === 'agent' ? alphaColor(colors.accent.orange, '60') : colors.border.default}`,
            borderRadius: '14px',
            bgcolor: colors.bg.tertiary,
            backgroundImage: hyperdriveMode ? `linear-gradient(${alphaColor(hyperdrive.magenta, '08')}, ${alphaColor(hyperdrive.magenta, '08')})` : agentMode === 'agent' ? `linear-gradient(${alphaColor(colors.accent.orange, '08')}, ${alphaColor(colors.accent.orange, '08')})` : 'none',
            transition: 'border-color 0.2s, background-color 0.2s, opacity 0.2s ease',
            opacity: questionnairePending || sessionRestoring ? 0.42 : 1,
            pointerEvents: questionnairePending || sessionRestoring ? 'none' : 'auto',
            '&:focus-within': questionnairePending ? {} : { borderColor: hyperdriveMode ? alphaColor(hyperdrive.magenta, '90') : agentMode === 'agent' ? alphaColor(colors.accent.orange, '90') : colors.border.strong },
          }}>
            {/* Permission banner above input */}
            {permissionPrompt && (
              <Box sx={{ px: 1.25, pt: 1.25, pb: 0.5 }}>
                {permissionPrompt.integrationPreview ? (
                  <ActionPreviewCard
                    preview={permissionPrompt.integrationPreview}
                    pendingCount={pendingPermissionCount}
                    onAllowOnce={() => { void handlePermissionRespond('allow_once'); }}
                    onAllowAlways={() => { void handlePermissionRespond('allow_always'); }}
                    onDeny={() => { void handlePermissionRespond('deny'); }}
                    onApproveAll={() => { void handlePermissionRespondBatch('allow_once'); }}
                  />
                ) : (
                  <PermissionBanner
                    prompt={permissionPrompt}
                    pendingCount={pendingPermissionCount}
                    onRespond={() => { setPermissionPrompt(null); setPendingPermissionCount((prev) => Math.max(0, prev - 1)); }}
                    onApproveAll={() => { setPermissionPrompt(null); setPendingPermissionCount(0); }}
                  />
                )}
              </Box>
            )}
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} accept=".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt" />
            {composerMode === 'text' ? (
            <ChatInputBar
              ref={inputBarRef}
              streaming={streaming}
              inputDisabled={questionnairePending}
              sendBlocked={sendBlocked || questionnairePending}
              sendBlockedReason={sendBlockedReason}
              hasAttachments={attachments.length > 0}
              crewList={crewList}
              disableMentions={isCrewPrivateSession || coreSession}
              placeholder={
                coreSession
                  ? 'Talk to Agent-X — your lifelong wingman…'
                  : isCrewPrivateSession && crewPrivateHost
                    ? `Message ${crewPrivateHost.name}...`
                    : undefined
              }
              onSend={handleSend}
              onCancel={handleCancel}
              onStopAndSend={handleStopAndSend}
              onAddToQueue={handleAddToQueue}
              onSteer={handleSteer}
              clearSignal={inputClearSignal}
            />
            ) : (
              <ChatVoicePanel
                chatSessionId={currentSessionId}
                onVoiceUserPending={handleVoiceUserPending}
                onVoiceUserDiscarded={handleVoiceUserDiscarded}
                onTranscriptFinal={handleVoiceTranscript}
                onVoiceTiming={handleVoiceTiming}
                autoStart={voiceAutoStart}
                onAutoStartConsumed={() => setVoiceAutoStart(false)}
              />
            )}

            {/* Toolbar row */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5,
              borderTop: `1px solid ${alphaColor(colors.border.default, '20')}`,
            }}>
            {/* Plus button for file attach */}
              <Tooltip title="Attach files" arrow>
                <IconButton size="small" onClick={() => fileInputRef.current?.click()} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.text.secondary } }}>
                  <AddIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>

              <WebSearchGlobeToggle
                available={webSearchAvailable}
                enabled={webSearchForce}
                onToggle={handleWebSearchToggle}
              />

              {/* Hyperdrive */}
              {!isCrewPrivateSession && (
              <Tooltip title={hyperdriveMode ? 'HYPERDRIVE ENGAGED — Full autonomous mode. All permissions bypassed.' : 'Engage Hyperdrive — full autonomous mode (no permission prompts)'} arrow>
                <Chip
                  size="small"
                  label={hyperdriveMode ? 'hyperdriving' : 'Hyperdrive'}
                  onClick={handleHyperdriveToggle}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: hyperdriveMode ? alphaColor(hyperdrive.magenta, '12') : colors.bg.tertiary,
                    border: `1px solid ${hyperdriveMode ? alphaColor(hyperdrive.magenta, '30') : colors.border.default}`,
                    borderRadius: '10px',
                    color: hyperdriveMode ? hyperdrive.magenta : colors.text.secondary,
                    position: 'relative', overflow: 'hidden',
                    ...(hyperdriveShimmer ? {
                      '&::after': {
                        content: '""',
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'linear-gradient(120deg, transparent 35%, rgba(255,0,255,0.25) 45%, rgba(255,0,255,0.35) 50%, rgba(255,0,255,0.25) 55%, transparent 65%)',
                        backgroundSize: '200% 100%',
                        animation: 'agentx-shimmer 0.8s ease-in-out',
                        borderRadius: '10px',
                        pointerEvents: 'none',
                      },
                    } : {}),
                    '&:hover': { bgcolor: hyperdriveMode ? alphaColor(hyperdrive.magenta, '20') : colors.bg.primary },
                  }}
                />
              </Tooltip>
              )}

              {/* Agent Mode — hidden for crew private and while hyperdriving */}
              {!hyperdriveMode && !isCrewPrivateSession && (
              <Tooltip title={agentMode === 'agent' ? 'Agent — full access, executes tools freely' : 'Plan — outlines steps, no write access'} arrow>
                <Chip
                  size="small"
                  label={agentMode === 'agent' ? 'Agent' : 'Plan'}
                  onClick={(e) => setModeMenuAnchor(e.currentTarget)}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: agentMode === 'agent' ? alphaColor(colors.accent.orange, '12') : colors.bg.tertiary,
                    border: `1px solid ${agentMode === 'agent' ? alphaColor(colors.accent.orange, '30') : colors.border.default}`,
                    borderRadius: '10px',
                    color: agentMode === 'agent' ? colors.accent.orange : colors.text.secondary,
                    '&:hover': { bgcolor: agentMode === 'agent' ? alphaColor(colors.accent.orange, '20') : colors.bg.primary },
                  }}
                />
              </Tooltip>
              )}

              <Menu anchorEl={modeMenuAnchor} open={Boolean(modeMenuAnchor)} onClose={() => setModeMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 220 } }}>
                <MenuItem onClick={() => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'agent'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'agent' ? `3px solid ${colors.accent.orange}` : '3px solid transparent' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.orange }}>Agent</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Full access — executes tools freely</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={() => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'plan'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'plan' ? `3px solid ${colors.text.secondary}` : '3px solid transparent' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.secondary }}>Plan</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Outlines steps — no write access</Typography>
                  </Box>
                </MenuItem>
              </Menu>

              {/* Provider Profile */}
              <Tooltip title="Provider Profile" arrow>
                <Chip
                  size="small"
                  label={(() => { const p = providerList.find(pr => pr.id === currentProvider); return p?.label || currentProvider || 'Provider'; })()}
                  onClick={(e) => setProviderMenuAnchor(e.currentTarget)}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: 'transparent', border: 'none',
                    color: currentProvider ? colors.text.secondary : colors.text.dim,
                    '&:hover': { bgcolor: colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={providerMenuAnchor} open={Boolean(providerMenuAnchor)} onClose={() => setProviderMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
                {providerList.filter(Boolean).map((profile) => (
                  <MenuItem key={profile.id} onClick={() => {
                    setCurrentProvider(profile.id);
                    setCurrentModel('');
                    setModelList([]);
                    providers.switchProfile(profile.providerId, profile.id).catch(() => {});
                    setProviderMenuAnchor(null);
                  }} selected={profile.id === currentProvider} sx={{ fontSize: '0.7rem' }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.7rem' }}>{profile.label}</Typography>
                      <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{profile.providerId}</Typography>
                    </Box>
                  </MenuItem>
                ))}
                {providerList.length === 0 && (
                  <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>No providers configured</MenuItem>
                )}
              </Menu>

              {/* Model */}
              <Tooltip title="Model" arrow>
                <Chip
                  size="small"
                  label={currentModel || 'Model'}
                  onClick={(e) => setModelMenuAnchor(e.currentTarget)}
                    sx={{
                      fontSize: '0.55rem', height: 20, cursor: 'pointer',
                      bgcolor: 'transparent', border: 'none',
                      color: currentModel ? colors.accent.blue : colors.text.dim,
                      '&:hover': { bgcolor: colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={modelMenuAnchor} open={Boolean(modelMenuAnchor)} onClose={() => setModelMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200, maxHeight: 300 } }}>
                {loadingModels && <MenuItem disabled sx={{ fontSize: '0.65rem' }}><CircularProgress size={12} sx={{ mr: 1 }} />Loading...</MenuItem>}
                {!loadingModels && modelList.length === 0 && (
                  <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
                    {currentProvider ? 'No models found' : 'Select a provider first'}
                  </MenuItem>
                )}
                {modelList.filter(Boolean).map((m) => {
                    const caps = m.capabilities ?? [];
                    const hasFC = caps.includes('function_calling');
                    const hasVision = caps.includes('vision');
                    const hasReasoning = caps.includes('reasoning');
                    const hasJson = caps.includes('json_mode');
                    return (
                    <MenuItem key={m.id} onClick={() => {
                      setCurrentModel(m.id);
                      if (m.contextWindow) {
                        setTokenTotal(m.contextWindow);
                        tokenReservedRef.current = Math.min(20000, Math.round(m.contextWindow * 0.15));
                        setTokenReserved(tokenReservedRef.current);
                      }
                      const profile = providerList.find(p => p.id === currentProvider);
    const providerId = profile?.providerId || currentProviderId || currentProvider;
                      if (m.providerId && m.providerId !== providerId) {
                        setCurrentProvider(m.providerId);
                        providers.switch(m.providerId).then(() => {
                          models.switch(m.id, { contextWindow: m.contextWindow, providerId: m.providerId }).catch(() => {});
                        }).catch(() => {});
                      } else {
                        models.switch(m.id, { contextWindow: m.contextWindow, providerId }).catch(() => {});
                      }
                      setModelMenuAnchor(null);
                    }} selected={m.id === currentModel} sx={{ fontSize: '0.65rem' }}>
                      <Box sx={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: m.id === currentModel ? 600 : 400 }}>{m.name || m.id}</Typography>
                          {hasFC && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.blue, bgcolor: alphaColor(colors.accent.blue, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>FC</Typography>}
                          {hasVision && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.green, bgcolor: alphaColor(colors.accent.green, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>V</Typography>}
                          {hasReasoning && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.purple, bgcolor: alphaColor(colors.accent.purple, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>R</Typography>}
                          {hasJson && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.cyan, bgcolor: alphaColor(colors.accent.cyan, '18'), px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>JSON</Typography>}
                        </Box>
                        {m.contextWindow && <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{(m.contextWindow / 1000).toFixed(0)}k context</Typography>}
                      </Box>
                    </MenuItem>
                    );
                  })}
              </Menu>

              {/* Spacer */}
              <Box sx={{ flex: 1 }} />

              {streaming && (
                <ExecutionStatusChip
                  stage={turnActivity?.stage}
                  step={turnActivity?.step}
                  elapsedMs={turnActivity?.elapsedMs}
                />
              )}

              {/* Text / Voice composer toggle */}
              {voiceCtx?.voiceReady && (
                <Tooltip title={composerMode === 'text' ? 'Switch to voice' : 'Switch to text'} arrow>
                  <Chip
                    size="small"
                    icon={composerMode === 'text' ? <MicIcon sx={{ fontSize: '14px !important' }} /> : <KeyboardIcon sx={{ fontSize: '14px !important' }} />}
                    label={composerMode === 'text' ? 'Voice' : 'Text'}
                    onClick={() => {
                      setComposerMode((m) => {
                        const next = m === 'text' ? 'voice' : 'text';
                        if (next === 'voice') {
                          requestAnimationFrame(() => {
                            (document.activeElement as HTMLElement | null)?.blur?.();
                          });
                        }
                        return next;
                      });
                    }}
                    sx={{
                      fontSize: '0.55rem', height: 20, cursor: 'pointer',
                      bgcolor: composerMode === 'voice' ? alphaColor(colors.accent.green, '18') : colors.bg.tertiary,
                      border: `1px solid ${composerMode === 'voice' ? alphaColor(colors.accent.green, '40') : colors.border.default}`,
                      borderRadius: '10px',
                      color: composerMode === 'voice' ? colors.accent.green : colors.text.secondary,
                      '& .MuiChip-icon': { color: 'inherit' },
                      '&:hover': { bgcolor: composerMode === 'voice' ? alphaColor(colors.accent.green, '28') : colors.bg.primary },
                    }}
                  />
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>

        <ChildSessionDrawer
          open={!!childSessionDrawer}
          state={childSessionDrawer}
          parentSessionTitle={currentSessionTitle ?? undefined}
          onClose={() => setChildSessionDrawer(null)}
        />
      </Box>

      {/* ─── Right sidebar ─── */}
      <Box sx={{
        width: '15%', minWidth: 220, flexShrink: 0, borderLeft: `1px solid ${colors.border.default}`,
        display: 'flex', flexDirection: 'column', overflow: 'auto',
      }}>

        {/* ─── Context ─── */}
        <Box>
          <Box
            onClick={() => setContextExpanded(!contextExpanded)}
            sx={sidebarSectionHeaderSx(contextExpanded)}
          >
            <ArticleIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
                {contextExpanded ? '▾' : '▸'} CONTEXT
              </Typography>
              {contextData && (
                <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{contextData.length} chars</Typography>
              )}
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); handleRebuildContext(); }}
                disabled={rebuildingContext}
                sx={{ p: 0.25, width: 20, height: 20, color: rebuildingContext ? colors.accent.blue : colors.text.dim, '&:hover': { color: colors.accent.cyan } }}
              >
                <ReplayIcon sx={{ fontSize: 12, animation: rebuildingContext ? 'agentx-spin 1s linear infinite' : 'none' }} />
              </IconButton>
          </Box>
          {contextExpanded && (
            <Box sx={sidebarSectionContentSx}>
              {contextData ? (
                <Box sx={{ bgcolor: colors.bg.tertiary, borderRadius: 0.75, p: 1, maxHeight: 300, overflow: 'auto' }}>
                  <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {contextData}
                  </Typography>
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontStyle: 'italic' }}>No context yet</Typography>
              )}
            </Box>
          )}
        </Box>

        {/* ─── Token usage ─── */}
        <Box>
          <Box
            onClick={() => setTokenExpanded(!tokenExpanded)}
            sx={sidebarSectionHeaderWithDividerSx(tokenExpanded)}
          >
            <AutoGraphIcon sx={{ fontSize: 12, color: colors.accent.green }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
              {tokenExpanded ? '▾' : '▸'} TOKEN USAGE
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: tokenPercent > 80 ? colors.accent.red : colors.text.secondary }}>
              {Math.round(tokenPercent)}%
            </Typography>
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
              · {compactionCount} compact
            </Typography>
          </Box>
          {tokenExpanded && (
          <Box sx={sidebarSectionContentSx}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.primary }}>
              {tokenUsed.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
              / {tokenTotal.toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={tokenPercent}
            sx={{
              height: 4, borderRadius: 2, bgcolor: colors.bg.tertiary,
              '& .MuiLinearProgress-bar': {
                transition: 'transform 0.12s linear',
                bgcolor: tokenPercent > 80 ? colors.accent.red : tokenPercent > 50 ? colors.accent.orange : colors.accent.blue,
              },
            }}
          />
          <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Context limit</Typography>
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenTotal.toLocaleString()}
            </Typography>
          </Box>
          {(tokenStreaming > 0 || tokenReserved > 0) && (
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Stream / Reserved</Typography>
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenStreaming.toLocaleString()} / {tokenReserved.toLocaleString()}
            </Typography>
          </Box>
          )}
          <Box sx={{ mt: 0.75, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>In / Out</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenInput.toLocaleString()} / {tokenOutput.toLocaleString()}
            </Typography>
          </Box>
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Compactions</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: compactionCount > 0 ? colors.accent.orange : colors.text.secondary }}>
              {compactionCount}
            </Typography>
          </Box>
          {(tokenInputPrice > 0 || tokenOutputPrice > 0) && (
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Cost</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              ~${((tokenInput * tokenInputPrice + tokenOutput * tokenOutputPrice) / 1000000).toFixed(4)}
            </Typography>
          </Box>
          )}

          {currentSessionId && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SCOPE</Typography>
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, mt: 0.25, wordBreak: 'break-all', cursor: 'pointer', '&:hover': { color: colors.accent.blue } }}
                onClick={async () => {
                  pendingFolderActionRef.current = 'changeCwd';
                  setFolderConsentOpen(true);
                }}>
                {cwd.split('/').slice(-3).join('/') || cwd}
              </Typography>
            </Box>
          )}
          {currentSessionId && (
            <Box sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SESSION</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, wordBreak: 'break-all', flex: 1, opacity: copiedSessionId ? 0 : 1, transition: 'opacity 0.15s' }}>
                  {copiedSessionId ? '' : currentSessionId}
                </Typography>
                <Tooltip title="Copy session ID">
                  <Box onClick={() => {
                    void copyToClipboard(currentSessionId);
                    setCopiedSessionId(true);
                    setTimeout(() => setCopiedSessionId(false), 2000);
                  }} sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: copiedSessionId ? colors.accent.green : colors.text.dim, '&:hover': { color: copiedSessionId ? colors.accent.green : colors.text.primary } }}>
                    {copiedSessionId ? (
                      <span style={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>copied</span>
                    ) : (
                      <ContentCopyIcon sx={{ fontSize: 11 }} />
                    )}
                  </Box>
                </Tooltip>
              </Box>
            </Box>
          )}
          </Box>
          )}
        </Box>

        {/* ─── Crew Mission (not shown for Agent-X super-session) ─── */}
        {!isCrewPrivateSession && !coreSession && currentSessionId && (
        <Box>
          <Box
            onClick={() => setMissionExpanded(!missionExpanded)}
            sx={sidebarSectionHeaderWithDividerSx(missionExpanded)}
          >
            <GroupsIcon sx={{ fontSize: 12, color: crewTheme.accent.tactical }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {missionExpanded ? '▾' : '▸'} CREW MISSION
              {crewMissionActive && (
                <Box component="span" sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: crewTheme.accent.signal, boxShadow: `0 0 5px ${crewTheme.accent.signal}` }} />
              )}
            </Typography>
            {crewWorkers.length > 0 && (
              <Chip size="small" label={crewWorkers.length} sx={{ fontSize: '0.45rem', height: 15 }} />
            )}
            <Tooltip title="Add crew member" arrow>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); setCrewAddOpen((v) => !v); setCrewAddQuery(''); setCrewAddResults([]); }}
                sx={{ p: 0.25, width: 20, height: 20, color: crewAddOpen ? crewTheme.accent.tactical : colors.text.dim, '&:hover': { color: crewTheme.accent.tactical } }}
              >
                <AddIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {missionExpanded && (
          <Box sx={sidebarSectionContentSx}>
            {/* Manual add-crew search */}
            {crewAddOpen && (
              <Box sx={{ mb: 1, position: 'relative' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: colors.bg.tertiary, borderRadius: 0.75, px: 0.75, py: 0.4 }}>
                  <SearchIcon sx={{ fontSize: 11, color: colors.text.dim }} />
                  <input
                    autoFocus
                    value={crewAddQuery}
                    onChange={(e) => handleCrewAddSearch(e.target.value)}
                    placeholder="Search crew hub…"
                    style={{
                      flex: 1, border: 'none', outline: 'none', background: 'transparent',
                      fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
                      color: colors.text.secondary,
                    }}
                  />
                  {crewAddLoading && <CircularProgress size={9} sx={{ color: colors.text.dim }} />}
                </Box>
                {crewAddResults.length > 0 && (
                  <Box sx={{
                    mt: 0.25, maxHeight: 160, overflowY: 'auto',
                    border: `1px solid ${colors.border.default}`, borderRadius: 0.75,
                    bgcolor: colors.bg.secondary,
                  }}>
                    {crewAddResults.map((entry) => (
                      <Box
                        key={entry.id}
                        onClick={() => handleCrewAddSelect(entry)}
                        sx={{
                          px: 0.75, py: 0.5, cursor: 'pointer',
                          borderBottom: `1px solid ${colors.border.subtle}`,
                          '&:last-child': { borderBottom: 'none' },
                          '&:hover': { bgcolor: colors.bg.tertiary },
                        }}
                      >
                        <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
                          @{entry.callsign}
                        </Typography>
                        <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, mt: 0.15 }}>
                          {entry.title}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                {crewAddQuery.trim().length >= 2 && !crewAddLoading && crewAddResults.length === 0 && (
                  <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontStyle: 'italic', px: 0.75, py: 0.5 }}>
                    No matches
                  </Typography>
                )}
              </Box>
            )}

            {/* Worker list + comms (embedded, header-less) */}
            <CrewMissionCard
              workers={crewWorkers}
              missionActive={crewMissionActive}
              missionId={crewMissionId}
              interMessages={crewInterMessages}
              placement="embedded"
              showHeader={false}
              onViewWorker={(workerId, crewName) => openChildSession({
                childSessionId: workerId,
                label: crewName,
                kind: 'crew_worker',
              })}
              onRemoveWorker={handleCrewRemove}
            />

            {/* Empty state */}
            {crewWorkers.length === 0 && !crewMissionActive && (
              <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontStyle: 'italic', textAlign: 'center', py: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                No crew assigned — use + to add a specialist
              </Typography>
            )}
          </Box>
          )}
        </Box>
        )}

        {/* ─── Tasks ─── */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Box
            onClick={() => setTasksExpanded(!tasksExpanded)}
            sx={sidebarSectionHeaderWithDividerSx(tasksExpanded)}
          >
            <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
              {tasksExpanded ? '▾' : '▸'} TASKS
            </Typography>
            {todoItems.length > 0 && (
              <Chip size="small" label={`${todoItems.filter(t => t.status === 'completed').length}/${todoItems.length}`} sx={{ fontSize: '0.45rem', height: 15 }} />
            )}
          </Box>
          {tasksExpanded && (
          <Box sx={sidebarSectionContentSx}>

          {todoItems.map((item) => (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.3 }}>
              {item.status === 'completed' && <CheckCircle size={10} color={colors.accent.green} />}
              {item.status === 'in-progress' && <PlayCircleIcon sx={{ fontSize: 10, color: colors.accent.orange }} />}
              {item.status === 'not-started' && <RadioButtonUncheckedIcon sx={{ fontSize: 10, color: colors.text.dim }} />}
              <Typography sx={{
                fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary,
                textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                lineHeight: 1.3,
              }}>
                {item.title}
              </Typography>
            </Box>
          ))}

          {todoItems.length === 0 && (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.55rem', textAlign: 'center', mt: 3 }}>
              No active tasks
            </Typography>
          )}
        </Box>
        )}
      </Box>
      </Box>
      </>)}

      {/* ─── Global enhancement modals ─── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <SessionSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPickSession={(sid) => { navigate(`/console/chat/${sid}`); }}
      />
      <CheckpointDrawer
        open={checkpointsOpen}
        onClose={() => setCheckpointsOpen(false)}
        sessionId={currentSessionId}
        onRestored={async () => {
          try {
            const h = await chat.history();
            const visible = h.filter(m => m.role !== 'system');
            setMessages(visible.map(m => ({ ...m, streaming: false })));
            const totalUsed = visible.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenUsed(totalUsed);
            const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenInput(inputEst);
            setTokenOutput(outputEst);
          } catch { /* ignore */ }
        }}
      />
      <FolderPickerModal
        open={folderPickerOpen}
        onSelect={(path) => {
          setFolderPickerOpen(false);
          folderPickerCallback?.(path);
          setFolderPickerCallback(null);
        }}
        onCancel={() => { setFolderPickerOpen(false); setFolderPickerCallback(null); }}
      />
      <ModeEscalationModal
        open={!!modeEscalation && !isCrewPrivateSession}
        tool={modeEscalation?.tool ?? ''}
        reason={modeEscalation?.reason ?? ''}
        onSwitch={() => {
          agent.respondToModeEscalation(true).then(() => {
            setAgentMode('agent');
            sessionSettings.setMode('agent').catch(() => {});
          }).catch(() => {});
          setModeEscalation(null);
        }}
        onSkip={() => {
          agent.respondToModeEscalation(false).catch(() => {});
          setModeEscalation(null);
          setStreaming(false);
        }}
      />
      <CrewProfileDialog
        open={crewDossierOpen}
        crew={crewDossierCrew}
        imported={false}
        importLoading={false}
        onClose={() => { setCrewDossierOpen(false); setCrewDossierCrew(null); }}
        onImport={() => {}}
        onRemove={() => {}}
      />
      <ModeSuggestionModal
        open={modeSuggestOpen}
        onSwitch={() => {
          setModeSuggestOpen(false);
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void sendAfterModeChoice(text, true);
        }}
        onStay={() => {
          setModeSuggestOpen(false);
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void sendAfterModeChoice(text, false);
        }}
        onClose={() => {
          setModeSuggestOpen(false);
          pendingSendTextRef.current = null;
        }}
      />
      <StepCapModal
        open={!!stepCapPrompt}
        currentSteps={stepCapPrompt?.currentSteps ?? 25}
        maxSteps={stepCapPrompt?.maxSteps ?? 25}
        onContinue={() => {
          agent.respondToStepCap(true).catch(() => {});
          setStepCapPrompt(null);
        }}
        onStop={() => {
          agent.respondToStepCap(false).catch(() => {});
          setStepCapPrompt(null);
          setStreaming(false);
        }}
      />
      {/* Hyperdrive Disclaimer */}
      <Dialog
        open={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        PaperProps={{ sx: { bgcolor: hyperdrive.bg, border: `1px solid ${alphaColor(hyperdrive.magenta, '60')}`, borderRadius: 1, maxWidth: 520, width: '90%', boxShadow: `0 0 40px ${alphaColor(hyperdrive.magenta, '20')}, 0 0 80px ${alphaColor(hyperdrive.cyan, '10')}` } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '2px', color: hyperdrive.magenta, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: hyperdrive.magenta, boxShadow: `0 0 8px ${hyperdrive.magenta}`, animation: 'agentx-pulse 1s ease-in-out infinite' }} />
          HYPERDRIVE
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.7rem', lineHeight: 1.8, mb: 1.5 }}>
            You are about to engage <strong style={{ color: hyperdrive.magenta }}>Hyperdrive</strong> — full autonomous execution mode.
          </Typography>
          <Box sx={{ bgcolor: hyperdrive.panel, border: `1px solid ${alphaColor(hyperdrive.magenta, '30')}`, borderRadius: 1, p: 1.5, mb: 1.5 }}>
            <Typography sx={{ color: hyperdrive.magenta, fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", mb: 0.5, fontWeight: 600 }}>
              ⚠ WHAT THIS MEANS
            </Typography>
            <Typography sx={{ color: colors.text.dim, fontSize: '0.6rem', lineHeight: 1.7 }}>
              • All permission prompts are <strong style={{ color: hyperdrive.magenta }}>bypassed</strong><br />
              • The agent can execute <strong style={{ color: hyperdrive.magenta }}>any tool</strong> without asking<br />
              • File writes, shell commands, deletions — <strong style={{ color: hyperdrive.magenta }}>no questions asked</strong><br />
              • The agent operates at <strong style={{ color: hyperdrive.magenta }}>maximum autonomy</strong>
            </Typography>
          </Box>
          <Typography sx={{ color: hyperdrive.warning, fontSize: '0.6rem', fontWeight: 600, lineHeight: 1.6, mb: 1 }}>
            WARNING: Mistakes cannot be undone. Review the agent's task carefully. You are granting unrestricted access to your filesystem and shell.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setShowDisclaimer(false)} size="small" sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}>
            Cancel
          </Button>
          <Button
            onClick={confirmHyperdrive}
            size="small"
            sx={{
              color: hyperdrive.bg, bgcolor: hyperdrive.magenta, textTransform: 'none', fontSize: '0.65rem',
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
              '&:hover': { bgcolor: hyperdrive.hover },
              boxShadow: `0 0 12px ${alphaColor(hyperdrive.magenta, '40')}`,
            }}
          >
            ENGAGE HYPERDRIVE
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={folderConsentOpen}
        onClose={() => setFolderConsentOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 480, width: '90%' } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          BEFORE YOU START
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            Agent-X will access the folder you select to read, create, and modify files as needed to complete your tasks.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • Your files remain local — nothing is uploaded unless you explicitly use a tool that sends data to a provider.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • Agent-X can run terminal commands and modify files within the selected directory. Review what tasks you delegate.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • You can change the working directory at any time from the sidebar.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7 }}>
            • Switch between Agent (full autonomy with tool execution) and Plan (structured plan with step approval) modes in the toolbar.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFolderConsentOpen(false)} sx={{ color: colors.text.dim, fontSize: '0.75rem' }}>
            Cancel
          </Button>
          <Button onClick={handleFolderConsentConfirm} variant="contained" sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.75rem' }}>
            I Understand
          </Button>
        </DialogActions>
      </Dialog>
      {folderPickerLoading && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alphaColor(colors.bg.primary, 0.65), backdropFilter: 'blur(2px)' }}>
          <CircularProgress size={40} sx={{ color: colors.text.primary }} />
        </Box>
      )}

    </Box>
  );
}

// ─── Thinking Indicator ───

function LoadingStepsIndicator({ steps }: { steps: Array<{ id: string; label: string; status: string }> }) {
  const label = steps[0]?.label ?? 'Working...';
  return (
    <Typography sx={{
      fontSize: '0.75rem',
      fontWeight: 500,
      background: `linear-gradient(90deg, ${colors.text.dim} 0%, ${colors.text.primary} 50%, ${colors.text.dim} 100%)`,
      backgroundSize: '200% 100%',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      animation: 'agentx-shimmer 2s infinite linear',
    }}>
      {label}
    </Typography>
  );
}

function ThinkingIndicator({ label }: { label?: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: alphaColor(colors.accent.purple, '15'), mt: 0.5, flexShrink: 0,
      }}>
        <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        {label ? (
          <LoadingStepsIndicator steps={[{ id: '', label, status: 'running' }]} />
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 0.4 }}>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.2s infinite' }} />
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.4s infinite' }} />
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic' }}>Thinking...</Typography>
          </>
        )}
      </Box>
    </Box>
  );
}

// ─── Permission Banner ───

interface PermissionBannerProps {
  prompt: { requestId: string; tool: string; path: string; riskLevel: string; forAutomation?: boolean };
  pendingCount: number;
  onRespond: () => void;
  onApproveAll: () => void;
}

function PermissionBanner({ prompt, pendingCount, onRespond, onApproveAll }: PermissionBannerProps) {
  const handleRespond = async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await fetch('/api/permission/respond', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: prompt.requestId, choice }) });
    } catch { /* ignore */ }
    onRespond();
  };

  const handleApproveAll = async (choice: 'allow_once' | 'allow_always') => {
    try {
      await fetch('/api/permission/respond-batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    } catch { /* ignore */ }
    onApproveAll();
  };

  const isCritical = prompt.riskLevel === 'critical';
  const isHigh = prompt.riskLevel === 'high';
  const borderColor = isCritical ? alphaColor(colors.accent.red, '50') : isHigh ? alphaColor(colors.accent.orange, '40') : alphaColor(colors.accent.orange, '30');

  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: `1px solid ${borderColor}`, bgcolor: colors.bg.secondary, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue }}>
          {prompt.forAutomation ? 'Scheduled automation' : isCritical ? '⚠ Critical' : isHigh ? '⚡ High Risk' : 'Permission Required'}
        </Typography>
        <Chip size="small" label={prompt.riskLevel.toUpperCase()} sx={{
          fontSize: '0.45rem', height: 15, fontWeight: 600,
          bgcolor: isCritical ? alphaColor(colors.accent.red, '20') : isHigh ? alphaColor(colors.accent.orange, '20') : alphaColor(colors.accent.blue, '15'),
          color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue,
        }} />
        {pendingCount > 1 && (
          <Chip
            size="small"
            label={`Approve All (${pendingCount})`}
            onClick={() => handleApproveAll('allow_once')}
            sx={{ cursor: 'pointer', height: 15, fontSize: '0.45rem', bgcolor: alphaColor(colors.accent.green, '20'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '35') } }}
          />
        )}
      </Box>
      <Typography sx={{ fontSize: '0.6rem', mb: 0.5, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
        {prompt.tool}
      </Typography>
      {prompt.forAutomation && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim }}>
          Allow this tool for scheduled automations in this session.
        </Typography>
      )}
      {prompt.path && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim, wordBreak: 'break-all' }}>
          {prompt.path}
        </Typography>
      )}
      {pendingCount > 1 && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.orange }}>
          {pendingCount - 1} more permission request(s) pending
        </Typography>
      )}
      {isCritical && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.red, fontStyle: 'italic' }}>
          This operation could permanently affect your system. Review carefully before allowing.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {!prompt.forAutomation && (
          <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.green, '15'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '30') } }} />
        )}
        <Chip size="small" label={prompt.forAutomation ? 'Allow for automations' : 'Always'} onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.blue, '15'), color: colors.accent.blue, '&:hover': { bgcolor: alphaColor(colors.accent.blue, '30') } }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.red, '15'), color: colors.accent.red, '&:hover': { bgcolor: alphaColor(colors.accent.red, '30') } }} />
      </Box>
    </Box>
  );
}

// ─── Tool Enable Banner ───

function ToolEnableBanner({ toolId, toolName, onRespond }: { toolId: string; toolName: string; onRespond: () => void }) {
  const handleEnable = async () => {
    try { await tools.toggle(toolId, true); } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${alphaColor(colors.accent.purple, '30')}`, bgcolor: alphaColor(colors.accent.purple, '05'), animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.purple, mb: 0.5 }}>Tool Disabled</Typography>
      <Typography sx={{ fontSize: '0.6rem', mb: 1, color: colors.text.secondary }}>
        The agent needs <strong>{toolName}</strong> but it&apos;s disabled.
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Enable" onClick={handleEnable} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.green, '12'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '25') } }} />
        <Chip size="small" label="Keep Disabled" onClick={onRespond} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.red, '12'), color: colors.accent.red, '&:hover': { bgcolor: alphaColor(colors.accent.red, '25') } }} />
      </Box>
    </Box>
  );
}
