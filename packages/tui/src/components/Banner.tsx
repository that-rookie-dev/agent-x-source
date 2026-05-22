import { type FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { VERSION, APP_NAME } from '@agentx/shared';
import type { OrganizationConfig } from '@agentx/shared';

interface BannerProps {
  provider?: string;
  model?: string;
  organization?: OrganizationConfig | null;
}

export const Banner: FC<BannerProps> = ({ provider, model, organization }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % 3);
    }, 800);
    return () => clearInterval(timer);
  }, []);

  const dots = '.'.repeat(frame + 1);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text color={COLORS.primary} bold>
          {'╔══════════════════════════════════════════╗'}
        </Text>
      </Box>
      <Box>
        <Text color={COLORS.primary} bold>
          {'║  '}
        </Text>
        <Text color={COLORS.primary} bold>
          {APP_NAME}
        </Text>
        <Text color={COLORS.textDim}> v{VERSION}</Text>
        <Text color={COLORS.primary} bold>
          {'                          ║'}
        </Text>
      </Box>
      {organization?.name && (
        <Box>
          <Text color={COLORS.primary} bold>{'║  '}</Text>
          <Text color={COLORS.textDim}>Org: {organization.name}</Text>
          {organization.contact && (
            <Text color={COLORS.textDim}> | {organization.contact}</Text>
          )}
          <Text color={COLORS.primary} bold>{'            ║'}</Text>
        </Box>
      )}
      {provider && model && (
        <Box>
          <Text color={COLORS.primary} bold>{'║  '}</Text>
          <Text color={COLORS.info}>{provider}</Text>
          <Text color={COLORS.textDim}> / </Text>
          <Text color={COLORS.text}>{model}</Text>
          <Text color={COLORS.primary} bold>{'       ║'}</Text>
        </Box>
      )}
      <Box>
        <Text color={COLORS.primary} bold>
          {'╚══════════════════════════════════════════╝'}
        </Text>
      </Box>
      {!provider && (
        <Box>
          <Text color={COLORS.textDim}>  Starting{dots}</Text>
        </Box>
      )}
    </Box>
  );
};
