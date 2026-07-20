import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import type { VoicePermissionPrompt, VoicePermissionChoice } from '../../voice/VoiceSessionClient';
import { VoicePermissionCard, type VoicePermissionRespondOptions } from './VoicePermissionCard';

export interface VoiceToolPermissionModalProps {
  open: boolean;
  prompt: VoicePermissionPrompt | null;
  onRespond: (choice: VoicePermissionChoice, opts?: VoicePermissionRespondOptions) => void;
}

export function VoiceToolPermissionModal({ open, prompt, onRespond }: VoiceToolPermissionModalProps) {
  return (
    <Dialog
      open={open}
      onClose={() => prompt && onRespond('deny', { reason: 'user' })}
      maxWidth="sm"
      fullWidth
      // Sit above crew-call / other app dialogs so permission never hides behind them.
      sx={{ zIndex: (theme) => theme.zIndex.modal + 40 }}
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
