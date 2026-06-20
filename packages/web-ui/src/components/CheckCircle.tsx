import Box from '@mui/material/Box';
import CheckIcon from '@mui/icons-material/Check';

export function CheckCircle({ size, color, sx }: { size: number; color: string; sx?: Record<string, unknown> }) {
  const borderW = Math.max(1, Math.round(size / 32));
  const checkSize = Math.round(size * 0.70);
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `${borderW}px solid ${color}`,
        color,
        flexShrink: 0,
        ...sx,
      }}
    >
      <CheckIcon sx={{ fontSize: checkSize }} />
    </Box>
  );
}
