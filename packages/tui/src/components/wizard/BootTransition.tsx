import { type FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../../theme/colors.js';

interface BootTransitionProps {
  label: string;
  onComplete: () => void;
}

const BAR_WIDTH = 24;
const FILL_DURATION_MS = 1000;
const PAUSE_AFTER_MS = 500;
const TICK_INTERVAL = 50;

export const BootTransition: FC<BootTransitionProps> = ({ label, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    const totalTicks = FILL_DURATION_MS / TICK_INTERVAL;
    let tick = 0;

    const interval = setInterval(() => {
      tick++;
      setProgress(Math.min(tick / totalTicks, 1));

      if (tick >= totalTicks) {
        clearInterval(interval);
        setShowLabel(true);
        setTimeout(onComplete, PAUSE_AFTER_MS);
      }
    }, TICK_INTERVAL);

    return () => clearInterval(interval);
  }, [onComplete]);

  const filledCount = Math.round(progress * BAR_WIDTH);
  const bar = '━'.repeat(filledCount) + '─'.repeat(BAR_WIDTH - filledCount);
  const pct = Math.round(progress * 100);

  return (
    <Box flexDirection="column" alignItems="center">
      <Box>
        <Text color={COLORS.primary}>{bar}</Text>
        <Text color={COLORS.textDim}> {pct}%</Text>
      </Box>
      {showLabel && (
        <Box marginTop={1}>
          <Text color={COLORS.success} bold>✓ {label}</Text>
        </Box>
      )}
    </Box>
  );
};
