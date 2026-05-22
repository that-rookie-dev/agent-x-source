import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

const GIMMICKS = [
  'Brewing thoughts...',
  'Consulting the matrix...',
  'Parsing the universe...',
  'Crunching neurons...',
  'Synthesizing brilliance...',
  'Channeling wisdom...',
  'Aligning synapses...',
  'Decoding intent...',
  'Weaving logic...',
  'Crystallizing insight...',
];

interface GimmickDisplayProps {
  isVisible: boolean;
}

export function GimmickDisplay({ isVisible }: GimmickDisplayProps) {
  const [gimmick, setGimmick] = useState('');
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isVisible) return;
    setGimmick(GIMMICKS[Math.floor(Math.random() * GIMMICKS.length)]!);
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    const rotate = setInterval(() => {
      setGimmick(GIMMICKS[Math.floor(Math.random() * GIMMICKS.length)]!);
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
