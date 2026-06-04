import { type FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../../theme/colors.js';

interface LaunchSequenceProps {
  crewName?: string;
  callsign?: string;
  onComplete: () => void;
}

const SYSTEMS = [
  { label: 'Neural Core', status: 'ONLINE' },
  { label: 'Identity', status: 'REGISTERED' },
];

export const LaunchSequence: FC<LaunchSequenceProps> = ({
  crewName,
  callsign,
  onComplete,
}) => {
  const [visibleSystems, setVisibleSystems] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const systems = callsign
    ? [...SYSTEMS]
    : [SYSTEMS[0]!];

  useEffect(() => {
    // Show systems one at a time
    const timers: ReturnType<typeof setTimeout>[] = [];

    systems.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleSystems(i + 1), (i + 1) * 500));
    });

    // Start countdown after all systems shown
    const countdownStart = (systems.length + 1) * 500;
    timers.push(setTimeout(() => setCountdown(3), countdownStart));
    timers.push(setTimeout(() => setCountdown(2), countdownStart + 800));
    timers.push(setTimeout(() => setCountdown(1), countdownStart + 1600));
    timers.push(setTimeout(onComplete, countdownStart + 2400));

    return () => timers.forEach(clearTimeout);
  }, []);

  const dotPad = (label: string, width: number) => {
    const dots = width - label.length;
    return label + ' ' + '.'.repeat(Math.max(0, dots));
  };

  return (
    <Box flexDirection="column" alignItems="center">
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>ALL SYSTEMS OPERATIONAL</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {systems.map((sys, i) => {
          if (i >= visibleSystems) return null;
          const isSkipped = sys.status === 'SKIPPED';
          const statusColor = isSkipped ? COLORS.textDim : COLORS.success;
          return (
            <Box key={sys.label}>
              <Text color={COLORS.success}>✓ </Text>
              <Text color={COLORS.text}>{dotPad(sys.label, 20)}</Text>
              <Text color={statusColor} bold> {sys.status}</Text>
            </Box>
          );
        })}
      </Box>

      {visibleSystems >= systems.length && (
        <>
          <Box marginBottom={1}>
            <Text color={COLORS.border}>{'─'.repeat(32)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={COLORS.accent} bold>{'« LAUNCHING AGENT-X »'}</Text>
          </Box>

          {crewName && (
            <Box marginBottom={1}>
              <Text color={COLORS.textDim}>Crew member: </Text>
              <Text color={COLORS.primary} bold>{crewName}</Text>
            </Box>
          )}

          {countdown !== null && (
            <Box>
              <Text color={COLORS.primary} bold>{countdown}...</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};
