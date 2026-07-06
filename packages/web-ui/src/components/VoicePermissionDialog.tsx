import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { colors } from '../theme';

export interface VoicePermissionDialogProps {
  open: boolean;
  helpText: string;
  setupInstructions?: string[];
  preprompt?: boolean;
  onRequest: () => void;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function VoicePermissionDialog({
  open,
  helpText,
  setupInstructions = [],
  preprompt = false,
  onRequest,
  onClose,
  onOpenSettings,
}: VoicePermissionDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}` } }}>
      <DialogTitle sx={{ fontSize: '0.85rem' }}>
        {preprompt ? 'Allow microphone access' : 'Microphone access needed'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, mb: 1 }}>
          Agent-X uses your microphone only to hear your voice commands and conversations. Audio stays on your machine for local transcription.
        </Typography>
        {preprompt && (
          <Box component="ul" sx={{ m: 0, pl: 2, mb: 1 }}>
            <Typography component="li" sx={{ fontSize: '0.68rem', color: colors.text.dim }}>Audio stays on your machine for local transcription.</Typography>
            <Typography component="li" sx={{ fontSize: '0.68rem', color: colors.text.dim }}>Microphone is used only while voice mode is active.</Typography>
            <Typography component="li" sx={{ fontSize: '0.68rem', color: colors.text.dim }}>You can disable voice anytime in Settings.</Typography>
          </Box>
        )}
        {(setupInstructions.length > 0 ? setupInstructions : [helpText]).map((line) => (
          <Typography key={line} sx={{ fontSize: '0.68rem', color: colors.text.dim, mb: 0.5 }}>{line}</Typography>
        ))}
      </DialogContent>
      <DialogActions>
        {onOpenSettings && !preprompt && (
          <Button size="small" onClick={onOpenSettings}>Open settings</Button>
        )}
        <Button size="small" onClick={onClose}>Not now</Button>
        <Button size="small" variant="contained" onClick={onRequest}>
          {preprompt ? 'Continue' : 'Enable microphone'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
