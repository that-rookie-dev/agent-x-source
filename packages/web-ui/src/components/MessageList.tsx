import Box from '@mui/material/Box';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { SubAgentCard } from './SubAgentCard';
import { StreamingIndicator } from './StreamingIndicator';
import type { ChatMessage, ToolCall, SubAgentActivity } from '../types';
import { palette } from '../theme';

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  activeTools: ToolCall[];
  activeAgents: SubAgentActivity[];
  isLoading: boolean;
}

export function MessageList({ messages, streamingContent, activeTools, activeAgents, isLoading }: MessageListProps) {
  return (
    <Box sx={{ flex: 1, px: { xs: 2, md: 4 }, py: 3, maxWidth: 900, mx: 'auto', width: '100%' }}>
      {messages.map((msg) => (
        <Box key={msg.id} sx={{ mb: 3 }}>
          <MessageBubble message={msg} />
          {/* Completed tool calls for this message */}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <Box sx={{ mt: 1.5, ml: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {msg.toolCalls.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </Box>
          )}
          {/* Completed sub-agents for this message */}
          {msg.subAgents && msg.subAgents.length > 0 && (
            <Box sx={{ mt: 1.5, ml: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {msg.subAgents.map((ag) => (
                <SubAgentCard key={ag.id} agent={ag} />
              ))}
            </Box>
          )}
        </Box>
      ))}

      {/* Currently streaming response */}
      {(isLoading || streamingContent) && (
        <Box sx={{ mb: 3 }}>
          {/* Active sub-agents (in-progress) */}
          {activeAgents.length > 0 && (
            <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {activeAgents.map((ag) => (
                <SubAgentCard key={ag.id} agent={ag} />
              ))}
            </Box>
          )}

          {/* Active tool calls (in-progress) */}
          {activeTools.length > 0 && (
            <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {activeTools.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </Box>
          )}

          {/* Streaming text */}
          {streamingContent && (
            <MessageBubble
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingContent,
                timestamp: Date.now(),
                isStreaming: true,
              }}
            />
          )}

          {/* Loading indicator when no content yet */}
          {isLoading && !streamingContent && activeTools.length === 0 && activeAgents.length === 0 && (
            <StreamingIndicator />
          )}
        </Box>
      )}

      {/* Bottom padding for scroll */}
      <Box sx={{ height: 24, borderLeft: `2px solid ${palette.border.subtle}`, ml: 1 }} />
    </Box>
  );
}
