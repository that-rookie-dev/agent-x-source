import { type FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';

interface InputFieldProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  disabled?: boolean;
  onSlashDetected?: (value: string) => void;
}

export const InputField: FC<InputFieldProps> = ({
  onSubmit,
  placeholder = 'Type a message...',
  prefix = '❯',
  disabled = false,
  onSlashDetected,
}) => {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.return && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue('');
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (newValue.startsWith('/') && onSlashDetected) {
      onSlashDetected(newValue);
    }
  };

  return (
    <Box>
      <Text color={disabled ? COLORS.textDim : COLORS.primary}>{prefix} </Text>
      {disabled ? (
        <Text color={COLORS.textDim} dimColor>Processing...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
};
