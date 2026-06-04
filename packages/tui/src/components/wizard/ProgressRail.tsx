import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../../theme/colors.js';

interface ProgressRailProps {
  currentStage: number; // 0=splash, 1=stage1, 2=stage2, 3=launch
}

const STAGES = [
  { key: 'core', label: 'CORE' },
  { key: 'crew', label: 'CREW' },
  { key: 'launch', label: 'LAUNCH' },
];

export const ProgressRail: FC<ProgressRailProps> = ({ currentStage }) => {
  return (
    <Box>
      {STAGES.map((stage, i) => {
        const stageIndex = i + 1;
        const isCompleted = currentStage > stageIndex;
        const isActive = currentStage === stageIndex;
        const color = isCompleted ? COLORS.success : isActive ? COLORS.primary : COLORS.textDim;
        const dot = isCompleted || isActive ? '●' : '○';

        return (
          <Box key={stage.key}>
            <Box flexDirection="column" alignItems="center" width={8}>
              <Text color={color}>{dot}</Text>
              <Text color={color} dimColor={!isActive && !isCompleted}>
                {stage.label}
              </Text>
            </Box>
            {i < STAGES.length - 1 && (
              <Box alignItems="flex-start" height={1}>
                <Text color={isCompleted ? COLORS.success : COLORS.border}>───</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
