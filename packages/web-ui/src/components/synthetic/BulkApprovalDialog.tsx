import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { colors, MONO } from '../../theme';

export interface BulkApprovalSideEffect {
  name: string;
  effects: string[];
}

export interface BulkApprovalDialogProps {
  open: boolean;
  names: string[];
  sideEffects?: BulkApprovalSideEffect[];
  onClose: () => void;
  onConfirm: (gate: 'sandbox' | 'trial' | 'registration') => void;
}

export function BulkApprovalDialog({
  open,
  names,
  sideEffects,
  onClose,
  onConfirm,
}: BulkApprovalDialogProps) {
  const [gate, setGate] = useState<'sandbox' | 'trial' | 'registration'>('registration');
  const hasSideEffects = sideEffects && sideEffects.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontFamily: MONO, fontSize: '0.9rem' }}>
        Bulk approve {names.length} {names.length === 1 ? 'capability' : 'capabilities'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
          {names.join(', ')}
        </Typography>
        {hasSideEffects && (
          <Alert severity="warning" sx={{ mt: 1, fontFamily: MONO, fontSize: '0.65rem' }}>
            The following selected tools declare side effects:{' '}
            {sideEffects!.map((s) => `${s.name} (${s.effects.join(', ')})`).join(', ')}.
            They will only run approved side effects after registration.
          </Alert>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
          {(['sandbox', 'trial', 'registration'] as const).map((g) => (
            <Button key={g} size="small" onClick={() => setGate(g)} sx={{ fontFamily: MONO, textTransform: 'none', justifyContent: 'flex-start' }}>
              {gate === g ? '●' : '○'} {g}
            </Button>
          ))}
        </Box>
        <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, mt: 1.5 }}>
          Generated tools run in a local process sandbox. Prompt-recipe skills never execute code.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ fontFamily: MONO, textTransform: 'none' }}>Cancel</Button>
        <Button onClick={() => onConfirm(gate)} sx={{ fontFamily: MONO, textTransform: 'none' }}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
