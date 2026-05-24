import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, EngineEvent, AgentXConfig, ModelInfo, RemediationAction, ProviderId, Profile, TodoItem } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { Agent, CommandParser, createDefaultRegistry, ConfigManager, SessionStore, ProviderFactory } from '@agentx/engine';
import { generateSessionId } from '@agentx/shared';

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
  selectProvider: (providerId: ProviderId, apiKey?: string, baseUrl?: string) => void;
  dismissProviderPicker: () => void;
  permissionRequest: PermissionRequest | null;
  respondToPermission: (choice: 'allow_once' | 'allow_always' | 'deny') => void;
  todoItems: TodoItem[];
  reasoningText: string;
  isReasoning: boolean;
  activeTools: Array<{ tool: string; description: string; startTime: number }>;
  subAgents: Array<{ agentId: string; name: string; status: string; startTime: number }>;
}

export function useSession(config: AgentXConfig, _profile?: Profile, restoreSessionId?: string): UseSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [tokensTotal, setTokensTotal] = useState(128_000);
  const [error, setError] = useState<string | null>(null);
  const [errorActions, setErrorActions] = useState<RemediationAction[]>([]);
  const [sessionId] = useState(() => restoreSessionId ?? generateSessionId());
  const [modelPickerModels, setModelPickerModels] = useState<ModelInfo[] | null>(null);
  const [currentModel, setCurrentModel] = useState(config.provider.activeModel);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [isReasoning, setIsReasoning] = useState(false);
  const [activeTools, setActiveTools] = useState<Array<{ tool: string; description: string; startTime: number }>>([]);
  const [subAgents, setSubAgents] = useState<Array<{ agentId: string; name: string; status: string; startTime: number }>>([]);

  const agentRef = useRef<Agent | null>(null);
  const configRef = useRef<AgentXConfig>(config);
  const sessionStoreRef = useRef<SessionStore>(new SessionStore());
  const commandParserRef = useRef(new CommandParser());
  const commandRegistryRef = useRef(createDefaultRegistry());
  const lastUserMessageRef = useRef<string>('');

  useEffect(() => {
    const agent = new Agent({
      config,
      sessionId,
    });

    // Create session in SQLite
    try {
      sessionStoreRef.current.createSession({
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
    } catch {
      // Session may already exist (e.g. hot reload)
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
          setStreamingContent(event.fullContent);
          break;
        case 'message_sent':
          setMessages((prev) => [...prev, event.message]);
          // Persist to SQLite
          sessionStoreRef.current.addMessage({
            id: event.message.id,
            sessionId: event.message.sessionId,
            role: event.message.role,
            content: event.message.content,
            tokenCount: event.message.tokenCount,
            createdAt: event.message.createdAt,
          });
          break;
        case 'message_received':
          setMessages((prev) => [...prev, { ...event.message, elapsed: event.elapsed }]);
          setStreamingContent('');
          setTokensUsed(agent.tokens.tokensUsed);
          setTokensTotal(agent.tokens.tokensTotal);
          // Persist to SQLite
          sessionStoreRef.current.addMessage({
            id: event.message.id,
            sessionId: event.message.sessionId,
            role: event.message.role,
            content: event.message.content,
            tokenCount: event.message.tokenCount,
            createdAt: event.message.createdAt,
          });
          break;
        case 'command_action':
          if (event.action === 'list_models') {
            setModelPickerModels(event.models);
            setCurrentModel(event.currentModel);
          } else if (event.action === 'model_switched') {
            setCurrentModel(event.modelId);
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
          setSubAgents((prev) => prev.filter((a) => a.agentId !== event.agentId));
          break;
      }
    });

    agentRef.current = agent;
    configRef.current = config;
    setTokensTotal(agent.tokens.tokensTotal);

    // Restore messages if resuming a session
    if (restoreSessionId) {
      try {
        const rows = sessionStoreRef.current.getMessages(restoreSessionId);
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
          // Load into agent's message history for LLM context continuity
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
      // End session — record diary + identity on cleanup
      if (agentRef.current) {
        agentRef.current.endSession();
      }
    };
  }, [config, sessionId]);

  const sendMessage = useCallback((content: string) => {
    if (!agentRef.current) return;

    const parser = commandParserRef.current;
    const registry = commandRegistryRef.current;

    // Handle slash commands
    if (parser.isCommand(content)) {
      const parsed = parser.parse(content);
      const command = parsed.command ? registry.get(parsed.command) : undefined;
      if (command) {
        const parsedArgs = parsed.args ?? [];
        void command.execute(parsedArgs, {
          sessionId,
          providerId: configRef.current.provider.activeProvider,
          modelId: configRef.current.provider.activeModel,
          emit: (msg: string) => setError(msg),
        }).then((result) => {
          if (result.action === 'list_models') {
            void agentRef.current?.listModels();
          } else if (result.action === 'list_providers') {
            setShowProviderPicker(true);
          } else if (result.action === 'save_memory' && result.output) {
            agentRef.current?.sauce.recordMemory(result.output, 'user');
            setError(`✓ Remembered: "${result.output}"`);
          } else if (result.action === 'switch_model' && result.output) {
            // Trial-before-commit via slash command too
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
            // Reset provider config and trigger setup
            const configManager = new ConfigManager();
            configManager.reset();
            process.exit(0);
          } else if (result.action === 'switch_profile') {
            // Profile switch persisted to disk by command — restart to apply
            process.exit(0);
          } else if (result.action === 'clear') {
            setMessages([]);
            agentRef.current?.clearHistory();
          } else if (result.action === 'exit') {
            process.exit(0);
          } else if (result.action === 'telegram_start') {
            // Start telegram bridge
            void (async () => {
              try {
                const { TelegramBridge } = await import('@agentx/engine');
                const token = parsedArgs[1]; // token from /telegram start <token>
                if (token && agentRef.current) {
                  const bridge = new TelegramBridge({ botToken: token });
                  bridge.attach(agentRef.current);
                  await bridge.start();
                  setMessages((prev) => [...prev, {
                    id: `sys-tg-${Date.now()}`,
                    sessionId,
                    role: 'assistant' as const,
                    content: '✅ Telegram bridge started! Your bot is now online.',
                    toolCalls: null,
                    createdAt: new Date().toISOString(),
                    tokenCount: 0,
                  }]);
                }
              } catch (err) {
                setError(`Telegram bridge error: ${err instanceof Error ? err.message : String(err)}`);
              }
            })();
          } else if (result.action === 'telegram_stop') {
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
            // Show setup prompt with remediation actions
            setError('Telegram bridge is not configured. Get a bot token from @BotFather on Telegram, then use /telegram start <token>.');
            setErrorActions([
              { type: 'dismiss', label: 'Dismiss' },
            ]);
          }
        });
        return;
      }
    }

    if (agentRef.current.processing) return;
    setError(null);
    setErrorActions([]);
    lastUserMessageRef.current = content;
    void agentRef.current.sendMessage(content).catch(() => {
      // Error already handled via event bus — suppress unhandled rejection
    });
  }, [sessionId]);

  const cancelProcessing = useCallback(() => {
    if (agentRef.current?.processing) {
      agentRef.current.cancel();
    }
  }, []);

  const selectModel = useCallback((model: ModelInfo) => {
    if (!agentRef.current) return;
    setModelPickerModels(null);

    // Trial-before-commit: test the model with an API call before persisting
    const agent = agentRef.current;
    setIsLoading(true);
    setError(null);
    setErrorActions([]);
    void (async () => {
      try {
        const success = await agent.trialModel(model.id);
        if (success) {
          agent.switchModel(model.id);
          setCurrentModel(model.id);
          // Persist to config only after successful trial
          const configManager = new ConfigManager();
          const current = configManager.load();
          current.provider.activeModel = model.id;
          configManager.save(current);
        }
        // If trial fails, agent.trialModel already emitted the error event
      } catch (err) {
        getLogger().error('MODEL_SELECT', err);
        // Error already emitted via event bus inside trialModel
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const dismissModelPicker = useCallback(() => {
    setModelPickerModels(null);
  }, []);

  const selectProvider = useCallback((providerId: ProviderId, apiKey?: string, baseUrl?: string) => {
    setShowProviderPicker(false);
    setIsLoading(true);
    setError(null);
    setErrorActions([]);

    void (async () => {
      try {
        // Validate API key before accepting the switch
        const key = apiKey;
        const url = baseUrl;
        const provider = ProviderFactory.create(providerId, key, url);
        const valid = await provider.validate();
        if (!valid) {
          setError(`✗ Invalid API key for ${providerId}. Please try again.`);
          setShowProviderPicker(true);
          return;
        }

        const configManager = new ConfigManager();
        const current = configManager.load();
        current.provider.activeProvider = providerId;
        if (!current.provider.providers[providerId]) {
          current.provider.providers[providerId] = { configured: false };
        }
        if (key) {
          current.provider.providers[providerId]!.apiKey = key;
        }
        if (url) {
          current.provider.providers[providerId]!.baseUrl = url;
        }
        current.provider.providers[providerId]!.configured = true;
        // Clear saved model — new provider needs a fresh model pick
        current.provider.activeModel = '';
        configManager.save(current);

        // Switch provider in-place (no restart needed)
        if (agentRef.current) {
          const resolvedKey = key ?? current.provider.providers[providerId]?.apiKey;
          const resolvedUrl = url ?? current.provider.providers[providerId]?.baseUrl;
          agentRef.current.switchProvider(providerId, resolvedKey, resolvedUrl);
        }
        configRef.current = current;
        setCurrentModel('');

        // Auto-trigger model picker after successful provider switch
        void agentRef.current?.listModels();
      } catch (err) {
        getLogger().error('PROVIDER_SWITCH', err);
        setError(`✗ Failed to switch to ${providerId}. Check your API key.`);
        setShowProviderPicker(true);
      } finally {
        setIsLoading(false);
      }
    })();
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
        // Trigger the setup wizard by signaling config is invalid
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
  };
}
