import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import type { IntegrationActionPreview } from '../../api';
import { colors, alphaColor } from '../../theme';

export interface ActionPreviewCardProps {
  preview: IntegrationActionPreview;
  pendingCount?: number;
  onAllowOnce: () => void;
  onAllowAlways: () => void;
  onDeny: () => void;
  onApproveAll?: () => void;
  onSwitchToBypass?: () => void;
}

const RESULT_LABELS: Record<NonNullable<IntegrationActionPreview['resultType']>, string> = {
  generic: 'Integration action',
  issue: 'Issue / ticket',
  calendar: 'Calendar event',
  hotel: 'Travel booking',
  message: 'Message',
};

export function ActionPreviewCard({
  preview,
  pendingCount = 1,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onApproveAll,
  onSwitchToBypass,
}: ActionPreviewCardProps) {
  const isCritical = preview.riskLevel === 'critical';
  const isHigh = preview.riskLevel === 'high';
  const borderColor = isCritical ? alphaColor(colors.accent.red, '50') : isHigh ? alphaColor(colors.accent.orange, '40') : alphaColor(colors.accent.blue, '35');
  const resultLabel = RESULT_LABELS[preview.resultType ?? 'generic'];

  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: `1px solid ${borderColor}`, bgcolor: colors.bg.secondary, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue }}>
          {resultLabel} — confirmation required
        </Typography>
        <Chip size="small" label={preview.providerName} sx={{ height: 18, fontSize: '0.5rem' }} />
        <Chip size="small" label={preview.riskLevel.toUpperCase()} sx={{
          height: 18, fontSize: '0.45rem', fontWeight: 600,
          bgcolor: isCritical ? alphaColor(colors.accent.red, '20') : isHigh ? alphaColor(colors.accent.orange, '20') : alphaColor(colors.accent.blue, '15'),
          color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue,
        }} />
        {pendingCount > 1 && onApproveAll && (
          <Chip
            size="small"
            label={`Approve all (${pendingCount})`}
            onClick={onApproveAll}
            sx={{ cursor: 'pointer', height: 18, fontSize: '0.45rem', bgcolor: alphaColor(colors.accent.green, '20'), color: colors.accent.green }}
          />
        )}
      </Box>

      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary, mb: 0.5 }}>
        {preview.summary}
      </Typography>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, mb: 1, lineHeight: 1.5 }}>
        {preview.impact}
      </Typography>

      {preview.parameters.length > 0 && (
        <Box sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}>
          {preview.parameters.map((param) => (
            <Box key={param.key} sx={{ display: 'flex', gap: 1, mb: 0.35 }}>
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, minWidth: 72, fontFamily: "'JetBrains Mono', monospace" }}>
                {param.key}
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: param.sensitive ? colors.text.dim : colors.text.primary, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
                {param.sensitive ? '••••••••' : param.value || '—'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        <Chip size="small" label="Allow once" onClick={onAllowOnce} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.green, '15'), color: colors.accent.green }} />
        <Chip size="small" label="Always allow" onClick={onAllowAlways} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.blue, '15'), color: colors.accent.blue }} />
        <Chip size="small" label="Deny" onClick={onDeny} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: alphaColor(colors.accent.red, '15'), color: colors.accent.red }} />
        {onSwitchToBypass && (
          <Chip
            size="small"
            label="Switch to bypass mode"
            onClick={onSwitchToBypass}
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
    </Box>
  );
}
