import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor, MONO } from '../../theme';
import { sessions } from '../../api';
import { mapHistoryToUiMessages } from '../../chat/restoreMessages';
import { sanitizeVoiceDisplayText } from '../../voice/sanitize-display-text';
import type { UIMessage } from '../../chat/types';

const VOICE_SESSION_ID = '__channel__:voice';
/** Default window — matches chat recycler spirit, sized for the voice card. */
export const VOICE_TRANSCRIPT_PAGE = 25;
const VOICE_TRANSCRIPT_WINDOW_MAX = VOICE_TRANSCRIPT_PAGE * 2;

function messageText(m: UIMessage): string {
  const direct = (m.content || '').trim();
  const raw = direct || (Array.isArray(m.parts)
    ? m.parts
      .filter((p) => p.type === 'text' && typeof (p as { content?: string }).content === 'string')
      .map((p) => String((p as { content?: string }).content || ''))
      .join('')
      .trim()
    : '');
  return sanitizeVoiceDisplayText(raw);
}

/**
 * Call-style log transcript for the Voice Agent card (not chat bubbles).
 * Latest 25 messages; older pages load on demand with sliding-window recycle.
 */
export function VoiceTranscriptPanel({
  liveUser,
  liveAgent,
  refreshToken,
  agentLabel = 'Agent',
}: {
  liveUser?: string;
  liveAgent?: string;
  refreshToken?: string | number;
  /** Persona name for agent lines (defaults to "Agent"). */
  agentLabel?: string;
}) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Sticky live lines until history catch-up (assistant persist lags phase idle). */
  const [pendingUser, setPendingUser] = useState('');
  const [pendingAgent, setPendingAgent] = useState('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const liveCapRef = useRef(true);
  const detachedRef = useRef(false);
  const hasMessagesRef = useRef(false);
  hasMessagesRef.current = messages.length > 0;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const loadLatest = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true && hasMessagesRef.current;
    if (!soft) setLoading(true);
    try {
      const page = await sessions.getMessagesPage(VOICE_SESSION_ID, { limit: VOICE_TRANSCRIPT_PAGE });
      const mapped = mapHistoryToUiMessages(page.messages).filter(
        (m) => (m.role === 'user' || m.role === 'assistant') && messageText(m),
      );
      setMessages(mapped);
      setHasOlder(page.hasMore || mapped.length >= VOICE_TRANSCRIPT_PAGE);
      liveCapRef.current = true;
      detachedRef.current = false;
      requestAnimationFrame(() => scrollToBottom('auto'));
    } catch {
      if (!soft) {
        setMessages([]);
        setHasOlder(false);
      }
    } finally {
      if (!soft) setLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    const soft = hasMessagesRef.current;
    void loadLatest({ soft });
    // Assistant rows often land slightly after the UI returns to idle.
    if (refreshToken !== undefined && refreshToken !== 'live') {
      const t1 = window.setTimeout(() => { void loadLatest({ soft: true }); }, 350);
      const t2 = window.setTimeout(() => { void loadLatest({ soft: true }); }, 1100);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    return undefined;
  }, [loadLatest, refreshToken]);

  useEffect(() => {
    if (!liveCapRef.current) return;
    if (messages.length <= VOICE_TRANSCRIPT_PAGE) return;
    setHasOlder(true);
    setMessages((prev) => (prev.length > VOICE_TRANSCRIPT_PAGE ? prev.slice(-VOICE_TRANSCRIPT_PAGE) : prev));
  }, [messages.length]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    const first = messages.find((m) => m.role === 'user' || m.role === 'assistant');
    if (!first?.id) return;
    setLoadingOlder(true);
    liveCapRef.current = false;
    const el = scrollerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await sessions.getMessagesPage(VOICE_SESSION_ID, {
        limit: VOICE_TRANSCRIPT_PAGE,
        before: first.id,
      });
      const older = mapHistoryToUiMessages(page.messages).filter(
        (m) => (m.role === 'user' || m.role === 'assistant') && messageText(m),
      );
      if (!older.length) {
        setHasOlder(false);
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !seen.has(m.id));
        if (!prepend.length) return prev;
        let next = [...prepend, ...prev];
        if (next.length > VOICE_TRANSCRIPT_WINDOW_MAX) {
          next = next.slice(0, next.length - VOICE_TRANSCRIPT_PAGE);
          detachedRef.current = true;
        }
        return next;
      });
      setHasOlder(page.hasMore);
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* best-effort */
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadingOlder, messages]);

  const liveUserClean = sanitizeVoiceDisplayText(liveUser || '');
  const liveAgentClean = sanitizeVoiceDisplayText(liveAgent || '');

  useEffect(() => {
    if (liveUserClean) setPendingUser(liveUserClean);
  }, [liveUserClean]);

  useEffect(() => {
    if (liveAgentClean) setPendingAgent(liveAgentClean);
  }, [liveAgentClean]);

  // Avoid duplicate lines when history already includes the same utterance
  // (common while Local engine is thinking after STT persists the user turn).
  const lastUserText = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === 'user') return messageText(m);
    }
    return '';
  })();
  const lastAgentText = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === 'assistant') return messageText(m);
    }
    return '';
  })();

  useEffect(() => {
    if (pendingUser && pendingUser === lastUserText) setPendingUser('');
  }, [pendingUser, lastUserText]);

  useEffect(() => {
    if (pendingAgent && pendingAgent === lastAgentText) setPendingAgent('');
  }, [pendingAgent, lastAgentText]);

  const displayUser = liveUserClean || pendingUser;
  const displayAgent = liveAgentClean || pendingAgent;
  const showLiveUser = Boolean(displayUser) && displayUser !== lastUserText;
  const showLiveAgent = Boolean(displayAgent) && displayAgent !== lastAgentText;

  useEffect(() => {
    if (showLiveUser || showLiveAgent) scrollToBottom('smooth');
  }, [showLiveUser, showLiveAgent, displayUser, displayAgent, scrollToBottom]);

  return (
    <Box sx={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: { xs: 'none', sm: `1px solid ${colors.border.subtle}` },
      borderTop: { xs: `1px solid ${colors.border.subtle}`, sm: 'none' },
      bgcolor: alphaColor(colors.bg.primary, '55'),
    }}>
      <Box sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.1,
        py: 0.55,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Typography sx={{
          fontSize: '0.52rem',
          fontFamily: MONO,
          letterSpacing: '1.2px',
          color: colors.text.dim,
          textTransform: 'uppercase',
        }}>
          Transcript
        </Typography>
        {detachedRef.current && (
          <Box
            component="button"
            type="button"
            onClick={() => { void loadLatest(); }}
            sx={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: '0.5rem',
              fontFamily: MONO,
              color: colors.accent.blue,
              '&:hover': { color: colors.text.primary },
            }}
          >
            Latest
          </Box>
        )}
      </Box>

      <Box
        ref={scrollerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.15,
          py: 0.85,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          bgcolor: alphaColor(colors.bg.tertiary, '40'),
        }}
      >
        {hasOlder && (
          <Box
            component="button"
            type="button"
            onClick={() => { void loadOlder(); }}
            disabled={loadingOlder}
            sx={{
              all: 'unset',
              cursor: loadingOlder ? 'default' : 'pointer',
              alignSelf: 'center',
              px: 1,
              py: 0.3,
              mb: 0.15,
              borderRadius: '999px',
              border: `1px solid ${colors.border.default}`,
              fontSize: '0.48rem',
              fontFamily: MONO,
              letterSpacing: '0.08em',
              color: colors.text.dim,
              '&:hover': { color: colors.text.secondary, borderColor: colors.border.strong },
            }}
          >
            {loadingOlder ? 'LOADING…' : 'EARLIER'}
          </Box>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={14} sx={{ color: colors.text.dim }} />
          </Box>
        ) : messages.length === 0 && !showLiveUser && !showLiveAgent ? (
          <Typography sx={{
            fontSize: '0.6rem',
            fontFamily: MONO,
            color: colors.text.dim,
            py: 1.5,
          }}>
            Waiting for voice…
          </Typography>
        ) : (
          messages.map((m) => (
            <LogLine
              key={m.id}
              role={m.role === 'user' ? 'operator' : 'agent'}
              text={messageText(m)}
              agentLabel={agentLabel}
            />
          ))
        )}

        {showLiveUser && (
          <LogLine
            role="operator"
            text={displayUser}
            live={Boolean(liveUserClean)}
            agentLabel={agentLabel}
          />
        )}
        {showLiveAgent && (
          <LogLine
            role="agent"
            text={displayAgent}
            live={Boolean(liveAgentClean)}
            agentLabel={agentLabel}
          />
        )}
      </Box>
    </Box>
  );
}

function LogLine({
  role,
  text,
  live,
  agentLabel = 'Agent',
}: {
  role: 'operator' | 'agent';
  text: string;
  live?: boolean;
  agentLabel?: string;
}) {
  const color = role === 'operator' ? colors.accent.green : colors.accent.blue;
  const label = role === 'operator' ? 'You' : agentLabel;
  return (
    <Box sx={{ opacity: live ? 0.75 : 1 }}>
      <Typography sx={{
        fontFamily: MONO,
        fontSize: '0.48rem',
        letterSpacing: '0.06em',
        color,
        mb: 0.15,
      }}>
        {label}{live ? ' · live' : ''}
      </Typography>
      <Typography sx={{
        fontFamily: MONO,
        fontSize: '0.65rem',
        color: live ? colors.text.dim : colors.text.secondary,
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </Typography>
    </Box>
  );
}
