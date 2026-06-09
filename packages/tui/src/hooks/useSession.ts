import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, EngineEvent, AgentXConfig, ModelInfo, RemediationAction, ProviderId, Crew, TodoItem, Plan } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { Agent, CommandParser, createDefaultRegistry, ConfigManager, SessionStore, TelegramBridge, TelegramStore } from '@agentx/engine';
import type { StorageAdapter } from '@agentx/engine';
import { VisualStateManager } from '@agentx/engine';
import type { VisualState } from '@agentx/engine';
import { generateSessionId, generateMessageId } from '@agentx/shared';
import { SessionManager } from '@agentx/engine';
import { copyToClipboard } from '../utils/clipboard.js';

interface PermissionRequest {
  tool: string;
  path?: string;
  riskLevel: string;
}

interface UseSessionReturn {
  messages: Message[];
  streamingContent: string;
  isLoading: boolean;
  tokensUsed: number;
  tokensTotal: number;
  error: string | null;
  errorActions: RemediationAction[];
  sendMessage: (content: string) => void;
  cancelProcessing: () => void;
  handleErrorAction: (action: RemediationAction) => void;
  dismissError: () => void;
  sessionId: string;
  modelPickerModels: ModelInfo[] | null;
  currentModel: string;
  selectModel: (model: ModelInfo) => void;
  dismissModelPicker: () => void;
  commandNames: string[];
  commandList: Array<{ name: string; description: string }>;
  showProviderPicker: boolean;
  selectProvider: (providerId: ProviderId, modelId: string, contextWindow: number, apiKey?: string, baseUrl?: string) => void;
  dismissProviderPicker: () => void;
  permissionRequest: PermissionRequest | null;
  respondToPermission: (choice: 'allow_once' | 'allow_always' | 'deny') => void;
  todoItems: TodoItem[];
  reasoningText: string;
  isReasoning: boolean;
  activeTools: Array<{ id: string; tool: string; description: string; startTime: number }>;
  subAgents: Array<{ agentId: string; name: string; status: string; startTime: number; summary?: string; endTime?: number }>;
  currentPlan: Plan | null;
  visualState: VisualState | null;
  planMode: boolean;
  toolCount: number;
  approvePlan: () => void;
  rejectPlan: () => void;
  approveStep: (stepId: string) => void;
  skipStep: (stepId: string) => void;
  modifyStep: (stepId: string, description: string) => void;
  togglePlanStep: (stepId: string) => void;
  cancelPlan: () => void;
  togglePlanMode: () => void;
  messageCount: number;
  sessionCreatedAt: string;
  totalCost: number;
  watcherCount: number;
  schedulerCount: number;
  ragIndexStats: { indexedCount: number; indexedAt: number | null };
  currentTaskType: string | null;
  pendingDiff: { tool: string; filePath: string; diff: string } | null;
  isIndexing: boolean;
  indexingProgress: { indexed: number; total: number } | null;
  focusChannel: string | null;
  setFocusChannel: (channel: string) => void;
  setCrewEnabled: (crewId: string, enabled: boolean) => void;
}

const DAEMON_PORT = parseInt(process.env['AGENTX_PORT'] ?? '3333', 10);
const DAEMON_WS_URL = `ws://127.0.0.1:${DAEMON_PORT}/ws`;
const DAEMON_API = `http://127.0.0.1:${DAEMON_PORT}`;

export function useSession(
  config: AgentXConfig,
  _crew?: Crew,
  restoreSessionId?: string,
  storageAdapter?: StorageAdapter | null,
  externalTelegramBridge?: TelegramBridge | null,
  initialPlanMode?: boolean,
  fallbackModel?: string,
  maxBudget?: number,
  gitAutoCommit?: boolean,
  gitAware?: boolean,
  externalDaemonMode?: boolean,
): UseSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState<Array<{ id: string; label: string; status: string }> | null>(null);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [tokensTotal, setTokensTotal] = useState(128_000);
  const [error, setError] = useState<string | null>(null);
  const [errorActions, setErrorActions] = useState<RemediationAction[]>([]);
  const [sessionId] = useState(() => restoreSessionId ?? generateSessionId());
  const [sessionCreatedAt] = useState(() => new Date().toISOString());
  const [currentModel, setCurrentModel] = useState(config.provider.activeModel);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [activeTools, setActiveTools] = useState<Array<{ id: string; tool: string; description: string; startTime: number }>>([]);
  const [subAgents, setSubAgents] = useState<Array<{ agentId: string; name: string; status: string; startTime: number; summary?: string; endTime?: number }>>([]);
  const [modelPickerModels, setModelPickerModels] = useState<ModelInfo[] | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [planMode, setPlanModeState] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Array<{ label: string; messages: Message[]; createdAt: string }>>([]);
  const [pendingDiff, setPendingDiff] = useState<{ tool: string; filePath: string; diff: string } | null>(null);
  const [_awaitingStepApproval, setAwaitingStepApproval] = useState(false);
  const [_pendingStepId, setPendingStepId] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<{ indexed: number; total: number } | null>(null);
  const [focusChannel, setFocusChannelState] = useState<string | null>(null);
  const [daemonMode, setDaemonMode] = useState(false);

  const agentRef = useRef<Agent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const configRef = useRef<AgentXConfig>(config);
  const sessionStoreRef = useRef<SessionStore | SessionManager>(
    storageAdapter ? new SessionManager({ storageAdapter }) : new SessionStore(),
  );
  const commandParserRef = useRef(new CommandParser());
  const commandRegistryRef = useRef(createDefaultRegistry());
  const lastUserMessageRef = useRef<string>('');
  const telegramBridgeRef = useRef<TelegramBridge | null>(null);
  const telegramStoreRef = useRef<TelegramStore>(new TelegramStore());
  const currentModelRef = useRef(config.provider.activeModel);
  const maxBudgetRef = useRef(maxBudget ?? 0);
  const budgetWarningShownRef = useRef(false);
  const prevCostRef = useRef(0);
  const latestContentRef = useRef('');
  const streamingScheduledRef = useRef(false);
  const visualStateManagerRef = useRef(new VisualStateManager());
  const [visualState, setVisualState] = useState<VisualState | null>(null);
  const sendWsRef = useRef<(data: Record<string, unknown>) => void>(() => {});

  // Keep model ref in sync
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);

  // Check daemon focus status periodically
  useEffect(() => {
    let cancelled = false;
    async function pollDaemonFocus() {
      try {
        const res = await fetch(`${DAEMON_API}/api/gateway/focus`, { signal: AbortSignal.timeout(2000) });
        if (!cancelled && res.ok) {
          const data = await res.json() as { focus?: string };
          if (data.focus) setFocusChannelState(data.focus);
        }
      } catch {
        // daemon not running
      }
    }
    pollDaemonFocus();
    const interval = setInterval(pollDaemonFocus, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Update budget ref
  useEffect(() => { maxBudgetRef.current = maxBudget ?? 0; }, [maxBudget]);

  // Sync external telegram bridge
  useEffect(() => {
    if (externalTelegramBridge && externalTelegramBridge !== telegramBridgeRef.current) {
      telegramBridgeRef.current = externalTelegramBridge;
      if (agentRef.current) {
        externalTelegramBridge.attach(agentRef.current);
      }
    }
  }, [externalTelegramBridge]);

  function handleEngineEvent(event: EngineEvent): void {
    if (event.type === 'agent_message' && event.message) {
      visualStateManagerRef.current.applyUpdate(
        event.message as unknown as import('@agentx/shared').VisualUpdate,
      );
      setVisualState({ ...visualStateManagerRef.current.getState() });
    }
    if (event.type === 'loading_end') {
      visualStateManagerRef.current.reset();
      setVisualState(null);
    }

    switch (event.type) {
      case 'loading_start': {
        setIsLoading(true);
        setStreamingContent('');
        if (event.steps && event.steps.length > 0) {
          setLoadingSteps(event.steps.map((s: { id: string; label: string; status: string }) => ({ ...s, status: 'pending' })));
        }
        break;
      }
      case 'loading_step_update':
        setLoadingSteps((prev: Array<{ id: string; label: string; status: string }> | null) => {
          if (!prev) return prev;
          return prev.map((s: { id: string; label: string; status: string }) =>
            s.id === event.stepId ? { ...s, status: event.status } : s,
          );
        });
        break;
      case 'loading_end':
        setIsLoading(false);
        setLoadingSteps(null);
        break;
      case 'stream_chunk':
        latestContentRef.current = event.fullContent;
        if (!streamingScheduledRef.current) {
          streamingScheduledRef.current = true;
          setTimeout(() => {
            streamingScheduledRef.current = false;
            setStreamingContent(latestContentRef.current);
          }, 16);
        }
        break;
      case 'message_sent':
        setMessages((prev) => {
          if (prev.some((m) => m.id === event.message.id)) return prev;
          return [...prev, { ...event.message, tokenCost: 0 }];
        });
        persistMessage(event.message);
        break;
      case 'message_received': {
        const agent = agentRef.current;
        const currentCost = agent?.tokens?.totalCost ?? 0;
        const msgCost = currentCost - prevCostRef.current;
        prevCostRef.current = currentCost;
        setMessages((prev) => {
          const msgId = event.message?.id;
          if (msgId) {
            const idx = prev.findIndex((m) => m.id === msgId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...event.message, elapsed: event.elapsed, tokenCost: msgCost };
              return updated;
            }
          }
          return [...prev, { ...event.message, elapsed: event.elapsed, tokenCost: msgCost }];
        });
        latestContentRef.current = '';
        setStreamingContent('');
        if (agent?.tokens) {
          setTokensUsed(agent.tokens.tokensUsed);
          setTokensTotal(agent.tokens.tokensTotal);
        }
        persistMessage(event.message);
        if (maxBudgetRef.current > 0 && (agent?.tokens?.totalCost ?? 0) >= maxBudgetRef.current) {
          agent?.cancel();
          setError(`💰 Budget limit reached: $${maxBudgetRef.current.toFixed(2)}. Use --max-budget to increase.`);
          setErrorActions([{ type: 'dismiss', label: 'OK' }]);
          budgetWarningShownRef.current = false;
        } else if (maxBudgetRef.current > 0 && (agent?.tokens?.totalCost ?? 0) >= maxBudgetRef.current * 0.8 && !budgetWarningShownRef.current) {
          budgetWarningShownRef.current = true;
          setError(`⚠️ Budget warning: $${(agent?.tokens?.totalCost ?? 0).toFixed(4)} spent (80% of $${maxBudgetRef.current.toFixed(2)} limit)`);
          setErrorActions([{ type: 'dismiss', label: 'Dismiss' }]);
        }
        break;
      }
      case 'command_action':
        if (event.action === 'list_models') {
          setModelPickerModels(event.models);
          setCurrentModel(event.currentModel);
        } else if (event.action === 'model_switched') {
          setCurrentModel(event.modelId);
          setTokensTotal(event.contextWindow);
        }
        break;
      case 'error':
      case 'provider_error':
        setError(event.message);
        setErrorActions(event.actions ?? []);
        setActiveTools([]);
        setPermissionRequest(null);
        break;
      case 'permission_required':
        setPermissionRequest({ tool: event.tool, path: event.path, riskLevel: event.riskLevel });
        break;
      case 'tool_executing':
        setActiveTools((prev) => [...prev, { id: `${event.tool}-${Date.now()}-${Math.random()}`, tool: event.tool, description: event.description, startTime: event.startTime }]);
        break;
      case 'tool_complete': {
        let removed = false;
        setActiveTools((prev) => prev.filter((t) => {
          if (!removed && t.tool === event.tool) { removed = true; return false; }
          return true;
        }));
        setPendingDiff(null);
        setMessages((prev) => [...prev, {
          id: generateMessageId(),
          sessionId, role: 'tool',
          content: event.result.success ? event.result.output : `✗ ${event.result.error ?? event.result.output}`,
          toolCalls: null, tokenCount: 0, createdAt: new Date().toISOString(), elapsed: event.elapsed,
        }]);
        break;
      }
      case 'diff_preview':
        setPendingDiff({ tool: event.tool, filePath: event.filePath, diff: event.diff });
        break;
      case 'reasoning_start':
        setIsReasoning(true);
        setReasoningText('');
        break;
      case 'reasoning_glimpse':
        setReasoningText(event.text);
        break;
      case 'reasoning_complete':
        setIsReasoning(false);
        break;
      case 'todo_update':
        setTodoItems(event.items);
        break;
      case 'agent_spawned':
        setSubAgents((prev) => [...prev, { agentId: event.agentId, name: event.task, status: 'running', startTime: event.startTime }]);
        break;
      case 'agent_progress':
        setSubAgents((prev) => prev.map((a) => a.agentId === event.agentId ? { ...a, status: event.status } : a));
        break;
      case 'agent_complete':
        setSubAgents((prev) => prev.map((a) =>
          a.agentId === event.agentId
            ? { ...a, status: 'complete', summary: event.summary, elapsed: event.elapsed, endTime: Date.now() }
            : a
        ));
        setTimeout(() => {
          setSubAgents((prev) => prev.filter((a) => a.agentId !== event.agentId));
        }, 30000);
        break;
      case 'plan_generated':
        setIsLoading(false);
        setCurrentPlan(event.plan);
        break;
      case 'plan_approved':
        setCurrentPlan(null);
        setIsLoading(true);
        break;
      case 'plan_rejected':
      case 'plan_cancelled':
        setCurrentPlan(null);
        setIsLoading(false);
        break;
      case 'plan_step_complete':
        setCurrentPlan((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === event.stepId ? { ...s, status: 'done' as const } : s) } : prev);
        setAwaitingStepApproval(false);
        break;
      case 'plan_step_failed':
        setCurrentPlan((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === event.stepId ? { ...s, status: 'failed' as const } : s) } : prev);
        setAwaitingStepApproval(false);
        break;
      case 'plan_step_pending':
        setCurrentPlan((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === event.stepId ? { ...s, status: 'awaiting_approval' as const } : s) } : prev);
        setAwaitingStepApproval(true);
        setPendingStepId(event.stepId);
        break;
      case 'plan_step_skipped':
        setCurrentPlan((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === event.stepId ? { ...s, status: 'skipped' as const } : s) } : prev);
        setAwaitingStepApproval(false);
        break;
      case 'plan_mode_entered':
        setPlanModeState(true);
        break;
      case 'plan_mode_exited':
        setPlanModeState(false);
        setCurrentPlan(null);
        break;
      case 'indexing_start':
        setIsIndexing(true);
        setIndexingProgress({ indexed: 0, total: event.totalFiles });
        break;
      case 'indexing_progress':
        setIndexingProgress({ indexed: event.indexed, total: event.total });
        break;
      case 'indexing_complete':
        setIsIndexing(false);
        setIndexingProgress(null);
        break;
      case 'steer_message':
        setMessages((prev) => [...prev, {
          id: `sys-steer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sessionId, role: 'assistant' as const,
          content: `📢 ${event.instruction}`,
          toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
        }]);
        break;
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function detectDaemonAndInit() {
      let daemonRunning = externalDaemonMode ?? false;
      if (!externalDaemonMode) {
        try {
          const res = await fetch(`${DAEMON_API}/api/health`, { signal: AbortSignal.timeout(1500) });
          daemonRunning = res.ok;
        } catch {
          daemonRunning = false;
        }
      }

      if (cancelled) return;

      if (daemonRunning) {
        setDaemonMode(true);
        const socket = new WebSocket(DAEMON_WS_URL);
        wsRef.current = socket;

        socket.onopen = () => {
          if (cancelled) return;
          setMessages((prev) => {
            if (prev.length > 0) return prev;
            return [{
              id: `sys-daemon-${Date.now()}`,
              sessionId, role: 'assistant' as const,
              content: '🔄 Connected to daemon. Messages shared with daemon agent.',
              toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
            }];
          });
        };

        socket.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            if (data.type === 'engine_event') {
              handleEngineEvent(data.data as unknown as EngineEvent);
            }
          } catch { /* ignore */ }
        };

        socket.onclose = () => {
          if (cancelled) return;
          setDaemonMode(false);
        };

        sendWsRef.current = (data: Record<string, unknown>) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(data));
          }
        };
        return;
      }

      // No daemon — create local agent
      const agent = new Agent({ config, sessionId, gitAutoCommit, gitAware });
      agentRef.current = agent;

      try {
        if (sessionStoreRef.current instanceof SessionManager) {
          (sessionStoreRef.current as SessionManager).createSession(
            config.provider.activeProvider,
            config.provider.activeModel,
            undefined,
            process.cwd(),
          );
          
          // Initialize crew states - save all enabled crews
          const enabledCrews = agent.getCrewMembers().filter(m => m.crew.enabled);
          for (const member of enabledCrews) {
            (sessionStoreRef.current as SessionManager).saveCrewState(member.crew.id, true, 0);
          }
        } else {
          (sessionStoreRef.current as SessionStore).createSession({
            id: sessionId, title: 'New Session', status: 'active',
            provider: config.provider.activeProvider,
            model: config.provider.activeModel,
            scopePath: process.cwd(),
            tokenAvailable: agent.tokens.tokensTotal,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch { /* already exists */ }

      if (telegramBridgeRef.current) {
        telegramBridgeRef.current.attach(agent);
      }

      unsubscribe = agent.events.on((event: EngineEvent) => {
        handleEngineEvent(event);
      });

      configRef.current = config;
      setTokensTotal(agent.tokens.tokensTotal);

      if (initialPlanMode) agent.setPlanMode(true);
      if (fallbackModel) agent.setFallbackModel(fallbackModel);

      if (restoreSessionId) {
        try {
          if (sessionStoreRef.current instanceof SessionManager) {
            (sessionStoreRef.current as SessionManager).restoreSession(restoreSessionId);
            
            // Restore crew states
            const crewStates = (sessionStoreRef.current as SessionManager).getCrewStates();
            for (const state of crewStates) {
              agent.setCrewEnabled(state.crewId, state.enabled);
            }
          }
          const rows = sessionStoreRef.current instanceof SessionManager
            ? []
            : (sessionStoreRef.current as SessionStore).getMessages(restoreSessionId);
          const restored: Message[] = rows
            .filter((r: Record<string, unknown>) => r['role'] === 'user' || r['role'] === 'assistant')
            .map((r: Record<string, unknown>) => ({
              id: r['id'] as string, sessionId: r['session_id'] as string,
              role: r['role'] as 'user' | 'assistant', content: r['content'] as string,
              toolCalls: null, createdAt: r['created_at'] as string, tokenCount: (r['token_count'] as number) ?? 0,
            }));
          if (restored.length > 0) {
            setMessages(restored);
            for (const msg of restored) {
              agent.addToHistory({ role: msg.role as 'user' | 'assistant', content: msg.content });
            }
          }
        } catch { /* silent */ }
      }
    }

    detectDaemonAndInit().catch(() => {});

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (agentRef.current) {
        agentRef.current.endSession();
        agentRef.current = null;
      }
      if (telegramBridgeRef.current) {
        telegramBridgeRef.current.stop();
      }
    };
  }, [config, sessionId, externalDaemonMode]);

  function persistMessage(message: Message) {
    try {
      if (sessionStoreRef.current instanceof SessionManager) {
        // SessionManager doesn't have addMessage — use underlying adapter if available
        // Fall through to no-op for now
        return;
      }
      (sessionStoreRef.current as SessionStore).addMessage({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        tokenCount: message.tokenCount,
        createdAt: message.createdAt,
      });
    } catch {
      // Silently fail persistence
    }
  }

  const sendMessage = useCallback((content: string) => {
    const parser = commandParserRef.current;
    const registry = commandRegistryRef.current;
    const isDaemon = daemonMode;

    // Handle commands locally in both modes
    if (parser.isCommand(content)) {
      const parsed = parser.parse(content);
      const command = parsed.command ? registry.get(parsed.command) : undefined;
      if (command) {
        const parsedArgs = parsed.args ?? [];
        void command.execute(parsedArgs, {
          sessionId,
          providerId: configRef.current.provider.activeProvider,
          modelId: configRef.current.provider.activeModel,
          sessionStore: sessionStoreRef.current,
          emit: (msg: string) => {
            setMessages((prev) => [...prev, {
              id: `sys-cmd-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: msg,
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          },
        }).then((result) => {
          if (result.action === 'list_models') {
            void agentRef.current?.listModels();
          } else if (result.action === 'list_providers') {
            setShowProviderPicker(true);
          } else if (result.action === 'save_memory' && result.output) {
            agentRef.current?.sauce.recordMemory(result.output, 'user');
            setError(`✓ Remembered: "${result.output}"`);
          } else if (result.action === 'switch_model' && result.output) {
            const modelId = result.output;
            const agent = agentRef.current;
            if (agent) {
              void (async () => {
                const success = await agent.trialModel(modelId);
                if (success) {
                  agent.switchModel(modelId);
                  setCurrentModel(modelId);
                  const cm = new ConfigManager();
                  const cur = cm.load();
                  cur.provider.activeModel = modelId;
                  cm.save(cur);
                }
              })();
            }
          } else if (result.action === 'reset_provider') {
            const configManager = new ConfigManager();
            configManager.reset();
            process.stderr.write('\x1b[?25h\x1b[?1049l\x1b[2J\x1b[H');
            process.exit(0);
          } else if (result.action === 'clear') {
            setMessages([]);
            agentRef.current?.clearHistory();
          } else if (result.action === 'plan_mode') {
            const agent = agentRef.current;
            if (agent) {
              const enabled = result.output === 'on' ? true : result.output === 'off' ? false : !agent.planModeEnabled;
              agent.setPlanMode(enabled);
            }
          } else if (result.action === 'restore_session') {
            setMessages([]);
            setError(`Session restore requested: ${result.output}`);
            setErrorActions([{ type: 'dismiss', label: 'OK' }]);
          } else if (result.action === 'list_sessions') {
            // Sessions list is rendered inline via emit
          } else if (result.action === 'delete_session' && result.payload) {
            const { id } = result.payload as { id: string };
            setError(`Session ${id} deleted.`);
            setErrorActions([{ type: 'dismiss', label: 'OK' }]);
          } else if (result.action === 'fork_session' && result.payload) {
            const { name, sourceSessionId } = result.payload as { name?: string; sourceSessionId: string };
            const newId = generateSessionId();
            // Copy messages to new session
            const store = sessionStoreRef.current;
            if (store && typeof (store as unknown as { copySession?: (from: string, to: string) => void }).copySession === 'function') {
              (store as unknown as { copySession: (from: string, to: string, name?: string) => void }).copySession(sourceSessionId, newId, name);
            }
            setMessages((prev) => [...prev, {
              id: `sys-fork-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: `✅ Forked session. New session ID: ${newId}${name ? ` ("${name}")` : ''}`,
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          } else if (result.action === 'export_session' && result.payload) {
            const { format } = result.payload as { format: string };
            const modelName = currentModel;
            const providerName = configRef.current.provider.activeProvider;
            const metadata = format === 'jsonl'
              ? JSON.stringify({ _meta: { sessionId, model: modelName, provider: providerName, messageCount: messages.length, exportedAt: new Date().toISOString() } })
              : `# Session Export\n\n**Session**: ${sessionId}\n**Model**: ${modelName}\n**Provider**: ${providerName}\n**Messages**: ${messages.length}\n**Exported**: ${new Date().toISOString()}\n\n---\n`;
            const msgs = messages.map((m) => {
              if (format === 'jsonl') {
                return JSON.stringify({ role: m.role, content: m.content, createdAt: m.createdAt });
              }
              return `**${m.role}** (${m.createdAt?.slice(0, 10) ?? ''}):\n${m.content}\n`;
            }).join(format === 'jsonl' ? '\n' : '\n---\n');
            const body = `${metadata}${msgs}`;
            setMessages((prev) => [...prev, {
              id: `sys-exp-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: `📋 ${format.toUpperCase()} export (${body.length} chars, ${messages.length} messages):\n\n${body.slice(0, 8000)}${body.length > 8000 ? '\n...(truncated)' : ''}`,
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          } else if (result.action === 'copy_session') {
            const modelName = currentModel;
            const providerName = configRef.current.provider.activeProvider;
            const body = `# Session Export\n\n**Session**: ${sessionId}\n**Model**: ${modelName}\n**Provider**: ${providerName}\n**Messages**: ${messages.length}\n**Exported**: ${new Date().toISOString()}\n\n---\n`
              + messages.map((m) => `**${m.role}** (${m.createdAt?.slice(0, 10) ?? ''}):\n${m.content}\n`).join('\n---\n');
            const ok = copyToClipboard(body);
            setMessages((prev) => [...prev, {
              id: `sys-cp-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: ok
                ? `📋 Session copied to clipboard (${body.length} chars, ${messages.length} messages)`
                : '⚠️ Could not copy to clipboard (no clipboard tool available)',
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          } else if (result.action === 'checkpoint' && result.payload) {
            const { label } = result.payload as { label: string };
            setCheckpoints((prev) => [...prev, { label, messages: [...messages], createdAt: new Date().toISOString() }]);
            setMessages((prev) => [...prev, {
              id: `sys-cp-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: `💾 Checkpoint saved: "${label}" (${messages.length} messages)`,
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          } else if (result.action === 'rewind') {
            if (checkpoints.length === 0) {
              setMessages((prev) => [...prev, {
                id: `sys-rw-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: 'No checkpoints found. Use /checkpoint first.',
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            } else {
              const last = checkpoints[checkpoints.length - 1]!;
              setMessages(last.messages);
              setCheckpoints((prev) => prev.slice(0, -1));
              setMessages((prev) => [...prev, {
                id: `sys-rw-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: `⏪ Rewound to checkpoint "${last.label}" (${last.messages.length} messages)`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            }
          } else if (result.action === 'show_cost') {
            const agent = agentRef.current;
            if (agent) {
              const t = agent.tokens;
              const cost = t.totalCost;
              const costStr = cost < 0.01 ? `${(cost * 100).toFixed(2)}¢` : `$${cost.toFixed(4)}`;
              setMessages((prev) => [...prev, {
                id: `sys-cost-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: `💰 **Session Cost**\n- Tokens used: ${t.tokensUsed.toLocaleString()} (input: ${t.inputTokenCount.toLocaleString()} / output: ${t.outputTokenCount.toLocaleString()})\n- Context window: ${t.tokensTotal.toLocaleString()}\n- Estimated cost: ${costStr}\n- Usage: ${(t.percentage * 100).toFixed(1)}% of context window`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            }
          } else if (result.action === 'exit') {
            // Restore terminal: show cursor, exit alt screen, clear to main, cursor home
            process.stderr.write('\x1b[?25h\x1b[?1049l\x1b[2J\x1b[H');
            process.exit(0);
          } else if (result.action === 'telegram_start') {
            void (async () => {
              try {
                const token = parsedArgs[1];
                if (!token) {
                  setError('Missing bot token. Usage: /telegram start <bot_token>');
                  setErrorActions([{ type: 'dismiss', label: 'Dismiss' }]);
                  return;
                }
                if (agentRef.current) {
                  if (telegramBridgeRef.current) {
                    telegramBridgeRef.current.stop();
                  }
                  const bridge = new TelegramBridge({ botToken: token });
                  bridge.attach(agentRef.current);
                  await bridge.start();
                  telegramBridgeRef.current = bridge;
                  telegramStoreRef.current.save({ botToken: token });
                  const status = bridge.getStatus();
                  setMessages((prev) => [...prev, {
                    id: `sys-tg-${Date.now()}`,
                    sessionId,
                    role: 'assistant' as const,
                    content: `✅ Telegram bridge started! Bot @${status.botUsername ?? 'unknown'} is now online and polling for messages.`,
                    toolCalls: null,
                    createdAt: new Date().toISOString(),
                    tokenCount: 0,
                  }]);
                }
              } catch (err) {
                setError(`Telegram bridge error: ${err instanceof Error ? err.message : String(err)}`);
                setErrorActions([{ type: 'dismiss', label: 'Dismiss' }]);
              }
            })();
          } else if (result.action === 'telegram_stop') {
            if (telegramBridgeRef.current) {
              telegramBridgeRef.current.stop();
              telegramBridgeRef.current = null;
            }
            setMessages((prev) => [...prev, {
              id: `sys-tg-${Date.now()}`,
              sessionId,
              role: 'assistant' as const,
              content: '⏹ Telegram bridge stopped.',
              toolCalls: null,
              createdAt: new Date().toISOString(),
              tokenCount: 0,
            }]);
          } else if (result.action === 'telegram_status') {
            if (telegramBridgeRef.current) {
              const status = telegramBridgeRef.current.getStatus();
              setMessages((prev) => [...prev, {
                id: `sys-tg-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: `📡 Telegram Bridge Status:\n  Bot: @${status.botUsername ?? 'unknown'}\n  Connected: ${status.connected ? 'Yes' : 'No'}\n  Messages processed: ${status.messageCount}`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            } else {
              const stored = telegramStoreRef.current.load();
              const helpText = [
                '📡 Telegram bridge is not running.',
                '',
                stored?.botToken ? 'A bot token is saved. Use /telegram start to reconnect.' : 'No bot token configured.',
                '',
                '━━━ Setup Guide ━━━',
                '1. Open Telegram and message @BotFather',
                '2. Send /newbot and follow the prompts',
                '3. Copy the bot token (looks like: 123456:ABC-DEF...)',
                '4. Run: /telegram start <your_token>',
                '',
                'The bot will run in the background and forward messages to Agent-X.',
              ].join('\n');
              setMessages((prev) => [...prev, {
                id: `sys-tg-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: helpText,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            }
          } else if (result.action === 'focus') {
            if (result.output && ['tui', 'web', 'telegram'].includes(result.output)) {
              setFocusChannelState(result.output);
              fetch(`${DAEMON_API}/api/gateway/focus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: result.output }),
              }).catch(() => {});
              setMessages((prev) => [...prev, {
                id: `sys-focus-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: `🎯 Focus set to: ${result.output}`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            } else {
              setMessages((prev) => [...prev, {
                id: `sys-focus-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: `🎯 Current focus channel: ${focusChannel ?? 'none'}\n\nUse /focus <channel> to switch.\nAvailable: tui, web, telegram`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            }
          } else if (result.action === 'telegram_updates') {
            const enable = result.output === 'on' || result.output === 'yes' || result.output === 'true';
            if (enable && telegramBridgeRef.current) {
              setMessages((prev) => [...prev, {
                id: `sys-tgup-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: '📡 Telegram updates enabled. I will send progress updates to Telegram.',
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            } else {
              setMessages((prev) => [...prev, {
                id: `sys-tgup-${Date.now()}`,
                sessionId,
                role: 'assistant' as const,
                content: '📡 Telegram updates disabled.',
                toolCalls: null,
                createdAt: new Date().toISOString(),
                tokenCount: 0,
              }]);
            }
          } else if (result.action === 'research' && result.output) {
            const question = String(result.output);
            if (agentRef.current) {
              void agentRef.current.research(question).catch(() => {});
            }
          }
        });
        return;
      }
    }

    if (!isDaemon && agentRef.current?.processing) {
      setError('Agent is still processing previous message. Please wait.');
      return;
    }
    setError(null);
    setErrorActions([]);
    lastUserMessageRef.current = content;

    if (isDaemon) {
      sendWsRef.current({ type: 'chat_message', text: content });
    } else {
      void agentRef.current?.sendMessage(content).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    }
  }, [sessionId, daemonMode]);

  const cancelProcessing = useCallback(() => {
    if (daemonMode) {
      sendWsRef.current({ type: 'cancel' });
    } else {
      agentRef.current?.cancel();
    }
  }, [daemonMode]);

  const selectModel = useCallback((model: ModelInfo) => {
    if (!agentRef.current) return;
    setModelPickerModels(null);

    const agent = agentRef.current;
    setIsLoading(true);
    setError(null);
    setErrorActions([]);
    void (async () => {
      try {
        const success = await agent.trialModel(model.id);
        if (success) {
          agent.switchModel(model.id, model.contextWindow);
          setCurrentModel(model.id);
          const configManager = new ConfigManager();
          const current = configManager.load();
          current.provider.activeModel = model.id;
          configManager.save(current);
        }
      } catch (err) {
        getLogger().error('MODEL_SELECT', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const dismissModelPicker = useCallback(() => {
    setModelPickerModels(null);
  }, []);

  const selectProvider = useCallback((providerId: ProviderId, modelId: string, contextWindow: number, apiKey?: string, baseUrl?: string) => {
    setShowProviderPicker(false);
    setError(null);
    setErrorActions([]);

    try {
      const configManager = new ConfigManager();
      const current = configManager.load();
      current.provider.activeProvider = providerId;
      current.provider.activeModel = modelId;
      if (!current.provider.providers[providerId]) {
        current.provider.providers[providerId] = { configured: false };
      }
      if (apiKey) {
        current.provider.providers[providerId]!.apiKey = apiKey;
      }
      if (baseUrl) {
        current.provider.providers[providerId]!.baseUrl = baseUrl;
      }
      current.provider.providers[providerId]!.configured = true;
      configManager.save(current);

      if (agentRef.current) {
        const resolvedKey = apiKey ?? current.provider.providers[providerId]?.apiKey;
        const resolvedUrl = baseUrl ?? current.provider.providers[providerId]?.baseUrl;
        agentRef.current.switchProvider(providerId, resolvedKey, resolvedUrl);
        agentRef.current.switchModel(modelId, contextWindow);
      }
      configRef.current = current;
      setCurrentModel(modelId);
      setTokensTotal(contextWindow);
    } catch (err) {
      getLogger().error('PROVIDER_SWITCH', err);
      setError(`✗ Failed to switch to ${providerId}.`);
    }
  }, []);

  const dismissProviderPicker = useCallback(() => {
    setShowProviderPicker(false);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setErrorActions([]);
  }, []);

  const handleErrorAction = useCallback((action: RemediationAction) => {
    switch (action.type) {
      case 'retry':
        dismissError();
        if (lastUserMessageRef.current && agentRef.current && !agentRef.current.processing) {
          void agentRef.current.sendMessage(lastUserMessageRef.current).catch(() => {});
        }
        break;
      case 'switch_model':
        dismissError();
        void agentRef.current?.listModels();
        break;
      case 'reconfigure_key':
        dismissError();
        setError('Run: agentx --setup to reconfigure your API key.');
        setErrorActions([{ type: 'dismiss', label: 'OK' }]);
        break;
      case 'dismiss':
        dismissError();
        break;
      case 'open_url':
        dismissError();
        break;
    }
  }, [dismissError]);

  const commandNames = commandRegistryRef.current.list().map((c) => c.name);
  const commandList = commandRegistryRef.current.list().map((c) => ({
    name: c.name,
    description: c.description,
  }));

  const respondToPermission = useCallback((choice: 'allow_once' | 'allow_always' | 'deny') => {
    if (daemonMode) {
      sendWsRef.current({ type: 'permission_respond', choice });
    } else if (agentRef.current) {
      agentRef.current.respondToPermission(choice);
    }
    setPermissionRequest(null);
  }, [daemonMode]);

  const approvePlan = useCallback(() => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: '/plan approve' });
    } else if (agentRef.current) {
      agentRef.current.respondToPlan(true);
    }
  }, [daemonMode]);

  const rejectPlan = useCallback(() => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: '/plan reject' });
    } else if (agentRef.current) {
      agentRef.current.respondToPlan(false);
    }
    setCurrentPlan(null);
  }, [daemonMode]);

  const togglePlanStep = useCallback((stepId: string) => {
    setCurrentPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId
            ? { ...s, status: s.status === 'approved' ? 'pending' as const : 'approved' as const }
            : s
        ),
      };
    });
  }, []);

  const approveStep = useCallback((stepId: string) => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: `/step approve ${stepId}` });
    } else if (agentRef.current) {
      agentRef.current.respondToStep(stepId, true);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, [daemonMode]);

  const skipStep = useCallback((stepId: string) => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: `/step skip ${stepId}` });
    } else if (agentRef.current) {
      agentRef.current.respondToStep(stepId, false);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, [daemonMode]);

  const modifyStep = useCallback((stepId: string, description: string) => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: `/step modify ${stepId} ${description}` });
    } else if (agentRef.current) {
      agentRef.current.respondToStep(stepId, true, description);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, [daemonMode]);

  const cancelPlan = useCallback(() => {
    if (daemonMode) {
      sendWsRef.current({ type: 'cancel' });
    } else if (agentRef.current) {
      agentRef.current.respondToPlan(false);
    }
    setCurrentPlan(null);
  }, [daemonMode]);

  const togglePlanMode = useCallback(() => {
    if (daemonMode) {
      sendWsRef.current({ type: 'chat_message', text: '/plan' });
    } else if (agentRef.current) {
      agentRef.current.setPlanMode(!agentRef.current.planModeEnabled);
    }
  }, [daemonMode]);

  const setFocusChannel = useCallback((channel: string) => {
    setFocusChannelState(channel);
    // Update daemon focus if running
    fetch(`${DAEMON_API}/api/gateway/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    }).catch(() => {});
  }, []);

  const setCrewEnabled = useCallback((crewId: string, enabled: boolean) => {
    if (daemonMode) {
      // In daemon mode, send to web-api
      fetch(`${DAEMON_API}/api/crew/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, enabled }),
      }).catch(() => {});
    } else if (agentRef.current && sessionStoreRef.current instanceof SessionManager) {
      // In local mode, update agent and save to session store
      agentRef.current.setCrewEnabled(crewId, enabled);
      (sessionStoreRef.current as SessionManager).saveCrewState(crewId, enabled);
    }
  }, [daemonMode]);

  return {
    messages,
    streamingContent,
    isLoading,
    loadingSteps,
    tokensUsed,
    tokensTotal,
    error,
    errorActions,
    sendMessage,
    cancelProcessing,
    handleErrorAction,
    dismissError,
    sessionId,
    modelPickerModels,
    currentModel,
    selectModel,
    dismissModelPicker,
    commandNames,
    commandList,
    showProviderPicker,
    selectProvider,
    dismissProviderPicker,
    permissionRequest,
    respondToPermission,
    todoItems,
    reasoningText,
    isReasoning,
    activeTools,
    subAgents,
    currentPlan,
    planMode,
    approvePlan,
    rejectPlan,
    approveStep,
    skipStep,
    modifyStep,
    togglePlanStep,
    cancelPlan,
    togglePlanMode,
    visualState,
    toolCount: agentRef.current?.toolCount ?? 0,
    watcherCount: agentRef.current?.watcherCount ?? 0,
    schedulerCount: agentRef.current?.schedulerCount ?? 0,
    ragIndexStats: agentRef.current?.ragIndexStats ?? { indexedCount: 0, indexedAt: null },
    currentTaskType: agentRef.current?.currentTaskType ?? null,
    pendingDiff,
    messageCount: messages.length,
    sessionCreatedAt,
    totalCost: agentRef.current?.tokens.totalCost ?? 0,
    isIndexing,
    indexingProgress,
    focusChannel,
    setFocusChannel,
    setCrewEnabled,
  };
}
