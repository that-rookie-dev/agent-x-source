import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { colors, alphaColor } from '../../theme';
import { tools } from '../../api';

export const ToolEnableBanner = memo(function ToolEnableBanner({ toolId, toolName, onRespond }: { toolId: string; toolName: string; onRespond: () => void }) {
  const handleEnable = async () => {
    try { await tools.toggle(toolId, true); } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${alphaColor(colors.accent.purple, '30')}`, bgcolor: alphaColor(colors.accent.purple, '05'), animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.purple, mb: 0.5 }}>Tool Disabled</Typography>
      <Typography sx={{ fontSize: '0.6rem', mb: 1, color: colors.text.secondary }}>
        The agent needs <strong>{toolName}</strong> but it&apos;s disabled.
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Enable" onClick={handleEnable} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.green, '12'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '25') } }} />
        <Chip size="small" label="Keep Disabled" onClick={onRespond} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.red, '12'), color: colors.accent.red, '&:hover': { bgcolor: alphaColor(colors.accent.red, '25') } }} />
      </Box>
    </Box>
  );
});
