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
  elapsed: number;
  isProcessing?: boolean;
  backgroundTasks?: BackgroundTask[];
}

export const SessionPanel: FC<SessionPanelProps> = ({
  sessionId,
  provider,
  model,
  profileName,
  tokensUsed,
  tokensTotal,
  elapsed,
  isProcessing = false,
  backgroundTasks = [],
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
      width={36}
      alignSelf="flex-start"
    >
      <Text color={COLORS.primary} bold>Session</Text>
      <Box marginTop={1} flexDirection="column">
        <Row label="ID" value={sessionId.slice(5, 13)} />
        <Row label="Provider" value={provider} />
        <Row label="Model" value={model} />
        {profileName && <Row label="Profile" value={profileName} />}
        {isProcessing && <Row label="Time" value={formatElapsed(elapsed)} />}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.textDim} bold>Tokens</Text>
        <TokenBar used={tokensUsed} total={tokensTotal} />
      </Box>

      {backgroundTasks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.textDim} bold>
            Background ({backgroundTasks.length})
          </Text>
          {backgroundTasks.slice(0, 3).map((task) => (
            <Box key={task.id}>
              <Text color={task.status === 'running' ? COLORS.primary : COLORS.success}>
                {task.status === 'running' ? '● ' : '✓ '}
              </Text>
              <Text color={COLORS.textDim}>
                {task.name.slice(0, 15)} {formatElapsed(task.elapsed)}
              </Text>
            </Box>
          ))}
          {backgroundTasks.length > 3 && (
            <Text color={COLORS.textDim} dimColor>
              +{backgroundTasks.length - 3} more
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

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
