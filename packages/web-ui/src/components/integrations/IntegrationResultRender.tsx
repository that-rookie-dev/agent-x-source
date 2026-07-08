import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { colors, alphaColor } from '../../theme';

export interface IntegrationStructuredResult {
  resultType: 'generic' | 'issue' | 'calendar' | 'hotel' | 'message';
  providerName: string;
  toolName: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  raw: string;
}

const TYPE_LABELS: Record<IntegrationStructuredResult['resultType'], string> = {
  generic: 'Integration result',
  issue: 'Issue / ticket',
  calendar: 'Calendar event',
  hotel: 'Travel booking',
  message: 'Message sent',
};

const TYPE_COLORS: Record<IntegrationStructuredResult['resultType'], string> = {
  generic: colors.accent.blue,
  issue: colors.accent.orange,
  calendar: colors.accent.cyan,
  hotel: colors.accent.purple,
  message: colors.accent.green,
};

export function IntegrationResultRender({ result }: { result: IntegrationStructuredResult }) {
  const accent = TYPE_COLORS[result.resultType] ?? colors.accent.blue;
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${alphaColor(accent, '25')}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {TYPE_LABELS[result.resultType]}
        </Typography>
        <Chip size="small" label={result.providerName} sx={{ height: 16, fontSize: '0.45rem' }} />
      </Box>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: colors.text.primary, mb: 0.75 }}>
        {result.title}
      </Typography>
      {result.fields.map((field) => (
        <Box key={field.label} sx={{ display: 'flex', gap: 1, mb: 0.35 }}>
          <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, minWidth: 72, fontFamily: "'JetBrains Mono', monospace" }}>
            {field.label}
          </Typography>
          <Typography sx={{ fontSize: '0.52rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
            {field.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
