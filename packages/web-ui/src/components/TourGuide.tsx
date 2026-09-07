import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../theme';

const steps = [
  { title: 'Capabilities panel', body: 'This is the Synthetic Intelligence panel. Generated tools and prompt-recipe skills live here, separate from Executable Skills.' },
  { title: 'Observations', body: 'Agent-X observes repeated tool use and phrasing. Review patterns and choose to generate, acknowledge, or ignore them.' },
  { title: 'Proposals', body: 'Generated capabilities appear here for your review before sandbox, trial, or registration.' },
  { title: 'Create', body: 'You can also describe a repeated need and the wizard will create a capability from your prompt.' },
  { title: 'List', body: 'See all capabilities, sort and filter by kind, status, and usage. Bulk actions are available here.' },
];

export function TourGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => { if (open) setStep(0); }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: MONO, fontSize: '0.9rem' }}>
        Guided tour ({step + 1}/{steps.length})
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', fontWeight: 600, mb: 1 }}>{steps[step]!.title}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: colors.text.secondary, lineHeight: 1.5 }}>{steps[step]!.body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ fontFamily: MONO, textTransform: 'none' }}>Skip</Button>
        <Box sx={{ flex: 1 }} />
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Back</Button>
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Next</Button>
        ) : (
          <Button onClick={onClose} sx={{ fontFamily: MONO, textTransform: 'none' }}>Finish</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
