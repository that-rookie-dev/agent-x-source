import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, EngineEvent, AgentXConfig, ModelInfo, RemediationAction, ProviderId, Crew, TodoItem, Plan } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { Agent, CommandParser, createDefaultRegistry, ConfigManager, SessionStore, TelegramBridge, TelegramStore } from '@agentx/engine';
import type { StorageAdapter } from '@agentx/engine';
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
  activeTools: Array<{ tool: string; description: string; startTime: number }>;
  subAgents: Array<{ agentId: string; name: string; status: string; startTime: number; summary?: string; endTime?: number }>;
  currentPlan: Plan | null;
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
}

export function useSession(
  config: AgentXConfig,
  _crew?: Crew,
  restoreSessionId?: string,
  onCrewSwitch?: () => void,
  storageAdapter?: StorageAdapter | null,
  externalTelegramBridge?: TelegramBridge | null,
  initialPlanMode?: boolean,
  fallbackModel?: string,
  maxBudget?: number,
  gitAutoCommit?: boolean,
  gitAware?: boolean,
): UseSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
  const [activeTools, setActiveTools] = useState<Array<{ tool: string; description: string; startTime: number }>>([]);
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

  const agentRef = useRef<Agent | null>(null);
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

  // Keep model ref in sync
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);

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

  useEffect(() => {
    const agent = new Agent({
      config,
      sessionId,
      gitAutoCommit,
      gitAware,
    });

    // Create session using SessionManager or SessionStore
    try {
      if (sessionStoreRef.current instanceof SessionManager) {
        const sm = sessionStoreRef.current as SessionManager;
        sm.createSession(
          config.provider.activeProvider,
          config.provider.activeModel,
          undefined,
          process.cwd(),
        );
      } else {
        const ss = sessionStoreRef.current as SessionStore;
        ss.createSession({
          id: sessionId,
          title: 'New Session',
          status: 'active',
          provider: config.provider.activeProvider,
          model: config.provider.activeModel,
          scopePath: process.cwd(),
          tokenAvailable: agent.tokens.tokensTotal,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Session may already exist (e.g. hot reload)
    }

    // Attach external telegram bridge if available
    if (telegramBridgeRef.current) {
      telegramBridgeRef.current.attach(agent);
    }

    const unsubscribe = agent.events.on((event: EngineEvent) => {
      switch (event.type) {
        case 'loading_start':
          setIsLoading(true);
          setStreamingContent('');
          break;
        case 'loading_end':
          setIsLoading(false);
          break;
        case 'stream_chunk':
          // Smooth streaming: throttle UI updates to ~60fps (16ms) to avoid jank
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
          const currentCost = agent.tokens.totalCost;
          const msgCost = currentCost - prevCostRef.current;
          prevCostRef.current = currentCost;
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.message.id)) return prev;
            return [...prev, { ...event.message, elapsed: event.elapsed, tokenCost: msgCost }];
          });
          setStreamingContent('');
          setTokensUsed(agent.tokens.tokensUsed);
          setTokensTotal(agent.tokens.tokensTotal);
          persistMessage(event.message);
          // Budget check
          if (maxBudgetRef.current > 0 && agent.tokens.totalCost >= maxBudgetRef.current) {
            agent.cancel();
            setError(`💰 Budget limit reached: $${maxBudgetRef.current.toFixed(2)}. Use --max-budget to increase.`);
            setErrorActions([{ type: 'dismiss', label: 'OK' }]);
            budgetWarningShownRef.current = false;
          } else if (maxBudgetRef.current > 0 && agent.tokens.totalCost >= maxBudgetRef.current * 0.8 && !budgetWarningShownRef.current) {
            budgetWarningShownRef.current = true;
            setError(`⚠️ Budget warning: $${(agent.tokens.totalCost).toFixed(4)} spent (80% of $${maxBudgetRef.current.toFixed(2)} limit)`);
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
          setError(event.message);
          setErrorActions(event.actions ?? []);
          break;
        case 'permission_required':
          setPermissionRequest({
            tool: event.tool,
            path: event.path,
            riskLevel: event.riskLevel,
          });
          break;
        case 'tool_executing':
          setActiveTools((prev) => [...prev, { tool: event.tool, description: event.description, startTime: event.startTime }]);
          break;
        case 'tool_complete':
          setActiveTools((prev) => prev.filter((t) => t.tool !== event.tool));
          setPendingDiff(null);
          setMessages((prev) => [...prev, {
            id: generateMessageId(),
            sessionId,
            role: 'tool',
            content: event.result.success
              ? event.result.output
              : `✗ ${event.result.error ?? event.result.output}`,
            toolCalls: null,
            tokenCount: 0,
            createdAt: new Date().toISOString(),
            elapsed: event.elapsed,
          }]);
          break;
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
        // Auto-remove completed agents after 30 seconds
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
          setCurrentPlan((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === event.stepId ? { ...s, status: 'done' as const } : s
              ),
            };
          });
          setAwaitingStepApproval(false);
          break;
        case 'plan_step_failed':
          setCurrentPlan((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === event.stepId ? { ...s, status: 'failed' as const } : s
              ),
            };
          });
          setAwaitingStepApproval(false);
          break;
        case 'plan_step_pending':
          setCurrentPlan((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === event.stepId ? { ...s, status: 'awaiting_approval' as const } : s
              ),
            };
          });
          setAwaitingStepApproval(true);
          setPendingStepId(event.stepId);
          break;
        case 'plan_step_skipped':
          setCurrentPlan((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              steps: prev.steps.map((s) =>
                s.id === event.stepId ? { ...s, status: 'skipped' as const } : s
              ),
            };
          });
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
            sessionId,
            role: 'assistant' as const,
            content: `📢 ${event.instruction}`,
            toolCalls: null,
            createdAt: new Date().toISOString(),
            tokenCount: 0,
          }]);
          break;
      }
    });

    agentRef.current = agent;
    configRef.current = config;
    setTokensTotal(agent.tokens.tokensTotal);

    // Apply initial plan mode if set via --plan flag
    if (initialPlanMode) {
      agent.setPlanMode(true);
    }

    // Apply fallback model if set via --fallback-model flag
    if (fallbackModel) {
      agent.setFallbackModel(fallbackModel);
    }

    // Restore messages if resuming a session
    if (restoreSessionId) {
      try {
        if (sessionStoreRef.current instanceof SessionManager) {
          const sm = sessionStoreRef.current as SessionManager;
          sm.restoreSession(restoreSessionId);
        }
        // Restore messages from store
        const rows = sessionStoreRef.current instanceof SessionManager
          ? []
          : (sessionStoreRef.current as SessionStore).getMessages(restoreSessionId);
        const restored: Message[] = rows
          .filter((r) => r['role'] === 'user' || r['role'] === 'assistant')
          .map((r) => ({
            id: r['id'] as string,
            sessionId: r['session_id'] as string,
            role: r['role'] as 'user' | 'assistant',
            content: r['content'] as string,
            toolCalls: null,
            createdAt: r['created_at'] as string,
            tokenCount: (r['token_count'] as number) ?? 0,
          }));
        if (restored.length > 0) {
          setMessages(restored);
          for (const msg of restored) {
            agent.addToHistory({ role: msg.role as 'user' | 'assistant', content: msg.content });
          }
        }
      } catch {
        // Silent failure on restore
      }
    }

    return () => {
      unsubscribe();
      if (agentRef.current) {
        agentRef.current.endSession();
      }
      if (telegramBridgeRef.current) {
        telegramBridgeRef.current.stop();
      }
    };
  }, [config, sessionId]);

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
    if (!agentRef.current) return;

    const parser = commandParserRef.current;
    const registry = commandRegistryRef.current;

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
            process.exit(0);
          } else if (result.action === 'switch_crew') {
            if (onCrewSwitch) {
              onCrewSwitch();
            }
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

    if (agentRef.current.processing) return;
    setError(null);
    setErrorActions([]);
    lastUserMessageRef.current = content;
    void agentRef.current.sendMessage(content).catch(() => {});
  }, [sessionId]);

  const cancelProcessing = useCallback(() => {
    if (agentRef.current?.processing) {
      agentRef.current.cancel();
    }
  }, []);

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
    if (agentRef.current) {
      agentRef.current.respondToPermission(choice);
    }
    setPermissionRequest(null);
  }, []);

  const approvePlan = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.respondToPlan(true);
    }
  }, []);

  const rejectPlan = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.respondToPlan(false);
    }
    setCurrentPlan(null);
  }, []);

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
    if (agentRef.current) {
      agentRef.current.respondToStep(stepId, true);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, []);

  const skipStep = useCallback((stepId: string) => {
    if (agentRef.current) {
      agentRef.current.respondToStep(stepId, false);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, []);

  const modifyStep = useCallback((stepId: string, description: string) => {
    if (agentRef.current) {
      agentRef.current.respondToStep(stepId, true, description);
    }
    setAwaitingStepApproval(false);
    setPendingStepId(null);
  }, []);

  const cancelPlan = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.respondToPlan(false);
    }
    setCurrentPlan(null);
  }, []);

  const togglePlanMode = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.setPlanMode(!agentRef.current.planModeEnabled);
    }
  }, []);

  return {
    messages,
    streamingContent,
    isLoading,
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
  };
}
