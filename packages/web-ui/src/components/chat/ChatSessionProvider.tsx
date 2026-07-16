import type { ReactNode } from 'react';

export interface ChatSessionProviderProps {
  sessionId?: string;
  coreSession?: boolean;
  children: ReactNode;
}

import { createContext, useContext, useMemo } from 'react';
import { useChatSessionState } from './useChatSessionState';

type ChatSessionStateReturn = ReturnType<typeof useChatSessionState>;

// ─── Message thread keys ───
const MESSAGE_KEYS = [
  'messages', 'streaming', 'sessionRestoring',
  'currentStep', 'turnActivity', 'loadingSteps',
  'pendingFeedbackMessageId', 'feedbackSubmitting',
  'showJumpPill', 'loadingOlderMessages', 'hasOlderMessages',
  'freezeMessageLayout', 'initialScrollDone',
  'warnings',
] as const;

type MessageKey = typeof MESSAGE_KEYS[number];
type Messages = Pick<ChatSessionStateReturn, MessageKey>;

// ─── Token keys ───
const TOKEN_KEYS = [
  'tokenUsed', 'tokenInput', 'tokenOutput', 'tokenReserved',
  'tokenStreaming', 'tokenTotal', 'compactionCount', 'tokenPercent',
] as const;

type TokenKey = typeof TOKEN_KEYS[number];
type Tokens = Pick<ChatSessionStateReturn, TokenKey>;

// ─── Crew keys ───
const CREW_KEYS = [
  'crewWorkers', 'crewMissionActive', 'crewMissionId', 'crewInterMessages',
] as const;

type CrewKey = typeof CREW_KEYS[number];
type Crew = Pick<ChatSessionStateReturn, CrewKey>;

// ─── Connection keys ───
const CONNECTION_KEYS = [
  'connState', 'lastEventAt',
] as const;

type ConnectionKey = typeof CONNECTION_KEYS[number];
type Connection = Pick<ChatSessionStateReturn, ConnectionKey>;

// ─── Prompt keys ───
const PROMPT_KEYS = [
  'permissionPrompt', 'pendingPermissionCount', 'toolEnablePrompt',
] as const;

type PromptKey = typeof PROMPT_KEYS[number];
type Prompts = Pick<ChatSessionStateReturn, PromptKey>;

// ─── View / drawer keys ───
const VIEW_KEYS = [
  'view', 'childSessionDrawer',
] as const;

type ViewKey = typeof VIEW_KEYS[number];
type View = Pick<ChatSessionStateReturn, ViewKey>;

// ─── Session identity keys ───
const SESSION_IDENTITY_KEYS = [
  'currentSessionTitle', 'currentSessionId', 'parentSessionId', 'coreSession',
] as const;

type SessionIdentityKey = typeof SESSION_IDENTITY_KEYS[number];
type SessionIdentity = Pick<ChatSessionStateReturn, SessionIdentityKey>;

// ─── Session privacy keys ───
const SESSION_PRIVACY_KEYS = [
  'isCrewPrivateSession', 'crewPrivateHost', 'privateHostCrewId',
] as const;

type SessionPrivacyKey = typeof SESSION_PRIVACY_KEYS[number];
type SessionPrivacy = Pick<ChatSessionStateReturn, SessionPrivacyKey>;

// ─── Session list keys ───
const SESSION_LIST_KEYS = [
  'sessionList', 'sessionListTab', 'filteredSessionList',
  'agentSessionCount', 'crewPrivateSessionCount',
] as const;

type SessionListKey = typeof SESSION_LIST_KEYS[number];
type SessionList = Pick<ChatSessionStateReturn, SessionListKey>;

// ─── Model / provider data keys ───
const MODEL_DATA_KEYS = [
  'currentModel', 'currentProvider', 'currentProviderId',
  'providerList', 'modelList', 'loadingModels', 'configLoaded',
] as const;

type ModelDataKey = typeof MODEL_DATA_KEYS[number];
type ModelData = Pick<ChatSessionStateReturn, ModelDataKey>;

// ─── Model / provider menu keys ───
const MODEL_MENU_KEYS = [
  'providerMenuAnchor', 'modelMenuAnchor',
] as const;

type ModelMenuKey = typeof MODEL_MENU_KEYS[number];
type ModelMenu = Pick<ChatSessionStateReturn, ModelMenuKey>;

// ─── Input gate keys ───
const INPUT_GATE_KEYS = [
  'sendBlocked', 'sendBlockedReason', 'questionnairePending',
] as const;

type InputGateKey = typeof INPUT_GATE_KEYS[number];
type InputGate = Pick<ChatSessionStateReturn, InputGateKey>;

// ─── Composer keys ───
const COMPOSER_KEYS = [
  'attachments', 'composerMode', 'voiceAutoStart',
  'webSearchAvailable', 'webSearchForce', 'crewSuggestionRequested',
  'voiceCtx', 'inputClearSignal',
] as const;

type ComposerKey = typeof COMPOSER_KEYS[number];
type Composer = Pick<ChatSessionStateReturn, ComposerKey>;

// ─── Crew list keys ───
const CREW_LIST_KEYS = [
  'crewList',
] as const;

type CrewListKey = typeof CREW_LIST_KEYS[number];
type CrewList = Pick<ChatSessionStateReturn, CrewListKey>;

// ─── Bypass permissions keys ───
const BYPASS_PERMISSIONS_KEYS = [
  'bypassPermissions', 'toolPermissions',
] as const;

type BypassPermissionsKey = typeof BYPASS_PERMISSIONS_KEYS[number];
type BypassPermissions = Pick<ChatSessionStateReturn, BypassPermissionsKey>;

// ─── Crew add / search keys ───
const CREW_ADD_KEYS = [
  'crewAddOpen', 'crewAddQuery', 'crewAddResults', 'crewAddLoading',
] as const;

type CrewAddKey = typeof CREW_ADD_KEYS[number];
type CrewAdd = Pick<ChatSessionStateReturn, CrewAddKey>;

// ─── Sidebar keys ───
const SIDEBAR_KEYS = [
  'contextExpanded', 'contextData', 'rebuildingContext',
  'tokenExpanded', 'tasksExpanded', 'missionExpanded',
  'todoItems', 'cwd',
] as const;

type SidebarKey = typeof SIDEBAR_KEYS[number];
type Sidebar = Pick<ChatSessionStateReturn, SidebarKey>;

// ─── Modal keys ───
const MODAL_KEYS = [
  'paletteOpen', 'searchOpen', 'checkpointsOpen',
  'folderPickerOpen', 'folderPickerCallback', 'folderConsentOpen', 'folderPickerLoading',
  'stepCapPrompt',
  'crewDossierOpen', 'crewDossierCrew',
  'clearSessionModalOpen', 'clearSessionBusy',
  'paletteActions',
] as const;

type ModalKey = typeof MODAL_KEYS[number];
type Modal = Pick<ChatSessionStateReturn, ModalKey>;



// ─── Setter / stable ref keys (setters, refs, and UI-stable utilities) ───
const SETTER_KEYS = [
  'navigate', 'setSearchParams', 'setSessionListTab',
  'setView', 'setSessionList', 'setCurrentSessionTitle', 'setCurrentSessionId',
  'setIsCrewPrivateSession', 'setCrewPrivateHost', 'setPrivateHostCrewId',
  'setParentSessionId', 'setChildSessionDrawer',
  'setMessages', 'setStreaming', 'setSessionRestoring',
  'setPermissionPrompt', 'setPendingPermissionCount', 'setToolEnablePrompt',
  'setAttachments', 'setLoadingSteps', 'setWarnings',
  'setTokenUsed', 'setTokenInput', 'setTokenOutput', 'setTokenReserved',
  'setTokenStreaming', 'setTokenTotal', 'setCompactionCount',
  'setTurnActivity', 'setPendingFeedbackMessageId', 'setFeedbackSubmitting', 'setCurrentStep',
  'setShowJumpPill', 'setHasOlderMessages', 'setLoadingOlderMessages',
  'setFreezeMessageLayout', 'setInitialScrollDone',
  'setCurrentModel', 'setCurrentProvider', 'setCurrentProviderId',
  'setProviderList', 'setModelList', 'setLoadingModels', 'setConfigLoaded',
  'setCrewList',
  'setBypassPermissions', 'toggleBypassPermissions', 'revokeSessionPermissions', 'setToolPermission',
  'setCwd',
  'setProviderMenuAnchor', 'setModelMenuAnchor',
  'setConnState', 'setLastEventAt',
  'setPaletteOpen', 'setSearchOpen', 'setCheckpointsOpen',
  'setFolderPickerOpen', 'setFolderPickerCallback', 'setFolderConsentOpen', 'setFolderPickerLoading',
  'setStepCapPrompt',
  'setCrewDossierOpen', 'setCrewDossierCrew',
  'setClearSessionModalOpen', 'setClearSessionBusy',
  'setWebSearchAvailable', 'setWebSearchForce', 'setCrewSuggestionRequested',
  'setComposerMode', 'setVoiceAutoStart',
  'setTodoItems', 'setContextData', 'setRebuildingContext',
  'setContextExpanded', 'setTokenExpanded', 'setTasksExpanded', 'setMissionExpanded',
  'setCrewAddQuery', 'setCrewAddResults', 'setCrewAddOpen', 'setCrewAddLoading',
  'messagesContainerRef', 'bottomRef', 'fileInputRef', 'inputBarRef',
  'isCrewPrivateRef', 'crewPrivateHostRef', 'currentSessionIdRef', 'viewSessionIdRef',
  'cwdRef', 'chatReturnToRef', 'pendingFolderActionRef', 'tokenReservedRef',
  'pendingSendTextRef', 'jumpSuppressScrollTopRef',
  'scrollMessagesToBottom', 'ensureSession', 'ensureDefaultCwd',
] as const;

type SetterKey = typeof SETTER_KEYS[number];
type Setters = Pick<ChatSessionStateReturn, SetterKey>;

// ─── Input handler keys ───
const INPUT_HANDLER_KEYS = [
  'handleSend', 'handleCancel', 'handleStopAndSend', 'handleAddToQueue', 'handleSteer',
  'handleFileSelect', 'handleRemoveAttachment',
  'handlePermissionRespond', 'handlePermissionRespondBatch',
  'handleWebSearchToggle', 'handleCrewSuggestionToggle',
  'handleVoiceUserPending', 'handleVoiceUserDiscarded', 'handleVoiceTranscript', 'handleVoiceTiming',
] as const;

type InputHandlerKey = typeof INPUT_HANDLER_KEYS[number];
type InputHandlers = Pick<ChatSessionStateReturn, InputHandlerKey>;

// ─── Thread handler keys ───
const THREAD_HANDLER_KEYS = [
  'handleResend', 'handleQuestionnaireRespond',
  'handleCrewRosterPickerSubmit', 'handleCrewRosterPickerSkip',
  'handleTurnFeedback', 'handleSaveMarkdown', 'handleViewCrewDossier',
] as const;

type ThreadHandlerKey = typeof THREAD_HANDLER_KEYS[number];
type ThreadHandlers = Pick<ChatSessionStateReturn, ThreadHandlerKey>;

// ─── Crew handler keys ───
const CREW_HANDLER_KEYS = [
  'handleCrewAddSearch', 'handleCrewAddSelect', 'handleCrewRemove', 'handleRebuildContext',
] as const;

type CrewHandlerKey = typeof CREW_HANDLER_KEYS[number];
type CrewHandlers = Pick<ChatSessionStateReturn, CrewHandlerKey>;

// ─── Navigation handler keys ───
const NAVIGATION_HANDLER_KEYS = [
  'handleShowSessions', 'handleSelectSession', 'handleNewSession',
  'handleArchiveSession', 'handleDeleteSessionContent', 'handleDeleteSession',
  'handleFolderConsentConfirm', 'openChildSession',
] as const;

type NavigationHandlerKey = typeof NAVIGATION_HANDLER_KEYS[number];
type NavigationHandlers = Pick<ChatSessionStateReturn, NavigationHandlerKey>;

// ─── Modal action keys ───
const MODAL_ACTION_KEYS = [] as const;

type ModalActionKey = typeof MODAL_ACTION_KEYS[number];
type ModalActions = Pick<ChatSessionStateReturn, ModalActionKey>;

// ─── Contexts ───
export const ChatMessagesContext = createContext<Messages | undefined>(undefined);
export const ChatTokenContext = createContext<Tokens | undefined>(undefined);
export const ChatCrewContext = createContext<Crew | undefined>(undefined);
export const ChatConnectionContext = createContext<Connection | undefined>(undefined);
export const ChatPromptsContext = createContext<Prompts | undefined>(undefined);
export const ChatViewContext = createContext<View | undefined>(undefined);
export const ChatSessionIdentityContext = createContext<SessionIdentity | undefined>(undefined);
export const ChatSessionPrivacyContext = createContext<SessionPrivacy | undefined>(undefined);
export const ChatSessionListContext = createContext<SessionList | undefined>(undefined);
export const ChatModelDataContext = createContext<ModelData | undefined>(undefined);
export const ChatModelMenuContext = createContext<ModelMenu | undefined>(undefined);
export const ChatInputGateContext = createContext<InputGate | undefined>(undefined);
export const ChatComposerContext = createContext<Composer | undefined>(undefined);
export const ChatCrewListContext = createContext<CrewList | undefined>(undefined);
export const ChatBypassPermissionsContext = createContext<BypassPermissions | undefined>(undefined);
export const ChatCrewAddContext = createContext<CrewAdd | undefined>(undefined);
export const ChatSidebarContext = createContext<Sidebar | undefined>(undefined);
export const ChatModalContext = createContext<Modal | undefined>(undefined);
export const ChatSessionSettersContext = createContext<Setters | undefined>(undefined);
export const ChatInputHandlersContext = createContext<InputHandlers | undefined>(undefined);
export const ChatThreadHandlersContext = createContext<ThreadHandlers | undefined>(undefined);
export const ChatCrewHandlersContext = createContext<CrewHandlers | undefined>(undefined);
export const ChatNavigationHandlersContext = createContext<NavigationHandlers | undefined>(undefined);
export const ChatModalActionsContext = createContext<ModalActions | undefined>(undefined);

export function ChatSessionProvider({ sessionId, coreSession, children }: ChatSessionProviderProps) {
  const state = useChatSessionState(sessionId, coreSession);

  // Streaming slices
  const messages = useMemo(() => {
    return Object.fromEntries(MESSAGE_KEYS.map((k) => [k, state[k]])) as Messages;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, MESSAGE_KEYS.map((k) => state[k]));

  const tokens = useMemo(() => {
    return Object.fromEntries(TOKEN_KEYS.map((k) => [k, state[k]])) as Tokens;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, TOKEN_KEYS.map((k) => state[k]));

  const crew = useMemo(() => {
    return Object.fromEntries(CREW_KEYS.map((k) => [k, state[k]])) as Crew;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, CREW_KEYS.map((k) => state[k]));

  const connection = useMemo(() => {
    return Object.fromEntries(CONNECTION_KEYS.map((k) => [k, state[k]])) as Connection;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, CONNECTION_KEYS.map((k) => state[k]));

  const prompts = useMemo(() => {
    return Object.fromEntries(PROMPT_KEYS.map((k) => [k, state[k]])) as Prompts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, PROMPT_KEYS.map((k) => state[k]));

  // Low-frequency slices
  const view = useMemo(() => {
    return Object.fromEntries(VIEW_KEYS.map((k) => [k, state[k]])) as View;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, VIEW_KEYS.map((k) => state[k]));

  const sessionIdentity = useMemo(() => {
    return Object.fromEntries(SESSION_IDENTITY_KEYS.map((k) => [k, state[k]])) as SessionIdentity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, SESSION_IDENTITY_KEYS.map((k) => state[k]));

  const sessionPrivacy = useMemo(() => {
    return Object.fromEntries(SESSION_PRIVACY_KEYS.map((k) => [k, state[k]])) as SessionPrivacy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, SESSION_PRIVACY_KEYS.map((k) => state[k]));

  const sessionList = useMemo(() => {
    return Object.fromEntries(SESSION_LIST_KEYS.map((k) => [k, state[k]])) as SessionList;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, SESSION_LIST_KEYS.map((k) => state[k]));

  const modelData = useMemo(() => {
    return Object.fromEntries(MODEL_DATA_KEYS.map((k) => [k, state[k]])) as ModelData;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, MODEL_DATA_KEYS.map((k) => state[k]));

  const modelMenu = useMemo(() => {
    return Object.fromEntries(MODEL_MENU_KEYS.map((k) => [k, state[k]])) as ModelMenu;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, MODEL_MENU_KEYS.map((k) => state[k]));

  const inputGate = useMemo(() => {
    return Object.fromEntries(INPUT_GATE_KEYS.map((k) => [k, state[k]])) as InputGate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, INPUT_GATE_KEYS.map((k) => state[k]));

  const composer = useMemo(() => {
    return Object.fromEntries(COMPOSER_KEYS.map((k) => [k, state[k]])) as Composer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, COMPOSER_KEYS.map((k) => state[k]));

  const crewList = useMemo(() => {
    return Object.fromEntries(CREW_LIST_KEYS.map((k) => [k, state[k]])) as CrewList;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, CREW_LIST_KEYS.map((k) => state[k]));

  const bypassPermissions = useMemo(() => {
    return Object.fromEntries(BYPASS_PERMISSIONS_KEYS.map((k) => [k, state[k]])) as BypassPermissions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, BYPASS_PERMISSIONS_KEYS.map((k) => state[k]));

  const crewAdd = useMemo(() => {
    return Object.fromEntries(CREW_ADD_KEYS.map((k) => [k, state[k]])) as CrewAdd;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, CREW_ADD_KEYS.map((k) => state[k]));

  const sidebar = useMemo(() => {
    return Object.fromEntries(SIDEBAR_KEYS.map((k) => [k, state[k]])) as Sidebar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, SIDEBAR_KEYS.map((k) => state[k]));

  const modal = useMemo(() => {
    return Object.fromEntries(MODAL_KEYS.map((k) => [k, state[k]])) as Modal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, MODAL_KEYS.map((k) => state[k]));

  // Dispatch slices
  const setters = useMemo(() => {
    return Object.fromEntries(SETTER_KEYS.map((k) => [k, state[k]])) as Setters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, SETTER_KEYS.map((k) => state[k]));

  const inputHandlers = useMemo(() => {
    return Object.fromEntries(INPUT_HANDLER_KEYS.map((k) => [k, state[k]])) as InputHandlers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, INPUT_HANDLER_KEYS.map((k) => state[k]));

  const threadHandlers = useMemo(() => {
    return Object.fromEntries(THREAD_HANDLER_KEYS.map((k) => [k, state[k]])) as ThreadHandlers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, THREAD_HANDLER_KEYS.map((k) => state[k]));

  const crewHandlers = useMemo(() => {
    return Object.fromEntries(CREW_HANDLER_KEYS.map((k) => [k, state[k]])) as CrewHandlers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, CREW_HANDLER_KEYS.map((k) => state[k]));

  const navigationHandlers = useMemo(() => {
    return Object.fromEntries(NAVIGATION_HANDLER_KEYS.map((k) => [k, state[k]])) as NavigationHandlers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, NAVIGATION_HANDLER_KEYS.map((k) => state[k]));

  const modalActions = useMemo(() => {
    return Object.fromEntries(MODAL_ACTION_KEYS.map((k) => [k, state[k]])) as ModalActions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, MODAL_ACTION_KEYS.map((k) => state[k]));

  return (
    <ChatMessagesContext.Provider value={messages}>
      <ChatTokenContext.Provider value={tokens}>
        <ChatCrewContext.Provider value={crew}>
          <ChatConnectionContext.Provider value={connection}>
            <ChatPromptsContext.Provider value={prompts}>
              <ChatViewContext.Provider value={view}>
                <ChatSessionIdentityContext.Provider value={sessionIdentity}>
                  <ChatSessionPrivacyContext.Provider value={sessionPrivacy}>
                    <ChatSessionListContext.Provider value={sessionList}>
                      <ChatModelDataContext.Provider value={modelData}>
                        <ChatModelMenuContext.Provider value={modelMenu}>
                          <ChatInputGateContext.Provider value={inputGate}>
                            <ChatComposerContext.Provider value={composer}>
                              <ChatCrewListContext.Provider value={crewList}>
                                <ChatBypassPermissionsContext.Provider value={bypassPermissions}>
                                  <ChatCrewAddContext.Provider value={crewAdd}>
                                    <ChatSidebarContext.Provider value={sidebar}>
                                      <ChatModalContext.Provider value={modal}>
                                        <ChatSessionSettersContext.Provider value={setters}>
                                          <ChatInputHandlersContext.Provider value={inputHandlers}>
                                            <ChatThreadHandlersContext.Provider value={threadHandlers}>
                                              <ChatCrewHandlersContext.Provider value={crewHandlers}>
                                                <ChatNavigationHandlersContext.Provider value={navigationHandlers}>
                                                  <ChatModalActionsContext.Provider value={modalActions}>
                                                    {children}
                                                  </ChatModalActionsContext.Provider>
                                                </ChatNavigationHandlersContext.Provider>
                                              </ChatCrewHandlersContext.Provider>
                                            </ChatThreadHandlersContext.Provider>
                                          </ChatInputHandlersContext.Provider>
                                        </ChatSessionSettersContext.Provider>
                                      </ChatModalContext.Provider>
                                    </ChatSidebarContext.Provider>
                                  </ChatCrewAddContext.Provider>
                                </ChatBypassPermissionsContext.Provider>
                              </ChatCrewListContext.Provider>
                            </ChatComposerContext.Provider>
                          </ChatInputGateContext.Provider>
                        </ChatModelMenuContext.Provider>
                      </ChatModelDataContext.Provider>
                    </ChatSessionListContext.Provider>
                  </ChatSessionPrivacyContext.Provider>
                </ChatSessionIdentityContext.Provider>
              </ChatViewContext.Provider>
            </ChatPromptsContext.Provider>
          </ChatConnectionContext.Provider>
        </ChatCrewContext.Provider>
      </ChatTokenContext.Provider>
    </ChatMessagesContext.Provider>
  );
}

/** Access high-frequency message thread values. */
export function useChatMessagesContext() {
  const ctx = useContext(ChatMessagesContext);
  if (!ctx) throw new Error('useChatMessagesContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access high-frequency token usage values. */
export function useChatTokenContext() {
  const ctx = useContext(ChatTokenContext);
  if (!ctx) throw new Error('useChatTokenContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access high-frequency crew mission values. */
export function useChatCrewContext() {
  const ctx = useContext(ChatCrewContext);
  if (!ctx) throw new Error('useChatCrewContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access connection health values. */
export function useChatConnectionContext() {
  const ctx = useContext(ChatConnectionContext);
  if (!ctx) throw new Error('useChatConnectionContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access transient permission / tool-enable prompts. */
export function useChatPromptsContext() {
  const ctx = useContext(ChatPromptsContext);
  if (!ctx) throw new Error('useChatPromptsContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access view / drawer state. */
export function useChatViewContext() {
  const ctx = useContext(ChatViewContext);
  if (!ctx) throw new Error('useChatViewContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access session identity values. */
export function useChatSessionIdentityContext() {
  const ctx = useContext(ChatSessionIdentityContext);
  if (!ctx) throw new Error('useChatSessionIdentityContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access session privacy values. */
export function useChatSessionPrivacyContext() {
  const ctx = useContext(ChatSessionPrivacyContext);
  if (!ctx) throw new Error('useChatSessionPrivacyContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access session list values. */
export function useChatSessionListContext() {
  const ctx = useContext(ChatSessionListContext);
  if (!ctx) throw new Error('useChatSessionListContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access model / provider data values. */
export function useChatModelDataContext() {
  const ctx = useContext(ChatModelDataContext);
  if (!ctx) throw new Error('useChatModelDataContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access model / provider menu anchor values. */
export function useChatModelMenuContext() {
  const ctx = useContext(ChatModelMenuContext);
  if (!ctx) throw new Error('useChatModelMenuContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access input gate values. */
export function useChatInputGateContext() {
  const ctx = useContext(ChatInputGateContext);
  if (!ctx) throw new Error('useChatInputGateContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access composer values. */
export function useChatComposerContext() {
  const ctx = useContext(ChatComposerContext);
  if (!ctx) throw new Error('useChatComposerContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access crew list values. */
export function useChatCrewListContext() {
  const ctx = useContext(ChatCrewListContext);
  if (!ctx) throw new Error('useChatCrewListContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access bypass permissions state. */
export function useChatBypassPermissionsContext() {
  const ctx = useContext(ChatBypassPermissionsContext);
  if (!ctx) throw new Error('useChatBypassPermissionsContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access crew add / search values. */
export function useChatCrewAddContext() {
  const ctx = useContext(ChatCrewAddContext);
  if (!ctx) throw new Error('useChatCrewAddContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access sidebar values. */
export function useChatSidebarContext() {
  const ctx = useContext(ChatSidebarContext);
  if (!ctx) throw new Error('useChatSidebarContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access modal state values. */
export function useChatModalContext() {
  const ctx = useContext(ChatModalContext);
  if (!ctx) throw new Error('useChatModalContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access stable setter / ref / utility values. */
export function useChatSessionSettersContext() {
  const ctx = useContext(ChatSessionSettersContext);
  if (!ctx) throw new Error('useChatSessionSettersContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access input handlers. */
export function useChatInputHandlersContext() {
  const ctx = useContext(ChatInputHandlersContext);
  if (!ctx) throw new Error('useChatInputHandlersContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access thread handlers. */
export function useChatThreadHandlersContext() {
  const ctx = useContext(ChatThreadHandlersContext);
  if (!ctx) throw new Error('useChatThreadHandlersContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access crew handlers. */
export function useChatCrewHandlersContext() {
  const ctx = useContext(ChatCrewHandlersContext);
  if (!ctx) throw new Error('useChatCrewHandlersContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access navigation handlers. */
export function useChatNavigationHandlersContext() {
  const ctx = useContext(ChatNavigationHandlersContext);
  if (!ctx) throw new Error('useChatNavigationHandlersContext must be used within ChatSessionProvider');
  return ctx;
}

/** Access modal action handlers. */
export function useChatModalActionsContext() {
  const ctx = useContext(ChatModalActionsContext);
  if (!ctx) throw new Error('useChatModalActionsContext must be used within ChatSessionProvider');
  return ctx;
}
