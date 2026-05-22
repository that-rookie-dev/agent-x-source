import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ReasoningGlimpseProps {
  content: string;
  isActive: boolean;
}

const THINK_FRAMES = ['💭', '🧠', '💡'];

export function ReasoningGlimpse({ content, isActive }: ReasoningGlimpseProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % THINK_FRAMES.length);
    }, 600);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!content) return null;

  const truncated = content.length > 120 ? content.slice(0, 120) + '…' : content;

  return (
    <Box marginLeft={2} paddingX={1} borderStyle="single" borderColor={COLORS.border}>
      <Text color={COLORS.textDim}>
        {isActive ? THINK_FRAMES[frame] : '💡'}{' '}
      </Text>
      <Text color={COLORS.textDim} italic wrap="truncate-end">
        {truncated}
      </Text>
    </Box>
  );
}
