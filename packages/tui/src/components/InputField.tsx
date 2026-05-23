import { type FC, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';

interface InputFieldProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  disabled?: boolean;
  onSlashDetected?: (value: string) => void;
  onSlashCleared?: () => void;
  completions?: string[];
}

export const InputField: FC<InputFieldProps> = ({
  onSubmit,
  placeholder = 'Type a message...',
  prefix = '❯',
  disabled = false,
  onSlashDetected,
  onSlashCleared,
  completions = [],
}) => {
  const [value, setValue] = useState('');
  const [suggestion, setSuggestion] = useState('');

  const findCompletion = useCallback(
    (input: string): string => {
      if (!input.startsWith('/') || input.length < 2) return '';
      const prefix = input.slice(1).toLowerCase();
      const match = completions.find((c) => c.toLowerCase().startsWith(prefix));
      return match ? `/${match}` : '';
    },
    [completions],
  );

  useInput((_input, key) => {
    if (key.return && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue('');
      setSuggestion('');
    }
    if (key.tab && suggestion && !disabled) {
      setValue(suggestion);
      setSuggestion('');
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (newValue.startsWith('/')) {
      if (onSlashDetected) onSlashDetected(newValue);
    } else {
      if (onSlashCleared) onSlashCleared();
    }
    const match = findCompletion(newValue);
    setSuggestion(match && match !== newValue ? match : '');
  };

  return (
    <Box>
      <Text color={disabled ? COLORS.textDim : COLORS.primary}>{prefix} </Text>
      {disabled ? (
        <Text color={COLORS.textDim} dimColor>Processing...</Text>
      ) : (
        <Box>
          <TextInput
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
          />
          {suggestion && (
            <Text color={COLORS.textDim} dimColor>
              {suggestion.slice(value.length)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
