import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SpeedIcon from '@mui/icons-material/Speed';
import { colors } from '../theme';

interface StepCapModalProps {
  open: boolean;
  currentSteps: number;
  maxSteps: number;
  onContinue: () => void;
  onStop: () => void;
}

export default function StepCapModal({ open, currentSteps, maxSteps, onContinue, onStop }: StepCapModalProps) {
  return (
    <Dialog open={open} onClose={onStop} maxWidth="xs" fullWidth
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <SpeedIcon sx={{ fontSize: 20, color: colors.accent.orange }} />
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
          Step limit reached
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.6 }}>
          The agent completed {currentSteps} steps (limit: {maxSteps}). Continue for more tool rounds, or stop here.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
        <Button size="small" onClick={onStop} sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none' }}>
          Stop
        </Button>
        <Button size="small" variant="contained" onClick={onContinue}
          sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: colors.accent.orange, '&:hover': { bgcolor: colors.accent.orange + 'cc' } }}>
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  );
}
