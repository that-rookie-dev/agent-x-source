import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { colors, alphaColor } from '../../theme';

interface BypassPermissionsToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function BypassPermissionsToggle({ enabled, onToggle }: BypassPermissionsToggleProps) {
  const label = enabled ? 'Bypass: On' : 'Bypass: Off';
  const tooltip = enabled
    ? 'Bypass permissions is ON — all tool calls are allowed without prompts. Click to turn off.'
    : 'Bypass permissions is OFF — you will be prompted for risky tools. Click to allow all.';

  const color = colors.accent.orange;

  return (
    <Tooltip title={tooltip} arrow>
      <Chip
        size="small"
        label={label}
        onClick={onToggle}
        sx={{
          fontSize: '0.55rem',
          height: 20,
          cursor: 'pointer',
          bgcolor: enabled ? alphaColor(color, '18') : colors.bg.tertiary,
          border: `1px solid ${enabled ? alphaColor(color, '40') : colors.border.default}`,
          borderRadius: '10px',
          color: enabled ? color : colors.text.secondary,
          '&:hover': {
            bgcolor: enabled ? alphaColor(color, '28') : colors.bg.primary,
          },
          '& .MuiChip-label': { px: 1 },
        }}
      />
    </Tooltip>
  );
}
