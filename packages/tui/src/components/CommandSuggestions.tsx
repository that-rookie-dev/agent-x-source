import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface CommandSuggestionsProps {
  commands: Array<{ name: string; description: string }>;
  filter: string;
}

export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({ commands, filter }) => {
  const prefix = filter.slice(1).toLowerCase(); // remove "/"
  const filtered = prefix
    ? commands.filter((c) => c.name.startsWith(prefix))
    : commands;

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={1}>
      <Text color={COLORS.textDim} dimColor>Available commands:</Text>
      {filtered.map((cmd) => (
        <Box key={cmd.name}>
          <Text color={COLORS.primary}>  /{cmd.name}</Text>
          <Text color={COLORS.textDim}> — {cmd.description}</Text>
        </Box>
      ))}
      <Text color={COLORS.textDim} dimColor>  Tab to autocomplete</Text>
    </Box>
  );
};
