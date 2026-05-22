import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ToolActionProps {
  toolName: string;
  status: 'executing' | 'complete' | 'error';
  elapsed?: number;
  output?: string;
}

export function ToolAction({ toolName, status, elapsed, output }: ToolActionProps) {
  const statusIcon = status === 'executing' ? '⚙'
    : status === 'complete' ? '✓'
    : '✗';

  const statusColor = status === 'executing' ? COLORS.primary
    : status === 'complete' ? COLORS.success
    : COLORS.error;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box gap={1}>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text color={COLORS.text} bold>{toolName}</Text>
        {elapsed !== undefined && (
          <Text color={COLORS.textDim}>({(elapsed / 1000).toFixed(1)}s)</Text>
        )}
      </Box>
      {output && status === 'complete' && (
        <Box marginLeft={3}>
          <Text color={COLORS.textDim} wrap="truncate-end">{output.slice(0, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}
