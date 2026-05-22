import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, EngineEvent, AgentXConfig } from '@agentx/shared';
import { Agent } from '@agentx/engine';
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

  const agentRef = useRef<Agent | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        case 'error':
          setError(event.message);
          break;
      }
    });

    agentRef.current = agent;
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
    if (!agentRef.current || agentRef.current.processing) return;
    setError(null);
    void agentRef.current.sendMessage(content);
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
  };
}
