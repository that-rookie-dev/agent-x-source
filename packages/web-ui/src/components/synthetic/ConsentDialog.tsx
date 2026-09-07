import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { MONO } from '../../theme';

export type ConsentChoice = 'once' | 'always' | 'deny' | 'deny-permanently';

export function ConsentDialog({
  open,
  pattern,
  onChoose,
}: {
  open: boolean;
  pattern?: string;
  onChoose: (value: ConsentChoice) => void;
}) {
  return (
    <Dialog open={open} maxWidth="sm" fullWidth aria-labelledby="si-consent-title">
      <DialogTitle id="si-consent-title" sx={{ fontFamily: MONO, fontSize: '0.9rem' }}>
        {pattern
          ? `Agent-X wants to create a tool to automate "${pattern}". Allow?`
          : 'Allow autonomous capability generation?'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.75rem', fontFamily: MONO, lineHeight: 1.5 }}>
          When Synthetic Intelligence is on, Agent-X can propose reusable tools and prompt-recipe skills from repeated work.
          You still approve every graduation. Creating from this panel always works. Generated tools run in a local process sandbox.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button onClick={() => onChoose('deny-permanently')} sx={{ fontFamily: MONO, textTransform: 'none' }}>
          Never ask again
        </Button>
        <Button onClick={() => onChoose('deny')} sx={{ fontFamily: MONO, textTransform: 'none' }}>
          No autonomous proposals
        </Button>
        <Button onClick={() => onChoose('once')} sx={{ fontFamily: MONO, textTransform: 'none' }}>
          Allow once
        </Button>
        <Button onClick={() => onChoose('always')} sx={{ fontFamily: MONO, textTransform: 'none' }}>
          Allow autonomous proposals
        </Button>
      </DialogActions>
    </Dialog>
  );
}
