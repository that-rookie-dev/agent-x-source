import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface TimerEntry {
  label: string;
  elapsed: number; // milliseconds
}

interface ConsolidatedTimerProps {
  entries: TimerEntry[];
  totalElapsed: number;
}

export const ConsolidatedTimer: FC<ConsolidatedTimerProps> = ({ entries, totalElapsed }) => {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Box>
        <Text color={COLORS.primary} bold>⏱ Total: </Text>
        <Text color={COLORS.text}>{formatElapsed(totalElapsed)}</Text>
      </Box>
      {entries.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {entries.map((entry, i) => (
            <Box key={i}>
              <Text color={COLORS.textDim}>├─ {entry.label}: </Text>
              <Text color={COLORS.text}>{formatElapsed(entry.elapsed)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  if (seconds < 60) return `${seconds}.${tenths}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
