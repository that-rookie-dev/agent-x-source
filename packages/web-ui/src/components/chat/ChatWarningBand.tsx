import { useCallback, useMemo, useState, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { colors, alphaColor } from '../../theme';

function formatWarningsForCopy(messages: string[]): string {
  if (messages.length === 1) return messages[0]!;
  return messages.map((m) => `• ${m}`).join('\n');
}

interface Props {
  warnings: string[];
  sendBlocked: boolean;
  sendBlockedReason: string;
  configLoaded: boolean;
}

/** Thin full-width band at the top of the chat window for warnings and errors. */
export const ChatWarningBand = memo(function ChatWarningBand({ warnings, sendBlocked, sendBlockedReason, configLoaded }: Props) {
  const [copied, setCopied] = useState(false);

  const messages = useMemo(() => {
    const items = [...warnings];
    if (sendBlocked && configLoaded && sendBlockedReason) {
      items.unshift(sendBlockedReason);
    }
    return items;
  }, [warnings, sendBlocked, configLoaded, sendBlockedReason]);

  const handleCopy = useCallback(async () => {
    if (messages.length === 0) return;
    try {
      await navigator.clipboard.writeText(formatWarningsForCopy(messages));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in some contexts.
    }
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.75,
        px: 1.5,
        py: 0.55,
        bgcolor: alphaColor(colors.accent.orange, '16'),
        borderBottom: `1px solid ${alphaColor(colors.accent.orange, '28')}`,
        flexShrink: 0,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, py: 0.1 }}>
        {messages.length === 1 ? (
          <Typography sx={{
            fontSize: '0.58rem',
            color: colors.accent.orange,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 500,
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}>
            {messages[0]}
          </Typography>
        ) : (
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 1.75,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.2,
            }}
          >
            {messages.map((msg, i) => (
              <Typography
                key={i}
                component="li"
                sx={{
                  fontSize: '0.58rem',
                  color: colors.accent.orange,
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 500,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                }}
              >
                {msg}
              </Typography>
            ))}
          </Box>
        )}
      </Box>

      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          onClick={() => { void handleCopy(); }}
          sx={{
            color: alphaColor(colors.accent.orange, 'cc'),
            p: 0.35,
            mt: -0.1,
            flexShrink: 0,
            '&:hover': { bgcolor: alphaColor(colors.accent.orange, '18') },
          }}
        >
          {copied
            ? <CheckIcon sx={{ fontSize: 13 }} />
            : <ContentCopyIcon sx={{ fontSize: 13 }} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
});
