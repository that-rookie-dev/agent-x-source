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
import { ComposerMentionMenu, type ComposerFileHit, type ComposerFolderHit, type ComposerKbHit } from './ComposerMentionMenu';
import { colors, alphaColor } from '../theme';
import type { Crew } from '../api';

export interface ChatInputBarHandle {
  clear: () => void;
  setText: (text: string) => void;
  /** Insert an upload chip at the caret (from + / drag-drop). */
  insertAttachmentChip: (attachment: { id: string; name: string }) => void;
}

export interface ChatInputBarProps {
  streaming: boolean;
  inputDisabled?: boolean;
  sendBlocked: boolean;
  sendBlockedReason: string;
  hasAttachments: boolean;
  crewList: Crew[];
  /**
   * Hide the Crew category in the @ picker.
   * Directory (and future attach types) stay available in every session type.
   * Crew mentions are group-session only.
   */
  disableCrew?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onStopAndSend: (text: string) => void;
  onAddToQueue: (text: string) => void;
  onSteer: (text: string) => void;
  /** Workspace file picked via @ — parent adds to attachments. */
  onAttachWorkspaceFile?: (file: ComposerFileHit & { id: string }) => void;
  /** Workspace folder picked via @ Select this folder — parent adds to attachments. */
  onAttachWorkspaceFolder?: (folder: ComposerFolderHit & { id: string }) => void;
  onRemoveAttachmentById?: (id: string) => void;
  clearSignal?: number;
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
  disableCrew = false,
  placeholder = '@ to attach files, folders, or Knowledge Base docs…',
  onSend,
  onCancel,
  onStopAndSend,
  onAddToQueue,
  onSteer,
  onAttachWorkspaceFile,
  onAttachWorkspaceFolder,
  onRemoveAttachmentById,
  clearSignal,
  voiceSlot,
  onComposerStateChange,
}, ref) {
  const mentionInputRef = useRef<MentionInputHandle>(null);
  const mentionActiveRef = useRef(false);
  const mentionMenuOpenRef = useRef(false);
  const suppressSendRef = useRef(false);
  const hasTextRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [sendMenuAnchor, setSendMenuAnchor] = useState<null | HTMLElement>(null);
  const [hasText, setHasText] = useState(false);
  const composerFocusedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    clear: () => {
      mentionInputRef.current?.clear();
      hasTextRef.current = false;
      setHasText(false);
    },
    setText: (text: string) => {
      mentionInputRef.current?.setValue(text);
      const next = text.trim().length > 0;
      hasTextRef.current = next;
      setHasText(next);
    },
    insertAttachmentChip: (attachment) => {
      mentionInputRef.current?.insertAttachmentChip(attachment);
      hasTextRef.current = true;
      setHasText(true);
    },
  }), []);

  useEffect(() => {
    const active = mentionQuery !== null;
    mentionActiveRef.current = active;
    mentionMenuOpenRef.current = active;
    setShowMentionMenu(active);
  }, [mentionQuery]);

  useEffect(() => {
    if (clearSignal !== undefined && clearSignal > 0) {
      mentionInputRef.current?.clear();
      hasTextRef.current = false;
      setHasText(false);
    }
  }, [clearSignal]);

  const handleMentionQuery = useCallback((q: string | null) => {
    setMentionQuery(q);
  }, []);

  const handleTextChange = useCallback((text: string) => {
    const empty = text.trim().length === 0;
    const nextHas = !empty;
    if (nextHas !== hasTextRef.current) {
      hasTextRef.current = nextHas;
      setHasText(nextHas);
      onComposerStateChange?.({ focused: composerFocusedRef.current, empty });
    }
  }, [onComposerStateChange]);

  const handleFocusChange = useCallback((focused: boolean) => {
    composerFocusedRef.current = focused;
    onComposerStateChange?.({ focused, empty: !hasTextRef.current });
  }, [onComposerStateChange]);

  const closeMentionMenu = useCallback(() => {
    mentionActiveRef.current = false;
    mentionMenuOpenRef.current = false;
    setShowMentionMenu(false);
    setMentionQuery(null);
  }, []);

  const handleMentionSelect = useCallback((crew: Crew) => {
    // Block send-on-Enter across this event + next tick (menu closes before bubble handler runs).
    suppressSendRef.current = true;
    window.setTimeout(() => { suppressSendRef.current = false; }, 50);
    closeMentionMenu();
    mentionInputRef.current?.insertMention({ callsign: crew.callsign, name: crew.name });
  }, [closeMentionMenu]);

  const handleFileSelect = useCallback((file: ComposerFileHit) => {
    suppressSendRef.current = true;
    window.setTimeout(() => { suppressSendRef.current = false; }, 50);
    closeMentionMenu();
    const id = crypto.randomUUID();
    onAttachWorkspaceFile?.({ ...file, id });
    mentionInputRef.current?.insertFileChip({ id, name: file.name, path: file.path, relativePath: file.relativePath });
  }, [onAttachWorkspaceFile, closeMentionMenu]);

  const handleFolderSelect = useCallback((folder: ComposerFolderHit) => {
    suppressSendRef.current = true;
    window.setTimeout(() => { suppressSendRef.current = false; }, 50);
    closeMentionMenu();
    const id = crypto.randomUUID();
    onAttachWorkspaceFolder?.({ ...folder, id });
    mentionInputRef.current?.insertFolderChip({
      id,
      name: folder.name,
      path: folder.path,
      relativePath: folder.relativePath,
    });
  }, [onAttachWorkspaceFolder, closeMentionMenu]);

  const handleKbSelect = useCallback((source: ComposerKbHit) => {
    suppressSendRef.current = true;
    window.setTimeout(() => { suppressSendRef.current = false; }, 50);
    closeMentionMenu();
    mentionInputRef.current?.insertKbChip({ sourceId: source.sourceId, name: source.name });
  }, [closeMentionMenu]);

  const clearAndGetText = useCallback(() => {
    const text = mentionInputRef.current?.getValue() ?? '';
    mentionInputRef.current?.clear();
    hasTextRef.current = false;
    setHasText(false);
    return text;
  }, []);

  const handleSendClick = useCallback(() => {
    if (inputDisabled) return;
    const text = mentionInputRef.current?.getValue() ?? '';
    if (!text.trim() && !hasAttachments) return;
    onSend(text);
  }, [hasAttachments, onSend, inputDisabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (inputDisabled) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      // Menu is open OR we just accepted a mention — never send.
      if (
        mentionActiveRef.current
        || mentionMenuOpenRef.current
        || showMentionMenu
        || suppressSendRef.current
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick, inputDisabled, showMentionMenu]);

  const canSend = !inputDisabled && !sendBlocked && (hasText || hasAttachments);

  return (
    <>
      {showMentionMenu && (
        <ComposerMentionMenu
          query={mentionQuery ?? ''}
          crewList={crewList}
          disableCrew={disableCrew}
          onSelectCrew={handleMentionSelect}
          onSelectFile={handleFileSelect}
          onSelectFolder={handleFolderSelect}
          onSelectKb={handleKbSelect}
          onClose={closeMentionMenu}
        />
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.25, py: 0.5 }}>
        <MentionInput
          ref={mentionInputRef}
          onKeyDown={handleKeyDown}
          onMentionQuery={handleMentionQuery}
          onTextChange={handleTextChange}
          onFocusChange={handleFocusChange}
          onFileChipRemove={onRemoveAttachmentById}
          placeholder={placeholder}
          crewList={disableCrew ? [] : crewList}
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
