import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import type { VoicePermissionPrompt, VoicePermissionChoice } from '../../voice/VoiceSessionClient';
import { VoicePermissionCard } from './VoicePermissionCard';

export interface VoiceToolPermissionModalProps {
  open: boolean;
  prompt: VoicePermissionPrompt | null;
  onRespond: (choice: VoicePermissionChoice) => void;
}

export function VoiceToolPermissionModal({ open, prompt, onRespond }: VoiceToolPermissionModalProps) {
  return (
    <Dialog
      open={open}
      onClose={() => prompt && onRespond('deny')}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'transparent',
          boxShadow: 'none',
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        {prompt && <VoicePermissionCard prompt={prompt} onRespond={onRespond} />}
      </Box>
    </Dialog>
  );
}
