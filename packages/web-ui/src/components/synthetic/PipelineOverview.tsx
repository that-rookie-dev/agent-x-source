import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { colors, MONO, alphaColor } from '../../theme';
import { GraduationPipelineChart } from './GraduationPipelineChart';
import type { CapabilityAuditRecord } from '../../api';

function useCountBump(value: number) {
  const [bump, setBump] = useState(false);
  useEffect(() => {
    setBump(true);
    const t = setTimeout(() => setBump(false), 200);
    return () => clearTimeout(t);
  }, [value]);
  return bump;
}

function Count({
  value,
  singular,
  plural,
  suffix,
  color,
}: {
  value: number;
  singular: string;
  plural: string;
  suffix?: string;
  color?: string;
}) {
  const bump = useCountBump(value);
  return (
    <Typography
      sx={{
        display: 'inline-block',
        fontSize: '0.75rem',
        fontFamily: MONO,
        color: colors.text.primary,
        transition: 'transform 0.2s ease, color 0.2s ease',
        transform: bump ? 'scale(1.05)' : 'scale(1)',
      }}
    >
      <Box component="span" sx={{ color }}>
        {value}
      </Box>{' '}
      {value === 1 ? singular : plural}{suffix ? ` ${suffix}` : ''}
    </Typography>
  );
}

export function PipelineOverview({
  stats,
  pending,
  recent,
  onFilter,
  onReview,
  onOpenEvent,
}: {
  stats: { total: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  pending: number;
  recent: CapabilityAuditRecord[];
  onFilter: (status?: string) => void;
  onReview: () => void;
  onOpenEvent?: (capabilityId: string) => void;
}) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: '0.62rem',
          fontFamily: MONO,
          color: colors.accent.cyan,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          mb: 1,
        }}
      >
        Pipeline Status
      </Typography>
      <GraduationPipelineChart byStatus={stats.byStatus} onSelect={onFilter} />
      {pending > 0 && (
        <Box
          sx={{
            mb: 2,
            p: 1.25,
            borderRadius: 2,
            border: `1px solid ${colors.accent.orange}`,
            bgcolor: alphaColor(colors.accent.orange, '08'),
            backgroundImage: `linear-gradient(110deg, ${alphaColor(colors.accent.orange, '12')}, transparent 55%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Count value={pending} singular="proposal" plural="proposals" suffix="awaiting review" color={colors.accent.orange} />
          <Button size="small" onClick={onReview} sx={{ fontFamily: MONO, textTransform: 'none' }}>
            Review now
          </Button>
        </Box>
      )}
      <Typography
        sx={{
          fontSize: '0.62rem',
          fontFamily: MONO,
          color: colors.accent.cyan,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          mb: 0.75,
        }}
      >
        Recent Activity
      </Typography>
      {recent.length === 0 && (
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text.dim,
            fontFamily: MONO,
            p: 1,
            borderRadius: 1,
            border: `1px dashed ${colors.border.strong}`,
            bgcolor: alphaColor(colors.bg.tertiary, '40'),
          }}
        >
          No capability events yet.
        </Typography>
      )}
      {recent.slice(0, 20).map((ev) => (
        <Typography
          key={ev.id}
          onClick={() => { if (ev.capabilityId) onOpenEvent?.(ev.capabilityId); }}
          sx={{
            fontSize: '0.68rem',
            fontFamily: MONO,
            color: colors.text.secondary,
            py: 0.35,
            px: 0.5,
            borderRadius: 0.5,
            cursor: onOpenEvent ? 'pointer' : 'default',
            '&:hover': onOpenEvent ? { color: colors.text.primary, bgcolor: alphaColor(colors.accent.cyan, '08') } : {},
          }}
        >
          {new Date(ev.timestamp).toLocaleString()} · {ev.event} · {ev.actor}
        </Typography>
      ))}
    </Box>
  );
}
