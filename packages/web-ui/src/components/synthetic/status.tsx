import Chip from '@mui/material/Chip';
import CircleIcon from '@mui/icons-material/Circle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ScienceIcon from '@mui/icons-material/Science';
import BlockIcon from '@mui/icons-material/Block';
import ArchiveIcon from '@mui/icons-material/Archive';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ErrorIcon from '@mui/icons-material/Error';
import { colors, MONO, alphaColor } from '../../theme';

export const STATUS_COLOR: Record<string, string> = {
  observed: colors.text.dim,
  proposed: colors.accent.orange,
  'sandbox-passed': colors.accent.cyan,
  'sandbox-failed': colors.accent.red,
  'in-trial': colors.accent.purple,
  'trial-failed': colors.accent.red,
  registered: colors.accent.green,
  disabled: colors.text.dim,
  archived: colors.text.dim,
};

export function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? colors.text.secondary;
}

export const STATUS_HELP: Record<string, string> = {
  proposed: 'Waiting for review. Not available to the agent yet.',
  'sandbox-passed': 'Process sandbox passed. Safe to trial.',
  'sandbox-failed': 'Process sandbox failed. Edit or reject.',
  'in-trial': 'Available to the agent as untrusted trial.',
  registered: 'Approved and available. Not an Executable Skill package.',
  disabled: 'Turned off. Can be re-enabled.',
  archived: 'Removed from the active list.',
};

const STATUS_ICON: Record<string, typeof CircleIcon> = {
  observed: VisibilityIcon,
  proposed: HourglassEmptyIcon,
  'sandbox-passed': CheckCircleIcon,
  'sandbox-failed': CancelIcon,
  'in-trial': ScienceIcon,
  'trial-failed': ErrorIcon,
  registered: CheckCircleIcon,
  disabled: BlockIcon,
  archived: ArchiveIcon,
};

export function statusIconFor(status: string): typeof CircleIcon {
  return STATUS_ICON[status] ?? CircleIcon;
}

export function StatusIcon({ status }: { status: string }) {
  const Icon = statusIconFor(status);
  return <Icon sx={{ fontSize: 14, color: statusColor(status) }} aria-hidden="true" />;
}

export function StatusChip({ status, count }: { status: string; count?: number }) {
  const Icon = statusIconFor(status);
  return (
    <Chip
      size="small"
      icon={<Icon sx={{ fontSize: 14, color: statusColor(status) }} aria-hidden="true" />}
      label={`${status}${count != null ? ` (${count})` : ''}`}
      title={STATUS_HELP[status] ?? status}
      sx={{
        fontFamily: MONO,
        fontSize: '0.62rem',
        color: statusColor(status),
        bgcolor: alphaColor(statusColor(status), '12'),
        '& .MuiChip-icon': { color: statusColor(status) },
      }}
    />
  );
}

export const AUDIT_EVENT_COLOR: Record<string, string> = {
  proposed: colors.accent.orange,
  'sandbox-started': colors.text.dim,
  'sandbox-passed': colors.accent.cyan,
  'sandbox-failed': colors.accent.red,
  'trial-started': colors.accent.purple,
  'trial-expired': colors.accent.red,
  registered: colors.accent.green,
  rejected: colors.accent.red,
  disabled: colors.text.dim,
  archived: colors.text.dim,
  'rolled-back': colors.accent.red,
  edited: colors.accent.blue,
  'generation-completed': colors.accent.blue,
  deprecated: colors.accent.red,
  merged: colors.accent.blue,
  'pattern-observed': colors.accent.purple,
};

export function auditColor(event: string): string {
  return AUDIT_EVENT_COLOR[event] ?? colors.text.secondary;
}
