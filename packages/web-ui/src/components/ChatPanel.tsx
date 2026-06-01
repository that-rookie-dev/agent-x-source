import { useState, useRef, useCallback, useEffect } from 'react';
import Box from '@mui/material/Box';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';
import { WelcomeView } from './WelcomeView';
import type { ChatMessage, ToolCall, SubAgentActivity, StreamEvent } from '../types';
import { sendMessage } from '../api';

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeTools, setActiveTools] = useState<ToolCall[]>([]);
  const [activeAgents, setActiveAgents] = useState<SubAgentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const msgIdCounter = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamingContent, scrollToBottom]);

  const handleSend = useCallback((content: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${++msgIdCounter.current}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingContent('');
    setActiveTools([]);
    setActiveAgents([]);
    setIsLoading(true);

    const controller = sendMessage(
      content,
      (event: StreamEvent) => {
        switch (event.type) {
          case 'text_delta':
            setStreamingContent((prev) => prev + event.content);
            break;
          case 'tool_start':
            setActiveTools((prev) => [...prev, event.toolCall]);
            break;
          case 'tool_end':
            setActiveTools((prev) =>
              prev.map((t) => t.id === event.toolCallId ? { ...t, status: 'complete', result: event.result, endTime: Date.now() } : t)
            );
            break;
          case 'agent_spawn':
            setActiveAgents((prev) => [...prev, event.agent]);
            break;
          case 'agent_step':
            setActiveAgents((prev) =>
              prev.map((a) => a.id === event.agentId
                ? { ...a, steps: [...(a.steps ?? []), event.step] }
                : a
              )
            );
            break;
          case 'agent_done':
            setActiveAgents((prev) =>
              prev.map((a) => a.id === event.agentId
                ? { ...a, status: 'complete', summary: event.summary, endTime: Date.now() }
                : a
              )
            );
            break;
          case 'done':
            // handled in onDone
            break;
          case 'error':
            setStreamingContent((prev) => prev + `\n\n⚠️ ${event.message}`);
            break;
        }
      },
      () => {
        // onDone
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${++msgIdCounter.current}`,
            role: 'assistant',
            content: '',  // will be replaced by final state
            timestamp: Date.now(),
            toolCalls: [],
            subAgents: [],
          },
        ]);
        // Finalize: move streaming state into last message
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: '', // placeholder - replaced below
            },
          ];
        });
        // Use a microtask to capture the current streaming state
        setTimeout(() => {
          setStreamingContent((sc) => {
            setActiveTools((tools) => {
              setActiveAgents((agents) => {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (!last || last.role !== 'assistant') return prev;
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: sc, toolCalls: tools, subAgents: agents },
                  ];
                });
                return [];
              });
              return [];
            });
            return '';
          });
          setIsLoading(false);
        }, 0);
      },
      (err) => {
        setStreamingContent((prev) => prev + `\n\n❌ Error: ${err}`);
        setIsLoading(false);
      },
    );

    abortRef.current = controller;
  }, []);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const hasMessages = messages.length > 0 || streamingContent.length > 0;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Messages area */}
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {!hasMessages ? (
          <WelcomeView />
        ) : (
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            activeTools={activeTools}
            activeAgents={activeAgents}
            isLoading={isLoading}
          />
        )}
      </Box>

      {/* Input area */}
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
        isLoading={isLoading}
      />
    </Box>
  );
}
