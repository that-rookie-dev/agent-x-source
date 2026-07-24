import { useMemo, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import MicIcon from '@mui/icons-material/Mic';
import { colors, alphaColor } from '../theme';
import { getCrewAccent } from '../styles/crew-theme';
import type { UIMessage } from './types';
import { UserMentionText } from './ChatMarkdown';
import { AttachmentModal } from './AttachmentModal';
import { system } from '../api';
import { useChatCrewListContext } from '../components/chat/ChatSessionProvider';

/** Top-row chips: + / drag uploads only. @file mentions render inline in content. */
function topChipAttachments(message: UIMessage) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return [];
  const content = message.content ?? '';
  return attachments.filter((a) => {
    if (a.placement === 'inline') return false;
    if (a.placement === 'chip') return true;
    // Legacy / restored: hide from top row when content already has @file/@folder tokens
    if (!content.includes('@file') && !content.includes('@folder')) return true;
    return !content.includes(a.name);
  });
}

export function ChatUserMessage({
  message,
  onCrewClick,
}: {
  message: UIMessage;
  onCrewClick?: (callsign: string, name?: string) => void;
}) {
  const { crewList } = useChatCrewListContext();
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewOverride, setPreviewOverride] = useState<{
    id: string;
    name: string;
    mimeType?: string;
    originalPath?: string;
  } | null>(null);
  const chipOnly = useMemo(() => topChipAttachments(message), [message]);
  const allAttachments = message.attachments ?? [];

  const crewColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of crewList) {
      map[c.callsign.toLowerCase()] = getCrewAccent(c.color, c.callsign);
    }
    return map;
  }, [crewList]);

  const openAttachmentForFile = useCallback(async (relativePath: string, fileName: string) => {
    const match = allAttachments.find((a) =>
      a.name === fileName
      || a.name === relativePath
      || relativePath.endsWith(a.name)
      || relativePath.endsWith(`/${a.name}`)
      || relativePath.endsWith(`\\${a.name}`)
      || (a.originalPath != null && (
        a.originalPath.endsWith(relativePath)
        || a.originalPath.endsWith(`/${relativePath}`)
        || a.originalPath.replace(/\\/g, '/').endsWith(relativePath.replace(/\\/g, '/'))
      )),
    );

    if (match) {
      setPreviewOverride(null);
      setOpenId(match.id);
      return;
    }

    // @file chip with no matching attachment row (e.g. restored history) — resolve workspace path.
    try {
      const ws = await system.workspace();
      const sep = ws.path.includes('\\') ? '\\' : '/';
      const rel = relativePath.replace(/^[/\\]+/, '').replace(/\//g, sep);
      const originalPath = `${ws.path.replace(/[/\\]+$/, '')}${sep}${rel}`;
      const id = `workspace:${relativePath}`;
      setPreviewOverride({
        id,
        name: fileName,
        mimeType: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined,
        originalPath,
      });
      setOpenId(id);
    } catch {
      /* ignore — chip click is best-effort */
    }
  }, [allAttachments]);

  const openModal = openId
    ? (previewOverride && previewOverride.id === openId
      ? previewOverride
      : allAttachments.find((a) => a.id === openId) ?? null)
    : null;

  return (
    <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Box sx={{ maxWidth: '72%', px: 1.5, py: 1, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: colors.bg.elevated }}>
        {message.voiceInput && (
          <Chip
            size="small"
            icon={<MicIcon sx={{ fontSize: '12px !important' }} />}
            label="Voice"
            sx={{ fontSize: '0.5rem', height: 18, mb: 0.5, bgcolor: `${alphaColor(colors.accent.red, '12')}`, border: `1px solid ${alphaColor(colors.accent.red, '30')}` }}
          />
        )}
        {chipOnly.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
            {chipOnly.map((a) => (
              <Chip
                key={a.id}
                size="small"
                icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />}
                label={a.name}
                onClick={() => {
                  setPreviewOverride(null);
                  setOpenId(a.id);
                }}
                sx={{ fontSize: '0.5rem', height: 18, cursor: 'pointer', bgcolor: alphaColor(colors.accent.blue, '08'), border: `1px solid ${alphaColor(colors.accent.blue, '20')}` }}
              />
            ))}
          </Box>
        )}
        {openModal && (
          <AttachmentModal
            open
            onClose={() => { setOpenId(null); setPreviewOverride(null); }}
            id={openModal.id}
            name={openModal.name}
            mimeType={openModal.mimeType}
            originalPath={openModal.originalPath}
          />
        )}
        <UserMentionText
          content={message.content}
          onFileClick={(path, name) => { void openAttachmentForFile(path, name); }}
          onCrewClick={onCrewClick}
          crewColors={crewColors}
        />
      </Box>
    </Box>
  );
}
