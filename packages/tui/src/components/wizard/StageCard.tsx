import { type FC, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../../theme/colors.js';
import { LAYOUT } from '../../theme/layout.js';
import { ProgressRail } from './ProgressRail.js';

interface StageCardProps {
  stageNumber?: number | null;
  stageLabel?: string;
  children: ReactNode;
  showProgress?: boolean;
  currentStage?: number;
}

export const StageCard: FC<StageCardProps> = ({
  stageNumber,
  stageLabel,
  children,
  showProgress = true,
  currentStage = 0,
}) => {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;
  const cardWidth = Math.min(LAYOUT.wizardCardWidth, cols - 4);

  if (cols < LAYOUT.wizardMinTermCols || rows < LAYOUT.wizardMinTermRows) {
    return (
      <Box width={cols} height={rows} flexDirection="column" justifyContent="center" alignItems="center">
        <Text color={COLORS.warning}>⚠ Terminal too small</Text>
        <Text color={COLORS.textDim}>Resize to at least {LAYOUT.wizardMinTermCols}×{LAYOUT.wizardMinTermRows}</Text>
        <Text color={COLORS.textDim}>Current: {cols}×{rows}</Text>
      </Box>
    );
  }

  const separatorWidth = Math.max(0, cardWidth - 6);

  return (
    <Box width={cols} height={rows} flexDirection="column" justifyContent="center" alignItems="center">
      <Box
        width={cardWidth}
        flexDirection="column"
        borderStyle="single"
        borderColor={COLORS.border}
        paddingX={1}
        paddingY={1}
      >
        {stageNumber != null && stageLabel && (
          <Box marginBottom={1}>
            <Text color={COLORS.primary} bold>⊹ STAGE {stageNumber}: {stageLabel}</Text>
          </Box>
        )}
        {stageNumber != null && (
          <Text color={COLORS.border}>{'─'.repeat(separatorWidth)}</Text>
        )}
        <Box flexDirection="column" marginTop={stageNumber != null ? 1 : 0}>
          {children}
        </Box>
      </Box>
      {showProgress && (
        <Box marginTop={1}>
          <ProgressRail currentStage={currentStage} />
        </Box>
      )}
    </Box>
  );
};
