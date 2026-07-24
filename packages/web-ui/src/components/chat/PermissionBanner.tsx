import { useState, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { colors, alphaColor } from '../../theme';

export interface PermissionBannerProps {
  prompt: { requestId: string; tool: string; path: string; riskLevel: string; forAutomation?: boolean };
  pendingCount: number;
  onRespond: () => void;
  onApproveAll: () => void;
  onSwitchToBypass?: () => void;
}

export const PermissionBanner = memo(function PermissionBanner({ prompt, pendingCount, onRespond, onApproveAll, onSwitchToBypass }: PermissionBannerProps) {
  const [instructMode, setInstructMode] = useState(false);
  const [instruction, setInstruction] = useState('');

  const handleRespond = async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await fetch('/api/permission/respond', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: prompt.requestId, choice }) });
    } catch { /* ignore */ }
    setInstructMode(false);
    setInstruction('');
    onRespond();
  };

  const handleInstruct = async () => {
    const text = instruction.trim();
    if (!text) return;
    try {
      await fetch('/api/permission/instruct', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: prompt.requestId, instruction: text }) });
    } catch { /* ignore */ }
    setInstructMode(false);
    setInstruction('');
    onRespond();
  };

  const handleApproveAll = async (choice: 'allow_once' | 'allow_always') => {
    try {
      await fetch('/api/permission/respond-batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    } catch { /* ignore */ }
    onApproveAll();
  };

  const isCritical = prompt.riskLevel === 'critical';
  const isHigh = prompt.riskLevel === 'high';
  const borderColor = isCritical ? alphaColor(colors.accent.red, '50') : isHigh ? alphaColor(colors.accent.orange, '40') : alphaColor(colors.accent.orange, '30');

  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: `1px solid ${borderColor}`, bgcolor: colors.bg.secondary, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue }}>
          {prompt.forAutomation ? 'Scheduled automation' : isCritical ? '⚠ Critical' : isHigh ? '⚡ High Risk' : 'Permission Required'}
        </Typography>
        <Chip size="small" label={prompt.riskLevel.toUpperCase()} sx={{
          fontSize: '0.45rem', height: 15, fontWeight: 600,
          bgcolor: isCritical ? alphaColor(colors.accent.red, '20') : isHigh ? alphaColor(colors.accent.orange, '20') : alphaColor(colors.accent.blue, '15'),
          color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue,
        }} />
        {pendingCount > 1 && (
          <Chip
            size="small"
            label={`Approve All (${pendingCount})`}
            onClick={() => handleApproveAll('allow_once')}
            sx={{ cursor: 'pointer', height: 15, fontSize: '0.45rem', bgcolor: alphaColor(colors.accent.green, '20'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '35') } }}
          />
        )}
      </Box>
      <Typography sx={{ fontSize: '0.6rem', mb: 0.5, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
        {prompt.tool}
      </Typography>
      {prompt.forAutomation && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim }}>
          Allow this tool for scheduled automations in this session.
        </Typography>
      )}
      {prompt.path && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim, wordBreak: 'break-all' }}>
          {prompt.path}
        </Typography>
      )}
      {pendingCount > 1 && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.orange }}>
          {pendingCount - 1} more permission request(s) pending
        </Typography>
      )}
      {isCritical && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.red, fontStyle: 'italic' }}>
          This operation could permanently affect your system. Review carefully before allowing.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {!prompt.forAutomation && (
          <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.green, '15'), color: colors.accent.green, '&:hover': { bgcolor: alphaColor(colors.accent.green, '30') } }} />
        )}
        <Chip size="small" label={prompt.forAutomation ? 'Allow for automations' : 'Always'} onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.blue, '15'), color: colors.accent.blue, '&:hover': { bgcolor: alphaColor(colors.accent.blue, '30') } }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.red, '15'), color: colors.accent.red, '&:hover': { bgcolor: alphaColor(colors.accent.red, '30') } }} />
        <Chip size="small" label="Instruct" onClick={() => setInstructMode((v) => !v)} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.purple, '15'), color: colors.accent.purple, '&:hover': { bgcolor: alphaColor(colors.accent.purple, '30') } }} />
        {onSwitchToBypass && (
          <Chip
            size="small"
            label="Switch to bypass mode"
            onClick={() => onSwitchToBypass()}
            sx={{
              cursor: 'pointer',
              height: 20,
              fontSize: '0.5rem',
              bgcolor: alphaColor(colors.accent.orange, '18'),
              color: colors.accent.orange,
              border: `1px solid ${alphaColor(colors.accent.orange, '40')}`,
              '&:hover': { bgcolor: alphaColor(colors.accent.orange, '30') },
            }}
          />
        )}
      </Box>
      {instructMode && (
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1, alignItems: 'flex-end' }}>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={2}
            placeholder="Tell the agent how to proceed instead…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleInstruct();
              }
            }}
            sx={{ '& .MuiInputBase-input': { fontSize: '0.6rem' } }}
          />
          <Chip size="small" label="Send" onClick={() => void handleInstruct()} sx={{ cursor: 'pointer', height: 24, fontSize: '0.55rem', bgcolor: alphaColor(colors.accent.purple, '20'), color: colors.accent.purple }} />
        </Box>
      )}
    </Box>
  );
});
