import { type FC, useState, useCallback, useRef } from 'react';
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
  // Key used to force TextInput remount so cursor moves to end after tab complete
  const inputKeyRef = useRef(0);

  const findCompletion = useCallback(
    (input: string): string => {
      if (!input.startsWith('/') || input.length < 2) return '';
      const pfx = input.slice(1).toLowerCase();
      const match = completions.find((c) => c.toLowerCase().startsWith(pfx));
      return match ? `/${match}` : '';
    },
    [completions],
  );

  useInput((_input, key) => {
    if (key.return && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue('');
      setSuggestion('');
      inputKeyRef.current += 1;
    }
    if (key.tab && suggestion && !disabled) {
      setValue(suggestion);
      setSuggestion('');
      // Force remount to move cursor to end
      inputKeyRef.current += 1;
      if (onSlashDetected) onSlashDetected(suggestion);
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
            key={inputKeyRef.current}
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
