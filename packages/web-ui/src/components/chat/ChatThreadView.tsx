import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import type { VisibleMessageItem, UIMessage } from '../../chat/types';
import type { CrewMatchCandidate } from '@agentx/shared/browser';
import { ChatMessageList } from '../../chat/ChatMessageList';
import { ThinkingIndicator } from './ThinkingIndicator';
import { colors } from '../../theme';

const ESTIMATED_ROW_PX = 120;
const VIRTUALIZE_THRESHOLD = 48;
const OVERSCAN = 6;
const TAIL_ALWAYS_VISIBLE = 4;

export function useVirtualMessageWindow(
  items: VisibleMessageItem[],
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const [range, setRange] = useState({ start: 0, end: items.length });

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el || !enabled || items.length < VIRTUALIZE_THRESHOLD) {
      setRange({ start: 0, end: items.length });
      return;
    }

    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ESTIMATED_ROW_PX) - OVERSCAN);
    const visibleCount = Math.ceil(viewHeight / ESTIMATED_ROW_PX) + OVERSCAN * 2;
    const tailStart = Math.max(0, items.length - TAIL_ALWAYS_VISIBLE);
    const end = Math.min(items.length, Math.max(start + visibleCount, tailStart));
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [containerRef, enabled, items.length]);

  useEffect(() => {
    recompute();
  }, [items.length, recompute]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => recompute();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, recompute]);

  const virtualized = enabled && items.length >= VIRTUALIZE_THRESHOLD;
  const visibleItems = useMemo(
    () => (virtualized ? items.slice(range.start, range.end) : items),
    [items, range.end, range.start, virtualized],
  );

  return {
    visibleItems,
    topSpacerPx: virtualized ? range.start * ESTIMATED_ROW_PX : 0,
    bottomSpacerPx: virtualized ? Math.max(0, (items.length - range.end) * ESTIMATED_ROW_PX) : 0,
  };
}

export interface ChatThreadViewProps {
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  sessionRestoring: boolean;
  messages: UIMessage[];
  streaming: boolean;
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  loadingSteps: Array<{ id: string; label: string; status: string }> | null;
  freezeMessageLayout: boolean;
  pendingFeedbackMessageId: string | null;
  feedbackSubmitting: boolean;
  turnActivityStage?: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onResend: (text: string) => void;
  onOpenChildSession: (props: { childSessionId: string; label: string; kind: 'sub_agent' | 'crew_worker'; status: 'running' | 'done' | 'error'; task?: string }) => void;
  onQuestionnaireRespond: (messageId: string, response: string) => void;
  onCrewRosterPickerSubmit: (messageId: string, selected: CrewMatchCandidate[]) => void;
  onCrewRosterPickerSkip: (messageId: string, dismissForSession?: boolean) => void;
  onViewCrewDossier: (candidate: CrewMatchCandidate) => void;
  onViewCrewByCallsign?: (callsign: string, name?: string) => void;
  onTurnFeedback: (messageId: string, rating: import('@agentx/shared/browser').TurnFeedbackRating) => void;
  onSaveMarkdown: (message: UIMessage) => void;
}

function ChatThreadViewComponent(props: ChatThreadViewProps) {
  const {
    messagesContainerRef,
    sessionRestoring,
    messages,
    streaming,
    loadingOlderMessages,
    hasOlderMessages,
    onLoadOlderMessages,
    loadingSteps,
    freezeMessageLayout,
    pendingFeedbackMessageId,
    feedbackSubmitting,
    turnActivityStage,
    bottomRef,
    onResend,
    onOpenChildSession,
    onQuestionnaireRespond,
    onCrewRosterPickerSubmit,
    onCrewRosterPickerSkip,
    onViewCrewDossier,
    onViewCrewByCallsign,
    onTurnFeedback,
    onSaveMarkdown,
  } = props;

  const visibleMessagesWithFlags = useMemo(() => {
    const visible = messages.filter((m) => {
      if (m.role === 'system') return false;
      if (m.role === 'assistant' && !m.content && !m.thinking && (!m.toolCalls || m.toolCalls.length === 0) && (!m.subAgents || m.subAgents.length === 0) && (!m.parts || m.parts.length === 0)) return false;
      return true;
    });
    let lastUserIdx = -1;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i]!.role === 'user') { lastUserIdx = i; break; }
    }
    return visible.map((msg, idx) => ({ msg, isLastUser: idx === lastUserIdx }));
  }, [messages]);

  const deferredVisibleMessagesWithFlags = useDeferredValue(visibleMessagesWithFlags);
  const threadMessagesWithFlags = streaming ? visibleMessagesWithFlags : deferredVisibleMessagesWithFlags;
  const visibleMessages = useMemo(() => threadMessagesWithFlags.map(item => item.msg), [threadMessagesWithFlags]);
  const turnStreaming = streaming && visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1]?.role === 'assistant';

  const { visibleItems, topSpacerPx, bottomSpacerPx } = useVirtualMessageWindow(
    threadMessagesWithFlags,
    messagesContainerRef,
    !freezeMessageLayout && !loadingOlderMessages,
  );

  return (
    <>
      {sessionRestoring && (
        <Box sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: colors.bg.primary,
        }}>
          <CircularProgress size={22} sx={{ color: colors.text.dim }} />
        </Box>
      )}

      {threadMessagesWithFlags.length === 0 && !streaming && !sessionRestoring && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Box sx={{ textAlign: 'center', maxWidth: 300 }}>
            <SmartToyIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 500, color: colors.text.secondary, mb: 0.5 }}>How can I help?</Typography>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, lineHeight: 1.5 }}>
              Send a message, attach files, or ask me to execute tasks.
            </Typography>
          </Box>
        </Box>
      )}

      {(loadingOlderMessages || hasOlderMessages) && threadMessagesWithFlags.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.75 }}>
          {loadingOlderMessages ? (
            <CircularProgress size={14} sx={{ color: colors.text.dim }} />
          ) : (
            <Box
              component="button"
              type="button"
              onClick={onLoadOlderMessages}
              sx={{
                border: `1px solid ${colors.border.default}`,
                bgcolor: colors.bg.secondary,
                color: colors.text.secondary,
                borderRadius: '999px',
                px: 1.25,
                py: 0.35,
                fontSize: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.3px',
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: colors.bg.tertiary,
                  color: colors.text.primary,
                  borderColor: colors.border.strong,
                },
              }}
            >
              Load more messages
            </Box>
          )}
        </Box>
      )}

      {topSpacerPx > 0 ? <Box sx={{ height: topSpacerPx, flexShrink: 0 }} aria-hidden /> : null}
      <ChatMessageList
        items={visibleItems}
        loadingSteps={loadingSteps}
        onResend={onResend}
        bottomRef={bottomRef}
        onOpenChildSession={onOpenChildSession}
        onQuestionnaireRespond={onQuestionnaireRespond}
        onCrewRosterPickerSubmit={onCrewRosterPickerSubmit}
        onCrewRosterPickerSkip={onCrewRosterPickerSkip}
        onViewCrewDossier={onViewCrewDossier}
        onViewCrewByCallsign={onViewCrewByCallsign}
        pendingFeedbackMessageId={sessionRestoring ? null : pendingFeedbackMessageId}
        onTurnFeedback={onTurnFeedback}
        onSaveMarkdown={onSaveMarkdown}
        feedbackSubmitting={feedbackSubmitting}
        turnStreaming={turnStreaming}
        turnActivityLabel={turnActivityStage}
        freezeLayout={freezeMessageLayout || loadingOlderMessages}
      />
      {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
        <ThinkingIndicator label={turnActivityStage ?? loadingSteps?.[0]?.label} />
      )}
      {bottomSpacerPx > 0 ? <Box sx={{ height: bottomSpacerPx, flexShrink: 0 }} aria-hidden /> : null}
    </>
  );
}

function threadPropsEqual(a: ChatThreadViewProps, b: ChatThreadViewProps): boolean {
  return a.sessionRestoring === b.sessionRestoring
    && a.messages === b.messages
    && a.streaming === b.streaming
    && a.loadingOlderMessages === b.loadingOlderMessages
    && a.hasOlderMessages === b.hasOlderMessages
    && a.onLoadOlderMessages === b.onLoadOlderMessages
    && a.loadingSteps === b.loadingSteps
    && a.freezeMessageLayout === b.freezeMessageLayout
    && a.pendingFeedbackMessageId === b.pendingFeedbackMessageId
    && a.feedbackSubmitting === b.feedbackSubmitting
    && a.turnActivityStage === b.turnActivityStage
    && a.onViewCrewByCallsign === b.onViewCrewByCallsign
    && a.onViewCrewDossier === b.onViewCrewDossier;
}

export const ChatThreadView = memo(ChatThreadViewComponent, threadPropsEqual);
