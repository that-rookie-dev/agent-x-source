import React, { useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import QueueIcon from '@mui/icons-material/PlaylistAdd';
import RouteIcon from '@mui/icons-material/Route';
import { MentionInput, type MentionInputHandle } from './MentionInput';
import { CrewMentionMenu } from './ChatEnhancements';
import { colors, alphaColor } from '../theme';
import type { Crew } from '../api';

export interface ChatInputBarHandle {
  clear: () => void;
  setText: (text: string) => void;
}

export interface ChatInputBarProps {
  streaming: boolean;
  inputDisabled?: boolean;
  sendBlocked: boolean;
  sendBlockedReason: string;
  hasAttachments: boolean;
  crewList: Crew[];
  disableMentions?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onStopAndSend: (text: string) => void;
  onAddToQueue: (text: string) => void;
  onSteer: (text: string) => void;
  /** Increment to clear input from parent (e.g. after clarification submit). */
  clearSignal?: number;
  /** Optional voice mic control rendered beside send button. */
  voiceSlot?: React.ReactNode;
  onComposerStateChange?: (state: { focused: boolean; empty: boolean }) => void;
}

const ChatInputBarComponent = React.forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar({
  streaming,
  inputDisabled = false,
  sendBlocked,
  sendBlockedReason,
  hasAttachments,
  crewList,
  disableMentions = false,
  placeholder = '@agentx — message your AI wingman...',
  onSend,
  onCancel,
  onStopAndSend,
  onAddToQueue,
  onSteer,
  clearSignal,
  voiceSlot,
  onComposerStateChange,
}, ref) {
  const mentionInputRef = useRef<MentionInputHandle>(null);
  const mentionActiveRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCrewMention, setShowCrewMention] = useState(false);
  const [sendMenuAnchor, setSendMenuAnchor] = useState<null | HTMLElement>(null);
  const [hasText, setHasText] = useState(false);
  const composerFocusedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    clear: () => {
      mentionInputRef.current?.clear();
      setHasText(false);
    },
    setText: (text: string) => {
      mentionInputRef.current?.setValue(text);
      setHasText(text.trim().length > 0);
    },
  }), []);

  useEffect(() => {
    const active = mentionQuery !== null;
    mentionActiveRef.current = active;
    setShowCrewMention(active);
  }, [mentionQuery]);

  useEffect(() => {
    if (clearSignal !== undefined && clearSignal > 0) {
      mentionInputRef.current?.clear();
      setHasText(false);
    }
  }, [clearSignal]);

  const handleMentionQuery = useCallback((q: string | null) => {
    if (disableMentions) return;
    setMentionQuery(q);
  }, [disableMentions]);

  const handleTextChange = useCallback((text: string) => {
    const empty = text.trim().length === 0;
    setHasText(!empty);
    onComposerStateChange?.({ focused: composerFocusedRef.current, empty });
  }, [onComposerStateChange]);

  const handleFocusChange = useCallback((focused: boolean) => {
    composerFocusedRef.current = focused;
    onComposerStateChange?.({ focused, empty: !hasText });
  }, [hasText, onComposerStateChange]);

  const handleMentionSelect = useCallback((crew: Crew) => {
    mentionActiveRef.current = false;
    mentionInputRef.current?.insertMention(crew.callsign);
    setShowCrewMention(false);
    setMentionQuery(null);
  }, []);

  const clearAndGetText = useCallback(() => {
    const text = mentionInputRef.current?.getValue().trim() ?? '';
    mentionInputRef.current?.clear();
    setHasText(false);
    return text;
  }, []);

  const handleSendClick = useCallback(() => {
    if (inputDisabled) return;
    const text = mentionInputRef.current?.getValue().trim() ?? '';
    if (!text && !hasAttachments) return;
    onSend(text);
  }, [hasAttachments, onSend, inputDisabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (inputDisabled) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionActiveRef.current) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick, inputDisabled]);

  const canSend = !inputDisabled && !sendBlocked && (hasText || hasAttachments);

  return (
    <>
      {showCrewMention && !disableMentions && (
        <CrewMentionMenu
          query={mentionQuery ?? ''}
          crewList={crewList}
          onSelect={handleMentionSelect}
          onClose={() => setShowCrewMention(false)}
        />
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.25, py: 0.5 }}>
        <MentionInput
          ref={mentionInputRef}
          onKeyDown={handleKeyDown}
          onMentionQuery={handleMentionQuery}
          onTextChange={handleTextChange}
          onFocusChange={handleFocusChange}
          placeholder={placeholder}
          crewList={disableMentions ? [] : crewList}
          disabled={inputDisabled}
        />

        {streaming ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <IconButton size="small" onClick={onCancel} sx={{ color: colors.accent.red, p: 0.5 }}>
              <StopIcon sx={{ fontSize: 20 }} />
            </IconButton>
            {hasText && (
              <IconButton size="small" onClick={(e) => setSendMenuAnchor(e.currentTarget)} sx={{ color: colors.text.dim, p: 0.25 }}>
                <ExpandMoreIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        ) : (
          <>
            {voiceSlot}
            <Tooltip title={sendBlocked && sendBlockedReason ? sendBlockedReason : ''} arrow disableHoverListener={!sendBlocked || !sendBlockedReason}>
            <span>
              <IconButton
                size="small"
                onClick={handleSendClick}
                disabled={!canSend}
                sx={{ color: sendBlocked ? colors.accent.red : colors.accent.blue, p: 0.5, '&.Mui-disabled': { color: sendBlocked ? alphaColor(colors.accent.red, '80') : colors.text.dim } }}
              >
                <SendIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </Tooltip>
          </>
        )}

        <Menu anchorEl={sendMenuAnchor} open={Boolean(sendMenuAnchor)} onClose={() => setSendMenuAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
          <MenuItem onClick={() => { setSendMenuAnchor(null); onStopAndSend(clearAndGetText()); }} sx={{ fontSize: '0.7rem', py: 0.75 }}>
            <StopIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.red }} />
            <Box>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Stop and Send</Typography>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Cancel current task, send this message</Typography>
            </Box>
          </MenuItem>
          <MenuItem onClick={() => { setSendMenuAnchor(null); onAddToQueue(clearAndGetText()); }} sx={{ fontSize: '0.7rem', py: 0.75 }}>
            <QueueIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.blue }} />
            <Box>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Add to Queue</Typography>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Send after current task completes</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, ml: 'auto', pl: 1 }}>⌥Enter</Typography>
          </MenuItem>
          <MenuItem onClick={() => { setSendMenuAnchor(null); onSteer(clearAndGetText()); }} sx={{ fontSize: '0.7rem', py: 0.75 }}>
            <RouteIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.orange }} />
            <Box>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Steer with Message</Typography>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Redirect agent mid-task</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, ml: 'auto', pl: 1 }}>⌥Enter</Typography>
          </MenuItem>
        </Menu>
      </Box>
    </>
  );
});

export const ChatInputBar = React.memo(ChatInputBarComponent);
