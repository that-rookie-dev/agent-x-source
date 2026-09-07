import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../../theme';

export function BulkProposalActions({
  selected,
  onBulk,
}: {
  selected: string[];
  onBulk: (ids: string[], action: 'approve' | 'reject') => void;
}) {
  if (selected.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', gap: 0.75, mb: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button
        size="small"
        onClick={() => onBulk(selected, 'approve')}
        sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}
      >
        Approve selected
      </Button>
      <Button
        size="small"
        color="error"
        onClick={() => onBulk(selected, 'reject')}
        sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}
      >
        Reject selected
      </Button>
      <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>
        {selected.length} selected
      </Typography>
    </Box>
  );
}
