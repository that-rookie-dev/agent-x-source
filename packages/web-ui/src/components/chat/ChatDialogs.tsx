import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { colors, alphaColor } from '../../theme';

export function ClearSessionDialog({
  open,
  busy,
  onClose,
  onArchive,
  onDelete,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 480, width: '90%' } }}
    >
      <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
        CLEAR AGENT-X SESSION
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          Choose how to reset this Agent-X session:
        </Typography>
        <Box sx={{ bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.subtle}`, borderRadius: 1, p: 1.5, mb: 1 }}>
          <Typography sx={{ color: colors.text.primary, fontSize: '0.7rem', fontWeight: 600, mb: 0.5 }}>
            Archive session
          </Typography>
          <Typography sx={{ color: colors.text.dim, fontSize: '0.65rem', lineHeight: 1.6 }}>
            Hides messages from the chat view. Database rows and memory fabric stay intact for recovery and context.
          </Typography>
        </Box>
        <Box sx={{ bgcolor: alphaColor(colors.accent.red, '10'), border: `1px solid ${alphaColor(colors.accent.red, '35')}`, borderRadius: 1, p: 1.5 }}>
          <Typography sx={{ color: colors.accent.red, fontSize: '0.7rem', fontWeight: 600, mb: 0.5 }}>
            Delete session
          </Typography>
          <Typography sx={{ color: colors.text.dim, fontSize: '0.65rem', lineHeight: 1.6 }}>
            Permanently removes all messages and clears saved agent memories (memory fabric) for this Agent-X session.
            The agent may need to start fresh and relearn context from new conversations. This cannot be undone.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button
          onClick={onClose}
          disabled={busy}
          size="small"
          sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}
        >
          Cancel
        </Button>
        <Button
          onClick={onArchive}
          disabled={busy}
          size="small"
          sx={{ color: colors.text.primary, textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}
        >
          Archive session
        </Button>
        <Button
          onClick={onDelete}
          disabled={busy}
          size="small"
          sx={{
            color: colors.bg.primary,
            bgcolor: colors.accent.red,
            textTransform: 'none',
            fontSize: '0.65rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            '&:hover': { bgcolor: alphaColor(colors.accent.red, '85') },
          }}
        >
          Delete session
        </Button>
      </DialogActions>
    </Dialog>
  );
}
