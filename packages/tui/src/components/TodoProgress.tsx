import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { TodoItem } from '@agentx/shared';

interface TodoProgressProps {
  items: TodoItem[];
}

export const TodoProgress: FC<TodoProgressProps> = ({ items }) => {
  if (items.length === 0) return null;

  const completed = items.filter((i) => i.status === 'completed').length;
  const current = items.find((i) => i.status === 'in-progress');
  const total = items.length;

  const barWidth = 20;
  const filledWidth = Math.round((completed / total) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.primary}>📋 </Text>
        <Text color={COLORS.text} bold>
          Step {completed + (current ? 1 : 0)}/{total}
        </Text>
        {current && (
          <Text color={COLORS.textDim}>: {current.title}</Text>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text color={COLORS.success}>{'█'.repeat(filledWidth)}</Text>
        <Text color={COLORS.border}>{'░'.repeat(emptyWidth)}</Text>
        <Text color={COLORS.textDim}> {Math.round((completed / total) * 100)}%</Text>
      </Box>
    </Box>
  );
};
