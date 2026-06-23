import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import RouteIcon from '@mui/icons-material/Route';
import { colors } from '../theme';

export interface PlanStepPreview {
  id: string;
  description: string;
}

interface PlanApprovalModalProps {
  open: boolean;
  title: string;
  steps: PlanStepPreview[];
  onApprove: () => void;
  onReject: () => void;
}

export default function PlanApprovalModal({ open, title, steps, onApprove, onReject }: PlanApprovalModalProps) {
  return (
    <Dialog open={open} onClose={onReject} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <RouteIcon sx={{ fontSize: 20, color: colors.accent.blue }} />
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
          Review plan
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 1.5, lineHeight: 1.6 }}>
          {title}
        </Typography>
        {steps.map((s, i) => (
          <Typography key={s.id} sx={{ fontSize: '0.65rem', color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace", mb: 0.5, lineHeight: 1.5 }}>
            {i + 1}. {s.description}
          </Typography>
        ))}
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 1.5 }}>
          Plan mode is read-only. Approve to save this plan; switch to Agent mode to execute.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
        <Button size="small" onClick={onReject} sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none' }}>
          Reject
        </Button>
        <Button size="small" variant="contained" onClick={onApprove}
          sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: colors.accent.blue, '&:hover': { bgcolor: colors.accent.blue + 'cc' } }}>
          Approve plan
        </Button>
      </DialogActions>
    </Dialog>
  );
}
