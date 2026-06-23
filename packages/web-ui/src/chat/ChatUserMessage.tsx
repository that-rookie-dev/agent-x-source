import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { colors } from '../theme';
import type { UIMessage } from './types';
import { UserMentionText } from './ChatMarkdown';

export function ChatUserMessage({ message }: { message: UIMessage }) {
  return (
    <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Box sx={{ maxWidth: '72%', px: 1.5, py: 1, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: colors.bg.elevated }}>
        {message.attachments && message.attachments.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
            {message.attachments.map((a, i) => (
              <Chip key={i} size="small" icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />} label={a.name}
                sx={{ fontSize: '0.5rem', height: 18, bgcolor: colors.accent.blue + '08', border: `1px solid ${colors.accent.blue}20` }} />
            ))}
          </Box>
        )}
        <UserMentionText content={message.content} />
      </Box>
    </Box>
  );
}
