import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ChatMessage } from '../types';
import { palette } from '../theme';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      {/* Avatar */}
      <Box
        sx={{
          width: 28,
          height: 28,
          minWidth: 28,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isUser ? palette.bg.elevated : 'transparent',
          border: `1px solid ${isUser ? palette.border.default : palette.border.subtle}`,
          mt: 0.25,
        }}
      >
        {isUser ? (
          <PersonIcon sx={{ fontSize: 16, color: palette.text.secondary }} />
        ) : (
          <SmartToyIcon sx={{ fontSize: 16, color: palette.accent.blue }} />
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: isUser ? palette.text.secondary : palette.accent.blue,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.7rem',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}
        >
          {isUser ? 'You' : 'Agent-X'}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          {isUser ? (
            <Typography
              variant="body1"
              sx={{ color: palette.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {message.content}
            </Typography>
          ) : (
            <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
