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
  showReady?: boolean;
}

export const Banner: FC<BannerProps> = ({ provider, model, organization, profileName, showReady }) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      {/* Header row */}
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
      </Box>

      {/* Provider / Model row */}
      {provider && model && (
        <Box>
          <Text color={COLORS.textDim}>⊹ </Text>
          <Text color={COLORS.info}>{provider}</Text>
          <Text color={COLORS.textDim}> / </Text>
          <Text color={COLORS.text}>{model}</Text>
        </Box>
      )}

      {/* Profile row */}
      {profileName && (
        <Box>
          <Text color={COLORS.textDim}>⊹ </Text>
          <Text color={COLORS.accent}>{profileName}</Text>
        </Box>
      )}

      {!provider && (
        <Box>
          <Text color={COLORS.primaryDim}>⊹ Booting systems...</Text>
        </Box>
      )}

      {/* Separator + commands */}
      <Box marginTop={0}>
        <Text color={COLORS.border}>{'─'.repeat(40)}</Text>
      </Box>
      <Box>
        <Text color={COLORS.textDim}>/model</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/provider</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/help</Text>
        <Text color={COLORS.border}> • </Text>
        <Text color={COLORS.textDim}>/clear</Text>
      </Box>

      {/* Ready message */}
      {showReady && (
        <Box>
          <Text color={COLORS.textDim}>Ready. Type a message or use </Text>
          <Text color={COLORS.accent}>/</Text>
          <Text color={COLORS.textDim}> for commands.</Text>
        </Box>
      )}
    </Box>
  );
};
