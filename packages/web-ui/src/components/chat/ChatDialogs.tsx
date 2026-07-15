import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor } from '../../theme';
import { hyperdrive } from '../../styles/brands';

export function HyperdriveDisclaimerDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: hyperdrive.bg, border: `1px solid ${alphaColor(hyperdrive.magenta, '60')}`, borderRadius: 1, maxWidth: 520, width: '90%', boxShadow: `0 0 40px ${alphaColor(hyperdrive.magenta, '20')}, 0 0 80px ${alphaColor(hyperdrive.cyan, '10')}` } }}
    >
      <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '2px', color: hyperdrive.magenta, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: hyperdrive.magenta, boxShadow: `0 0 8px ${hyperdrive.magenta}`, animation: 'agentx-pulse 1s ease-in-out infinite' }} />
        HYPERDRIVE
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.7rem', lineHeight: 1.8, mb: 1.5 }}>
          You are about to engage <strong style={{ color: hyperdrive.magenta }}>Hyperdrive</strong> — full autonomous execution mode.
        </Typography>
        <Box sx={{ bgcolor: hyperdrive.panel, border: `1px solid ${alphaColor(hyperdrive.magenta, '30')}`, borderRadius: 1, p: 1.5, mb: 1.5 }}>
          <Typography sx={{ color: hyperdrive.magenta, fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", mb: 0.5, fontWeight: 600 }}>
            ⚠ WHAT THIS MEANS
          </Typography>
          <Typography sx={{ color: colors.text.dim, fontSize: '0.6rem', lineHeight: 1.7 }}>
            • All permission prompts are <strong style={{ color: hyperdrive.magenta }}>bypassed</strong><br />
            • The agent can execute <strong style={{ color: hyperdrive.magenta }}>any tool</strong> without asking<br />
            • File writes, shell commands, deletions — <strong style={{ color: hyperdrive.magenta }}>no questions asked</strong><br />
            • The agent operates at <strong style={{ color: hyperdrive.magenta }}>maximum autonomy</strong>
          </Typography>
        </Box>
        <Typography sx={{ color: hyperdrive.warning, fontSize: '0.6rem', fontWeight: 600, lineHeight: 1.6, mb: 1 }}>
          WARNING: Mistakes cannot be undone. Review the agent's task carefully. You are granting unrestricted access to your filesystem and shell.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} size="small" sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          size="small"
          sx={{
            color: hyperdrive.bg, bgcolor: hyperdrive.magenta, textTransform: 'none', fontSize: '0.65rem',
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
            '&:hover': { bgcolor: hyperdrive.hover },
            boxShadow: `0 0 12px ${alphaColor(hyperdrive.magenta, '40')}`,
          }}
        >
          ENGAGE HYPERDRIVE
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
        CLEAR SUPER SESSION
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          Choose how to reset this super session:
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
            Permanently removes all messages and clears saved agent memories (memory fabric) for this super session.
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

export function FolderConsentDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 480, width: '90%' } }}
    >
      <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
        BEFORE YOU START
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          Agent-X will access the folder you select to read, create, and modify files as needed to complete your tasks.
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          • Your files remain local — nothing is uploaded unless you explicitly use a tool that sends data to a provider.
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          • Agent-X can run terminal commands and modify files within the selected directory. Review what tasks you delegate.
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
          • You can change the working directory at any time from the sidebar.
        </Typography>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7 }}>
          • Switch between Agent (full autonomy with tool execution) and Plan (structured plan with step approval) modes in the toolbar.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: colors.text.dim, fontSize: '0.75rem' }}>
          Cancel
        </Button>
        <Button onClick={onConfirm} variant="contained" sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.75rem' }}>
          I Understand
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function FolderPickerLoadingOverlay({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alphaColor(colors.bg.primary, 0.65), backdropFilter: 'blur(2px)' }}>
      <CircularProgress size={40} sx={{ color: colors.text.primary }} />
    </Box>
  );
}
