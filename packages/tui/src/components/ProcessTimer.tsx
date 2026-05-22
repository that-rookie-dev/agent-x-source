import { type FC, useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ProcessTimerProps {
  label: string;
  active: boolean;
  startTime?: number;
}

export const ProcessTimer: FC<ProcessTimerProps> = ({ label, active, startTime }) => {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(startTime ?? Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      start.current = startTime ?? Date.now();
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - start.current);
      }, 100);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, startTime]);

  return (
    <Box>
      <Text color={active ? COLORS.primary : COLORS.textDim}>
        {active ? '⏱ ' : '✓ '}
      </Text>
      <Text color={active ? COLORS.text : COLORS.textDim}>{label}</Text>
      <Text color={active ? COLORS.primary : COLORS.textDim}>
        {' '}{formatElapsed(elapsed)}
      </Text>
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
