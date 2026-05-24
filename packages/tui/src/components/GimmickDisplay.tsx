import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { GIMMICK_MESSAGES } from '@agentx/shared';

interface GimmickDisplayProps {
  isVisible: boolean;
}

export function GimmickDisplay({ isVisible }: GimmickDisplayProps) {
  const [gimmick, setGimmick] = useState('');
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isVisible) return;
    setGimmick(GIMMICK_MESSAGES[Math.floor(Math.random() * GIMMICK_MESSAGES.length)]!);
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    const rotate = setInterval(() => {
      setGimmick(GIMMICK_MESSAGES[Math.floor(Math.random() * GIMMICK_MESSAGES.length)]!);
    }, 3000);
    return () => { clearInterval(interval); clearInterval(rotate); };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <Box marginLeft={2}>
      <Text color={COLORS.primaryDim} italic>
        {gimmick}{dots}
      </Text>
    </Box>
  );
}
