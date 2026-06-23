import React, { useState, useRef, useCallback, useEffect } from 'react';
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
import { colors } from '../theme';
import type { Crew } from '../api';

export interface ChatInputBarProps {
  streaming: boolean;
  sendBlocked: boolean;
  sendBlockedReason: string;
  hasAttachments: boolean;
  crewList: Crew[];
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onStopAndSend: (text: string) => void;
  onAddToQueue: (text: string) => void;
  onSteer: (text: string) => void;
  /** Increment to clear input from parent (e.g. after clarification submit). */
  clearSignal?: number;
}

function ChatInputBarComponent({
  streaming,
  sendBlocked,
  sendBlockedReason,
  hasAttachments,
  crewList,
  placeholder = '@agentx — message your AI wingman...',
  onSend,
  onCancel,
  onStopAndSend,
  onAddToQueue,
  onSteer,
  clearSignal,
}: ChatInputBarProps) {
  const mentionInputRef = useRef<MentionInputHandle>(null);
  const mentionActiveRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCrewMention, setShowCrewMention] = useState(false);
  const [sendMenuAnchor, setSendMenuAnchor] = useState<null | HTMLElement>(null);
  const [hasText, setHasText] = useState(false);

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
    setMentionQuery(q);
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setHasText(text.trim().length > 0);
  }, []);

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
    const text = clearAndGetText();
    if (!text && !hasAttachments) return;
    onSend(text);
  }, [clearAndGetText, hasAttachments, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionActiveRef.current) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick]);

  const canSend = !sendBlocked && (hasText || hasAttachments);

  return (
    <>
      {showCrewMention && (
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
          placeholder={placeholder}
          crewList={crewList}
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
          <Tooltip title={sendBlocked ? sendBlockedReason : ''} arrow disableHoverListener={!sendBlocked}>
            <span>
              <IconButton
                size="small"
                onClick={handleSendClick}
                disabled={!canSend}
                sx={{ color: sendBlocked ? colors.accent.red : colors.accent.blue, p: 0.5, '&.Mui-disabled': { color: sendBlocked ? colors.accent.red + '80' : colors.text.dim } }}
              >
                <SendIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </Tooltip>
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
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, ml: 'auto', pl: 1 }}>Enter</Typography>
          </MenuItem>
        </Menu>
      </Box>
    </>
  );
}

export const ChatInputBar = React.memo(ChatInputBarComponent);
