import { type FC } from 'react';
import { Box, Text, Static } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { Message, MessageRole } from '@agentx/shared';

interface MessageAreaProps {
  messages: Message[];
  streamingContent?: string;
}

export const MessageArea: FC<MessageAreaProps> = ({ messages, streamingContent }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Static items={messages}>
        {(message) => (
          <Box key={message.id} flexDirection="column" paddingX={1} marginBottom={1}>
            <MessageHeader role={message.role} timestamp={message.createdAt} />
            <Box paddingLeft={2}>
              <Text color={COLORS.text} wrap="wrap">
                {message.content}
              </Text>
            </Box>
            {message.toolCalls && message.toolCalls.length > 0 && (
              <Box paddingLeft={2} marginTop={0}>
                <Text color={COLORS.textDim} dimColor>
                  [{message.toolCalls.length} tool call{message.toolCalls.length > 1 ? 's' : ''}]
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {streamingContent && (
        <Box flexDirection="column" paddingX={1}>
          <MessageHeader role="assistant" />
          <Box paddingLeft={2}>
            <Text color={COLORS.text} wrap="wrap">
              {streamingContent}
              <Text color={COLORS.primary}>▊</Text>
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const MessageHeader: FC<{ role: MessageRole; timestamp?: string }> = ({ role, timestamp }) => {
  const roleConfig = getRoleConfig(role);

  return (
    <Box>
      <Text color={roleConfig.color} bold>{roleConfig.icon} {roleConfig.label}</Text>
      {timestamp && (
        <Text color={COLORS.textDim} dimColor>
          {' '}({formatTime(timestamp)})
        </Text>
      )}
    </Box>
  );
};

function getRoleConfig(role: MessageRole): { icon: string; label: string; color: string } {
  switch (role) {
    case 'user':
      return { icon: '▸', label: 'You', color: COLORS.info };
    case 'assistant':
      return { icon: '◆', label: 'Agent-X', color: COLORS.primary };
    case 'system':
      return { icon: '⚙', label: 'System', color: COLORS.textDim };
    case 'tool':
      return { icon: '⚡', label: 'Tool', color: COLORS.success };
    default:
      return { icon: '•', label: role, color: COLORS.textDim };
  }
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
