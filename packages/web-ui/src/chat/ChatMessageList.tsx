import { useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ReplayIcon from '@mui/icons-material/Replay';
import type { VisibleMessageItem, UIMessage } from './types';
import { ChatMessageTurn } from './ChatMessageTurn';
import { ChatUserMessage } from './ChatUserMessage';
import { ChatModeChangeChip } from './ChatModeChangeChip';

interface ChatMessageListProps {
  items: VisibleMessageItem[];
  loadingSteps: Array<{ id: string; label: string; status: string }> | null;
  onResend: (text: string) => void;
  bottomRef: React.RefObject<HTMLDivElement>;
  onOpenChildSession?: (props: { childSessionId: string; label: string; kind: 'sub_agent' | 'crew_worker'; status: 'running' | 'done' | 'error'; task?: string }) => void;
}

/** Virtual-ish message list — content-visibility keeps long sessions smooth. */
export function ChatMessageList({ items, loadingSteps, onResend, bottomRef, onOpenChildSession }: ChatMessageListProps) {
  const renderMessage = useCallback((msg: UIMessage, idx: number) => {
    const isLast = idx === items.length - 1;
    const hasText = !!(msg.content?.trim() || msg.parts?.some((p) => p.type === 'text' && p.content?.trim()));
    const showLoading = isLast && msg.streaming && !hasText;

    if (msg.isModeChange) {
      return <ChatModeChangeChip from={msg.isModeChange.from} to={msg.isModeChange.to} />;
    }
    if (msg.role === 'user') {
      return <ChatUserMessage message={msg} />;
    }
    return <ChatMessageTurn message={msg} loadingSteps={showLoading ? loadingSteps : null} onOpenChildSession={onOpenChildSession} />;
  }, [items.length, loadingSteps, onOpenChildSession]);

  return (
    <>
      {items.map(({ msg, isLastUser }, idx) => (
        <Box
          key={msg.id}
          sx={{
            contentVisibility: 'auto',
            containIntrinsicSize: '0 120px',
            contain: 'layout style paint',
          }}
        >
          {renderMessage(msg, idx)}
          {isLastUser && msg.content && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%', mt: -1, mb: 0.5, mr: 5 }}>
              <IconButton size="small" onClick={() => onResend(msg.content)}
                sx={{ p: 0.3, opacity: 0.4, '&:hover': { opacity: 1, bgcolor: 'transparent' } }}>
                <ReplayIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Box>
          )}
        </Box>
      ))}
      <div ref={bottomRef} />
    </>
  );
}
