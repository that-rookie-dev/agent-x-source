import { type FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({ message, onConfirm, onCancel }) => {
  const [selected, setSelected] = useState<'yes' | 'no'>('no');

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    } else if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected((s) => (s === 'yes' ? 'no' : 'yes'));
    } else if (key.return) {
      if (selected === 'yes') onConfirm();
      else onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.warning} paddingX={2} paddingY={1}>
      <Text color={COLORS.warning}>{message}</Text>
      <Box marginTop={1} gap={2}>
        <Text
          color={selected === 'yes' ? COLORS.primary : COLORS.textDim}
          bold={selected === 'yes'}
        >
          {selected === 'yes' ? '[Yes]' : ' Yes '}
        </Text>
        <Text
          color={selected === 'no' ? COLORS.primary : COLORS.textDim}
          bold={selected === 'no'}
        >
          {selected === 'no' ? '[No]' : ' No '}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>y/n or ←→ + Enter</Text>
      </Box>
    </Box>
  );
};
