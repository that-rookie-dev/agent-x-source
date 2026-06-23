import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { colors } from '../theme';

export function ChatModeChangeChip({ from, to }: { from: string; to: string }) {
  const isHyperdrive = to === 'Hyperdrive';
  const chipColor = isHyperdrive ? '#ff00ff' : to === 'Plan' ? '#2196F3' : colors.accent.orange;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.5, animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Chip
        size="small"
        label={`${from} → ${to}`}
        sx={{
          fontSize: '0.55rem', height: 20, fontFamily: "'JetBrains Mono', monospace",
          bgcolor: `${chipColor}12`,
          border: `1px solid ${chipColor}30`,
          borderRadius: '10px',
          color: chipColor,
          '& .MuiChip-label': { px: 1.25 },
        }}
      />
    </Box>
  );
}
