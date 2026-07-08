import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { colors, alphaColor } from '../theme';
import { sessions, type ChatMessage } from '../api';
import { CrewAwareMarkdown } from './ChatMarkdown';
import { stripToolNoise } from './utils';

export interface ChildSessionDrawerState {
  childSessionId: string;
  label: string;
  kind: 'sub_agent' | 'crew_worker';
}

interface ChildSessionDrawerProps {
  open: boolean;
  state: ChildSessionDrawerState | null;
  parentSessionTitle?: string;
  onClose: () => void;
}

export function ChildSessionDrawer({ open, state, parentSessionTitle, onClose }: ChildSessionDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskExpanded, setTaskExpanded] = useState(false);

  useEffect(() => {
    if (!open || !state?.childSessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTaskExpanded(false);
    sessions.preview(state.childSessionId)
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, state?.childSessionId]);

  if (!open || !state) return null;

  const accent = state.kind === 'crew_worker' ? colors.accent.purple : colors.accent.cyan;
  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const taskText = userMessages.map((m) => stripToolNoise(m.content || '')).join('\n\n').trim();

  return (
    <>
      <Box
        onClick={onClose}
        sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: alphaColor(colors.bg.primary, 0.55),
          zIndex: 20,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 88,
          maxHeight: 'min(58vh, 520px)',
          zIndex: 21,
          borderRadius: '14px',
          border: `1px solid ${alphaColor(accent, '40')}`,
          bgcolor: colors.bg.primary,
          boxShadow: `0 12px 40px ${colors.shadow.heavy}, 0 0 0 1px ${alphaColor(accent, '15')} inset`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'agentx-fadeIn 0.2s ease-out',
        }}
      >
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${colors.border.subtle}`,
          bgcolor: colors.bg.secondary,
        }}>
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.5 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>
              {state.label}
            </Typography>
            <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {state.kind === 'crew_worker' ? 'Crew worker session' : 'Sub-agent session'}
              {parentSessionTitle ? ` · from ${parentSessionTitle}` : ''}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        <Box sx={{
          flex: 1,
          overflow: 'auto',
          px: 1.5,
          py: 1.25,
          scrollbarWidth: 'thin',
        }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} sx={{ color: accent }} />
            </Box>
          )}
          {error && (
            <Typography sx={{ fontSize: '0.65rem', color: colors.accent.red, py: 2 }}>{error}</Typography>
          )}
          {!loading && !error && messages.length === 0 && (
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, py: 2, fontStyle: 'italic' }}>
              No messages yet — work may still be in progress.
            </Typography>
          )}
          {!loading && taskText && (
            <Box sx={{
              mb: 1.25,
              borderRadius: '8px',
              border: `1px solid ${colors.border.subtle}`,
              bgcolor: colors.bg.secondary,
              overflow: 'hidden',
            }}>
              <Box
                onClick={() => setTaskExpanded((v) => !v)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  px: 1,
                  py: 0.5,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: colors.bg.tertiary },
                }}
              >
                <Typography sx={{
                  fontSize: '0.48rem',
                  fontWeight: 600,
                  color: colors.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}>
                  Task brief · sent to model
                </Typography>
                <IconButton size="small" sx={{ p: 0.2 }}>
                  {taskExpanded
                    ? <ExpandLessIcon sx={{ fontSize: 12, color: colors.text.dim }} />
                    : <ExpandMoreIcon sx={{ fontSize: 12, color: colors.text.dim }} />}
                </IconButton>
              </Box>
              <Collapse in={taskExpanded}>
                <Typography sx={{
                  px: 1,
                  pb: 0.75,
                  fontSize: '0.58rem',
                  color: colors.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  opacity: 0.85,
                }}>
                  {taskText}
                </Typography>
              </Collapse>
              {!taskExpanded && (
                <Typography sx={{
                  px: 1,
                  pb: 0.6,
                  fontSize: '0.55rem',
                  color: colors.text.dim,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: 0.7,
                }}>
                  {taskText}
                </Typography>
              )}
            </Box>
          )}
          {!loading && assistantMessages.map((m, i) => (
            <Box key={(m.id as string) ?? `a-${i}`} sx={{ mb: 1.5 }}>
              <Typography sx={{
                fontSize: '0.5rem',
                fontWeight: 600,
                color: accent,
                fontFamily: "'JetBrains Mono', monospace",
                mb: 0.35,
                textTransform: 'uppercase',
              }}>
                {state.label}
              </Typography>
              {m.content && (
                <Box sx={{ fontSize: '0.72rem', color: colors.text.secondary, lineHeight: 1.55 }}>
                  <CrewAwareMarkdown content={stripToolNoise(m.content)} />
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </>
  );
}
