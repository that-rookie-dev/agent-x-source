import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import MicIcon from '@mui/icons-material/Mic';
import { colors, alphaColor } from '../theme';
import type { UIMessage } from './types';
import { UserMentionText } from './ChatMarkdown';
import { AttachmentModal } from './AttachmentModal';

export function ChatUserMessage({ message }: { message: UIMessage }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
        {message.attachments && message.attachments.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
            {message.attachments.map((a, i) => (
              <Chip
                key={i}
                size="small"
                icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />}
                label={a.name}
                onClick={() => setOpenId(a.id)}
                sx={{ fontSize: '0.5rem', height: 18, cursor: 'pointer', bgcolor: alphaColor(colors.accent.blue, '08'), border: `1px solid ${alphaColor(colors.accent.blue, '20')}` }}
              />
            ))}
          </Box>
        )}
        {message.attachments?.map((a) => (
          <AttachmentModal
            key={a.id}
            open={openId === a.id}
            onClose={() => setOpenId(null)}
            id={a.id}
            name={a.name}
            mimeType={a.mimeType}
          />
        ))}
        <UserMentionText content={message.content} />
      </Box>
    </Box>
  );
}
