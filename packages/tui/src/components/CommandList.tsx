import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface CommandItem {
  name: string;
  description: string;
}

interface CommandListProps {
  commands: CommandItem[];
  selectedIndex: number;
  visible: boolean;
}

export const CommandList: FC<CommandListProps> = ({ commands, selectedIndex, visible }) => {
  if (!visible || commands.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
      marginLeft={2}
    >
      {commands.slice(0, 8).map((cmd, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
              {isSelected ? '❯ ' : '  '}
            </Text>
            <Text color={isSelected ? COLORS.text : COLORS.textDim} bold={isSelected}>
              /{cmd.name}
            </Text>
            <Text color={COLORS.textDim} dimColor>
              {' '}- {cmd.description}
            </Text>
          </Box>
        );
      })}
      {commands.length > 8 && (
        <Text color={COLORS.textDim} dimColor>  +{commands.length - 8} more</Text>
      )}
    </Box>
  );
};
