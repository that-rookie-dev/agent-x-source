import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { colors, alphaColor } from '../theme';

interface ModeEscalationModalProps {
  open: boolean;
  tool: string;
  reason: string;
  onSwitch: () => void;
  onSkip: () => void;
}

export default function ModeEscalationModal({ open, tool, reason, onSwitch, onSkip }: ModeEscalationModalProps) {
  return (
    <Dialog open={open} onClose={onSkip} maxWidth="xs" fullWidth
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <SmartToyIcon sx={{ fontSize: 20, color: colors.accent.orange }} />
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
          Switch to Agent mode?
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.6 }}>
          The agent tried to use <strong>{tool}</strong> but Plan mode blocks edits and deletes to existing resources.
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 1, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap' }}>
          {reason.slice(0, 300)}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 1 }}>
          Switch to Agent mode to continue this action automatically, or stay in Plan mode to stop.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
        <Button size="small" onClick={onSkip} sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none' }}>
          Stay in Plan
        </Button>
        <Button size="small" variant="contained" onClick={onSwitch}
          sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: colors.accent.orange, '&:hover': { bgcolor: alphaColor(colors.accent.orange, 'cc') } }}>
          Switch &amp; continue
        </Button>
      </DialogActions>
    </Dialog>
  );
}
