import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { VERSION, APP_NAME, TAGLINE } from '@agentx/shared';
import type { OrganizationConfig } from '@agentx/shared';

interface BannerProps {
  provider?: string;
  model?: string;
  organization?: OrganizationConfig | null;
  crewName?: string;
  profileLabel?: string | null;
}

export const Banner: FC<BannerProps> = ({ provider, model, organization, crewName, profileLabel }) => {
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
          {/** show active profile if present */}
          {profileLabel && (
            <Text color={COLORS.textDim}> {' '}• [{profileLabel}]</Text>
          )}
        </Box>
      )}

      {!provider && (
        <Box>
          <Text color={COLORS.primaryDim}>⊹ Booting systems...</Text>
        </Box>
      )}

      {/* Crew name as the identifier line */}
      {crewName && (
        <>
          <Box marginTop={0}>
            <Text color={COLORS.border}>{'─'.repeat(40)}</Text>
          </Box>
          <Box>
            <Text color={COLORS.accent}>⊹ {crewName}</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
