import type { PerformancePresetId } from '../../api';
import { colors } from '../../theme';

export const PERFORMANCE_PRESET_ORDER: PerformancePresetId[] = [
  'quiet',
  'balanced',
  'moderate',
  'ultimate',
];

/** Quiet→Balanced→Moderate→Ultimate: Blue → Green → Orange → Purple. */
export const PERFORMANCE_PRESET_UI: Record<PerformancePresetId, {
  label: string;
  tag: string;
  blurb: string;
  accent: string;
  budget: number;
}> = {
  quiet: {
    label: 'Quiet',
    tag: 'COOL',
    blurb: 'Light concurrency — coolest thermals',
    accent: colors.accent.blue,
    budget: 25,
  },
  balanced: {
    label: 'Balanced',
    tag: 'DAILY',
    blurb: 'Everyday use — recommended default',
    accent: colors.accent.green,
    budget: 40,
  },
  moderate: {
    label: 'Moderate',
    tag: 'STORM',
    blurb: 'Wider lanes for crew & tools',
    accent: colors.accent.orange,
    budget: 70,
  },
  ultimate: {
    label: 'Ultimate',
    tag: 'PEAK',
    blurb: 'Max parallelism — hottest load',
    accent: colors.accent.purple,
    budget: 80,
  },
};

export function normalizePerformancePreset(raw: unknown): PerformancePresetId {
  if (raw === 'performance') return 'moderate';
  if (raw === 'max') return 'ultimate';
  if (raw === 'quiet' || raw === 'balanced' || raw === 'moderate' || raw === 'ultimate') {
    return raw;
  }
  return 'balanced';
}
