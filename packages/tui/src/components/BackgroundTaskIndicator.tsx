import { type FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface BackgroundTask {
  id: string;
  name: string;
  startTime: number;
}

interface BackgroundTaskIndicatorProps {
  tasks: BackgroundTask[];
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const BackgroundTaskIndicator: FC<BackgroundTaskIndicatorProps> = ({ tasks }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (tasks.length === 0) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  return (
    <Box flexDirection="column">
      {tasks.slice(0, 3).map((task) => {
        const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
        return (
          <Box key={task.id}>
            <Text color={COLORS.primary}>{SPINNER_FRAMES[frame]} </Text>
            <Text color={COLORS.textDim}>
              {task.name.slice(0, 20)} ({elapsed}s)
            </Text>
          </Box>
        );
      })}
      {tasks.length > 3 && (
        <Text color={COLORS.textDim} dimColor>
          +{tasks.length - 3} more background tasks
        </Text>
      )}
    </Box>
  );
};
