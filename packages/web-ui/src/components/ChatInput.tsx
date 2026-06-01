import { useState, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import SendIcon from '@mui/icons-material/ArrowUpward';
import StopIcon from '@mui/icons-material/Stop';
import { palette } from '../theme';

interface ChatInputProps {
  onSend: (message: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, onCancel, isLoading }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  }, [value, isLoading, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '44px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  return (
    <Box
      sx={{
        p: 2,
        borderTop: `1px solid ${palette.border.subtle}`,
        bgcolor: palette.bg.primary,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1,
          bgcolor: palette.bg.secondary,
          border: `1px solid ${palette.border.default}`,
          borderRadius: 2.5,
          px: 2,
          py: 1,
          transition: 'border-color 0.2s',
          '&:focus-within': { borderColor: palette.border.strong },
        }}
      >
        <Box
          component="textarea"
          ref={textareaRef}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Ask Agent-X anything..."
          sx={{
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            bgcolor: 'transparent',
            color: palette.text.primary,
            fontFamily: "'Inter', sans-serif",
            fontSize: '0.875rem',
            lineHeight: 1.5,
            height: '44px',
            maxHeight: '200px',
            py: 0.5,
            '&::placeholder': { color: palette.text.dim },
          }}
        />
        {isLoading ? (
          <Tooltip title="Stop generation">
            <IconButton
              size="small"
              onClick={onCancel}
              sx={{
                bgcolor: palette.accent.red,
                color: '#fff',
                width: 32,
                height: 32,
                '&:hover': { bgcolor: '#d63a33' },
              }}
            >
              <StopIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Send message (Enter)">
            <span>
              <IconButton
                size="small"
                onClick={handleSubmit}
                disabled={!value.trim()}
                sx={{
                  bgcolor: value.trim() ? palette.text.primary : palette.bg.hover,
                  color: value.trim() ? palette.bg.primary : palette.text.dim,
                  width: 32,
                  height: 32,
                  '&:hover': { bgcolor: '#ccc' },
                  '&.Mui-disabled': { bgcolor: palette.bg.hover, color: palette.text.dim },
                }}
              >
                <SendIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ mt: 0.75, textAlign: 'center' }}>
        <Box
          component="span"
          sx={{
            fontSize: '0.65rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: palette.text.dim,
            letterSpacing: '0.5px',
          }}
        >
          Agent-X can make mistakes. Verify important information.
        </Box>
      </Box>
    </Box>
  );
}
