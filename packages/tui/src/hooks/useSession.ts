import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, EngineEvent, AgentXConfig, ModelInfo } from '@agentx/shared';
import { Agent, CommandParser, createDefaultRegistry, ConfigManager } from '@agentx/engine';
import { generateSessionId } from '@agentx/shared';

interface UseSessionReturn {
  messages: Message[];
  streamingContent: string;
  isLoading: boolean;
  tokensUsed: number;
  tokensTotal: number;
  elapsed: number;
  error: string | null;
  sendMessage: (content: string) => void;
  sessionId: string;
  modelPickerModels: ModelInfo[] | null;
  currentModel: string;
  selectModel: (model: ModelInfo) => void;
  dismissModelPicker: () => void;
}

export function useSession(config: AgentXConfig): UseSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [tokensTotal, setTokensTotal] = useState(128_000);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() => generateSessionId());
  const [modelPickerModels, setModelPickerModels] = useState<ModelInfo[] | null>(null);
  const [currentModel, setCurrentModel] = useState(config.provider.activeModel);

  const agentRef = useRef<Agent | null>(null);
  const configRef = useRef<AgentXConfig>(config);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const commandParserRef = useRef(new CommandParser());
  const commandRegistryRef = useRef(createDefaultRegistry());

  useEffect(() => {
    const agent = new Agent({
      config,
      sessionId,
    });

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
          break;
        case 'message_received':
          setMessages((prev) => [...prev, event.message]);
          setStreamingContent('');
          setTokensUsed(agent.tokens.tokensUsed);
          setTokensTotal(agent.tokens.tokensTotal);
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
          break;
      }
    });

    agentRef.current = agent;
    configRef.current = config;
    setTokensTotal(agent.tokens.tokensTotal);

    return () => {
      unsubscribe();
    };
  }, [config, sessionId]);

  // Track session elapsed time
  useEffect(() => {
    startTimeRef.current = Date.now();
    elapsedIntervalRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 1000);

    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!agentRef.current) return;

    const parser = commandParserRef.current;
    const registry = commandRegistryRef.current;

    // Handle slash commands
    if (parser.isCommand(content)) {
      const parsed = parser.parse(content);
      const command = parsed.command ? registry.get(parsed.command) : undefined;
      if (command) {
        void command.execute(parsed.args ?? [], {
          sessionId,
          providerId: configRef.current.provider.activeProvider,
          modelId: configRef.current.provider.activeModel,
          emit: (msg: string) => setError(msg),
        }).then((result) => {
          if (result.action === 'list_models') {
            void agentRef.current?.listModels();
          } else if (result.action === 'switch_model' && result.output) {
            agentRef.current?.switchModel(result.output);
            // Persist to config file
            const configManager = new ConfigManager();
            const current = configManager.load();
            current.provider.activeModel = result.output;
            configManager.save(current);
          } else if (result.action === 'clear') {
            setMessages([]);
            agentRef.current?.clearHistory();
          } else if (result.action === 'exit') {
            process.exit(0);
          }
        });
        return;
      }
    }

    if (agentRef.current.processing) return;
    setError(null);
    void agentRef.current.sendMessage(content);
  }, [sessionId]);

  const selectModel = useCallback((model: ModelInfo) => {
    if (!agentRef.current) return;
    agentRef.current.switchModel(model.id);
    setModelPickerModels(null);
    setCurrentModel(model.id);
    // Persist to config
    const configManager = new ConfigManager();
    const current = configManager.load();
    current.provider.activeModel = model.id;
    configManager.save(current);
  }, []);

  const dismissModelPicker = useCallback(() => {
    setModelPickerModels(null);
  }, []);

  return {
    messages,
    streamingContent,
    isLoading,
    tokensUsed,
    tokensTotal,
    elapsed,
    error,
    sendMessage,
    sessionId,
    modelPickerModels,
    currentModel,
    selectModel,
    dismissModelPicker,
  };
}
