import { type FC, useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../../theme/colors.js';
import { VERSION } from '@agentx/shared';
import { useTypewriter } from '../../animations/index.js';

interface SplashScreenProps {
  onStart: () => void;
  onExit: () => void;
}

export const SplashScreen: FC<SplashScreenProps> = ({ onStart, onExit }) => {
  const [blink, setBlink] = useState(true);
  const subtitle = useTypewriter('« First Launch Detected »', 40);

  useEffect(() => {
    const interval = setInterval(() => {
      setBlink((b) => !b);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  useInput((_input, key) => {
    if (key.return) {
      onStart();
    } else if (key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" alignItems="center">
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>
          {'✦  A G E N T - X  ✦'}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.accent} bold>
          MISSION CONTROL
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.text}>{subtitle}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.textDim} italic>
          Initializing systems...
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={blink ? COLORS.textDim : COLORS.border}>
          Press ENTER to begin
        </Text>
      </Box>

      <Box marginTop={2}>
        <Text color={COLORS.border}>v{VERSION}</Text>
      </Box>
    </Box>
  );
};
