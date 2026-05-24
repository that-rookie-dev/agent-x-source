import { type FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface LoadingIndicatorProps {
  label?: string;
  type?: 'spinner' | 'dots' | 'pulse' | 'orbit';
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOT_FRAMES = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];
const PULSE_FRAMES = ['◜', '◝', '◞', '◟'];
const ORBIT_FRAMES = ['✦', '⊹', '∗', '⋆', '✧', '⋆', '∗', '⊹'];

export const LoadingIndicator: FC<LoadingIndicatorProps> = ({ label, type = 'orbit' }) => {
  const [frame, setFrame] = useState(0);

  const frames = type === 'spinner' ? SPINNER_FRAMES
    : type === 'dots' ? DOT_FRAMES
    : type === 'pulse' ? PULSE_FRAMES
    : ORBIT_FRAMES;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 80);
    return () => clearInterval(interval);
  }, [frames.length]);

  return (
    <Box>
      <Text color={COLORS.primary}>{frames[frame]}</Text>
      {label && <Text color={COLORS.textDim}> {label}</Text>}
    </Box>
  );
};
