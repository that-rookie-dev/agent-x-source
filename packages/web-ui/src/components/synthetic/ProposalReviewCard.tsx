import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { colors, MONO, alphaColor } from '../../theme';
import { StatusChip } from './status';
import type { CapabilityRecord } from '../../api';

export interface ProposalPattern {
  pattern: string;
  frequency: number;
  confidence: number;
}

export function ProposalReviewCard({
  item,
  pattern,
  selected,
  onSelect,
  onApprove,
  onReject,
  onTest,
  onOpen,
}: {
  item: CapabilityRecord;
  pattern?: ProposalPattern;
  selected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onApprove: (id: string, gate: 'sandbox' | 'trial' | 'registration') => void;
  onReject: (id: string) => void;
  onTest: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const currentText =
    item.kind === 'tool'
      ? item.sourceCode
      : item.kind === 'skill'
        ? item.promptTemplate
        : (item as { content?: string }).content ?? '';

  return (
    <Box sx={{
      mb: 1.5, p: 1.5, borderRadius: 1,
      border: `1px solid ${colors.border.default}`,
      bgcolor: alphaColor(colors.bg.tertiary, '80'),
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.75, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
          {onSelect && (
            <Checkbox
              size="small"
              checked={!!selected}
              onChange={(e) => onSelect(item.id, e.target.checked)}
              inputProps={{ 'aria-label': `Select ${item.name}` }}
              sx={{ p: 0 }}
            />
          )}
          <Typography sx={{ fontSize: '0.85rem', fontFamily: MONO, color: colors.text.primary }}>{item.name}</Typography>
        </Box>
        <StatusChip status={item.status} />
      </Box>
      <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, mb: 1 }}>{item.description}</Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
        <Chip size="small" label={item.kind} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
        <Chip size="small" label={item.origin} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
        {item.kind === 'tool' && <Chip size="small" label={item.language} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />}
        {pattern && (
          <>
            <Chip size="small" label={`pattern: ${pattern.pattern}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
            <Chip size="small" label={`freq: ${pattern.frequency}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
            <Chip size="small" label={`conf: ${pattern.confidence.toFixed(2)}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          </>
        )}
        {item.generatedBy && <Chip size="small" label={item.generatedBy} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />}
        {item.kind === 'tool' && item.sideEffects.length > 0 && (
          <Chip size="small" label={`effects: ${item.sideEffects.join(',')}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
        )}
      </Box>
      {item.alternatives && item.alternatives.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Button size="small" onClick={() => setDiffOpen((v) => !v)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>
            {diffOpen ? 'Hide alternatives' : 'Show alternatives'}
          </Button>
          <Collapse in={diffOpen}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 0.75 }}>
              <Box sx={{ border: `1px solid ${colors.border.subtle}`, borderRadius: 1, p: 1, overflow: 'auto', maxHeight: 200 }}>
                <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, mb: 0.5, fontFamily: MONO }}>Current</Typography>
                <Typography component="pre" sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap', m: 0 }}>
                  {currentText}
                </Typography>
              </Box>
              <Box sx={{ border: `1px solid ${colors.border.subtle}`, borderRadius: 1, p: 1, overflow: 'auto', maxHeight: 200 }}>
                <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, mb: 0.5, fontFamily: MONO }}>Alternatives</Typography>
                <Typography component="pre" sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap', m: 0 }}>
                  {item.alternatives.join('\n\n---\n\n')}
                </Typography>
              </Box>
            </Box>
          </Collapse>
        </Box>
      )}
      {item.kind === 'tool' && (
        <Typography component="pre" sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', m: 0, mb: 1 }}>
          {item.sourceCode.slice(0, 600)}
        </Typography>
      )}
      {item.kind === 'skill' && (
        <Typography sx={{ fontSize: '0.68rem', fontFamily: MONO, color: colors.text.secondary, mb: 1, whiteSpace: 'pre-wrap' }}>
          {item.promptTemplate.slice(0, 400)}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {item.kind === 'tool' && (item.status === 'proposed' || item.status === 'sandbox-failed') && (
          <Button size="small" onClick={() => onApprove(item.id, 'sandbox')} sx={{ fontFamily: MONO, textTransform: 'none' }}>Approve sandbox</Button>
        )}
        {item.kind === 'tool' && item.status === 'sandbox-passed' && (
          <Button size="small" onClick={() => onApprove(item.id, 'trial')} sx={{ fontFamily: MONO, textTransform: 'none' }}>Approve trial</Button>
        )}
        <Button size="small" onClick={() => onApprove(item.id, 'registration')} sx={{ fontFamily: MONO, textTransform: 'none' }}>Approve</Button>
        <Button size="small" color="error" onClick={() => onReject(item.id)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Reject</Button>
        {item.kind === 'tool' && (
          <>
            <Button size="small" onClick={() => onTest(item.id)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Test</Button>
            <Button size="small" onClick={() => setSchemaOpen(true)} sx={{ fontFamily: MONO, textTransform: 'none' }}>View input schema</Button>
          </>
        )}
        <Button size="small" onClick={() => onOpen(item.id)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Open</Button>
      </Box>
      <Dialog open={schemaOpen} onClose={() => setSchemaOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontFamily: MONO, fontSize: '0.9rem' }}>Input schema: {item.name}</DialogTitle>
        <DialogContent>
          {item.kind === 'tool' ? (
            <Typography component="pre" sx={{ fontSize: '0.72rem', fontFamily: MONO, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 400 }}>
              {JSON.stringify(item.inputSchema, null, 2)}
            </Typography>
          ) : (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>No input schema for {item.kind} capabilities.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSchemaOpen(false)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
