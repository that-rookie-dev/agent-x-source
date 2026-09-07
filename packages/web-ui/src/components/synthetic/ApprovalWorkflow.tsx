import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { useState } from 'react';
import { MONO } from '../../theme';

export interface ApprovalPayload {
  gate?: 'sandbox' | 'trial' | 'registration';
  reason?: string;
  notes?: string;
  feedback?: string;
}

export function ApprovalWorkflow({
  open,
  name,
  mode,
  sideEffects,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  mode: 'approve' | 'reject';
  sideEffects?: string[];
  onClose: () => void;
  onConfirm: (payload: ApprovalPayload) => void;
}) {
  const [gate, setGate] = useState<'sandbox' | 'trial' | 'registration'>('registration');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [notes, setNotes] = useState('');

  const reasons = ['Not useful', 'Too risky', 'Wrong kind', 'Needs clarification', 'Other'];
  const hasSideEffects = (sideEffects?.length ?? 0) > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontFamily: MONO, fontSize: '0.9rem' }}>
        {mode === 'approve' ? `Approve capability: ${name}` : `Reject capability: ${name}`}
      </DialogTitle>
      <DialogContent>
        {mode === 'approve' && hasSideEffects && (
          <Alert severity="warning" sx={{ mt: 1, fontFamily: MONO, fontSize: '0.65rem' }}>
            This tool declares side effects: {sideEffects!.join(', ')}. It will only run approved side effects after registration.
          </Alert>
        )}
        {mode === 'approve' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
            {(['sandbox', 'trial', 'registration'] as const).map((g) => (
              <Button key={g} size="small" onClick={() => setGate(g)} sx={{ fontFamily: MONO, textTransform: 'none', justifyContent: 'flex-start' }}>
                {gate === g ? '●' : '○'} {g}
              </Button>
            ))}
          </Box>
        ) : (
          <>
            <FormControl fullWidth required sx={{ mt: 1 }}>
              <InputLabel id="reject-reason-label" sx={{ fontFamily: MONO, fontSize: '0.8rem' }}>Reason</InputLabel>
              <Select
                labelId="reject-reason-label"
                value={reason}
                label="Reason"
                onChange={(e) => setReason(e.target.value)}
                sx={{ '& .MuiSelect-select': { fontFamily: MONO, fontSize: '0.8rem' } }}
              >
                {reasons.map((r) => (
                  <MenuItem key={r} value={r} sx={{ fontFamily: MONO, fontSize: '0.8rem' }}>{r}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="What should improve?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.8rem' } }}
            />
          </>
        )}
        <TextField
          fullWidth
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.8rem' } }}
        />
        <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, mt: 1.5 }}>
          Generated tools run in a local process sandbox. Prompt-recipe skills never execute code.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ fontFamily: MONO, textTransform: 'none' }}>Cancel</Button>
        <Button
          onClick={() => onConfirm(mode === 'approve' ? { gate, notes } : { reason, feedback, notes })}
          disabled={mode === 'reject' && !reason.trim()}
          sx={{ fontFamily: MONO, textTransform: 'none' }}
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
