import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { VERSION, APP_NAME, TAGLINE } from '@agentx/shared';
import type { OrganizationConfig } from '@agentx/shared';

interface BannerProps {
  provider?: string;
  model?: string;
  organization?: OrganizationConfig | null;
  profileName?: string;
}

export const Banner: FC<BannerProps> = ({ provider, model, organization, profileName }) => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text color={COLORS.primary}>✦ </Text>
        <Text color={COLORS.primary} bold>
          {APP_NAME}
        </Text>
        <Text color={COLORS.textDim}> v{VERSION}</Text>
        <Text color={COLORS.accent}> — {TAGLINE}</Text>
        {organization?.name && (
          <Text color={COLORS.textDim}> • {organization.name}</Text>
        )}
        {profileName && (
          <Text color={COLORS.accent}> • {profileName}</Text>
        )}
      </Box>
      {provider && model && (
        <Box>
          <Text color={COLORS.textDim}>  ⊹ </Text>
          <Text color={COLORS.info}>{provider}</Text>
          <Text color={COLORS.textDim}> / </Text>
          <Text color={COLORS.text}>{model}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>
          /model</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/provider</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/help</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/clear</Text>
      </Box>
      {!provider && (
        <Box>
          <Text color={COLORS.primaryDim}>  ⊹ Booting systems...</Text>
        </Box>
      )}
    </Box>
  );
};
