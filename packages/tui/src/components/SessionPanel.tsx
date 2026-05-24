import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { TokenBar } from './TokenBar.js';

interface BackgroundTask {
  id: string;
  name: string;
  elapsed: number;
  status: 'running' | 'completed' | 'failed';
}

interface SessionPanelProps {
  sessionId: string;
  provider: string;
  model: string;
  profileName?: string;
  tokensUsed: number;
  tokensTotal: number;
  isProcessing?: boolean;
  backgroundTasks?: BackgroundTask[];
}

export const SessionPanel: FC<SessionPanelProps> = ({
  sessionId,
  tokensUsed,
  tokensTotal,
  backgroundTasks = [],
}) => {
  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
      gap={2}
    >
      <Row label="Session" value={sessionId.slice(5, 13)} />
      <Box flexGrow={1}>
        <TokenBar used={tokensUsed} total={tokensTotal} />
      </Box>

      {backgroundTasks.length > 0 && (
        <Box gap={1}>
          {backgroundTasks.slice(0, 2).map((task) => (
            <Box key={task.id}>
              <Text color={task.status === 'running' ? COLORS.primary : COLORS.success}>
                {task.status === 'running' ? '● ' : '✓ '}
              </Text>
              <Text color={COLORS.textDim}>
                {task.name.slice(0, 15)}
              </Text>
            </Box>
          ))}
          {backgroundTasks.length > 2 && (
            <Text color={COLORS.textDim} dimColor>
              +{backgroundTasks.length - 2} more
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box>
    <Text color={COLORS.textDim}>{label}: </Text>
    <Text color={COLORS.text}>{value}</Text>
  </Box>
);
