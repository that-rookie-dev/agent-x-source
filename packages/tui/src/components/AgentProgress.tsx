import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface AgentProgressProps {
  agentId: string;
  agentName: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  progress?: string;
  startedAt: number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function AgentProgress({ agentName, status, progress, startedAt }: AgentProgressProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      setElapsed(Date.now() - startedAt);
    }, 80);
    return () => clearInterval(interval);
  }, [status, startedAt]);

  const statusIcon = status === 'running' ? SPINNER_FRAMES[frame]
    : status === 'complete' ? '✓'
    : status === 'failed' ? '✗'
    : '○';

  const statusColor = status === 'running' ? COLORS.info
    : status === 'complete' ? COLORS.success
    : status === 'failed' ? COLORS.error
    : COLORS.textDim;

  return (
    <Box flexDirection="column" marginLeft={1} paddingY={0}>
      <Box gap={1}>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text color={COLORS.primary} bold>⊳ {agentName}</Text>
        {status === 'running' && (
          <Text color={COLORS.textDim}>{(elapsed / 1000).toFixed(1)}s</Text>
        )}
      </Box>
      {progress && (
        <Box marginLeft={4}>
          <Text color={COLORS.textDim} wrap="truncate-end">{progress}</Text>
        </Box>
      )}
    </Box>
  );
}
