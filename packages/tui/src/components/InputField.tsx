import { type FC, useState, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';

interface CrewCompletion {
  name: string;
  title?: string;
  id: string;
  expertise?: string[];
}

interface InputFieldProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  disabled?: boolean;
  onSlashDetected?: (value: string) => void;
  onSlashCleared?: () => void;
  completions?: string[];
  crewCompletions?: CrewCompletion[];
}

export const InputField: FC<InputFieldProps> = ({
  onSubmit,
  placeholder = 'Type a message...',
  prefix = '❯',
  disabled = false,
  onSlashDetected,
  onSlashCleared,
  completions = [],
  crewCompletions = [],
}) => {
  const [value, setValue] = useState('');
  const [suggestion, setSuggestion] = useState('');
  // Key used to force TextInput remount so cursor moves to end after tab complete
  const inputKeyRef = useRef(0);

  // @-mention state
  const [atMentionMode, setAtMentionMode] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const atPosRef = useRef(-1);

  const filteredCrews = useMemo(() => {
    if (!atMentionMode) return [];
    const q = mentionQuery.toLowerCase();
    return crewCompletions.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [atMentionMode, mentionQuery, crewCompletions]);

  const acceptMention = useCallback((crew: CrewCompletion) => {
    const pos = atPosRef.current;
    if (pos === -1) return;
    const before = value.slice(0, pos);
    setValue(`${before}@${crew.name} `);
    setAtMentionMode(false);
    setMentionQuery('');
    setMentionIndex(0);
    atPosRef.current = -1;
    // Move cursor to end after replacement
    inputKeyRef.current += 1;
  }, [value]);

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
    // @-mention navigation takes priority
    if (atMentionMode && filteredCrews.length > 0) {
      if (key.upArrow) {
        setMentionIndex((i) => (i > 0 ? i - 1 : filteredCrews.length - 1));
        return;
      }
      if (key.downArrow) {
        setMentionIndex((i) => (i < filteredCrews.length - 1 ? i + 1 : 0));
        return;
      }
      if (key.return || key.tab) {
        const selected = filteredCrews[mentionIndex];
        if (selected) {
          acceptMention(selected);
          return;
        }
      }
      if (key.escape) {
        setAtMentionMode(false);
        setMentionQuery('');
        setMentionIndex(0);
        atPosRef.current = -1;
        return;
      }
    }

    // Normal Enter
    if (key.return && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue('');
      setSuggestion('');
      setAtMentionMode(false);
      setMentionQuery('');
      inputKeyRef.current += 1;
    }
    // Normal Tab for slash suggestion
    if (key.tab && suggestion && !disabled) {
      setValue(suggestion);
      setSuggestion('');
      inputKeyRef.current += 1;
      if (onSlashDetected) onSlashDetected(suggestion);
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);

    // Detect @-mention: find the last @ that has no space after it
    const lastAt = newValue.lastIndexOf('@');
    if (lastAt !== -1) {
      const after = newValue.slice(lastAt + 1);
      // Only activate if the @ is at the start of a word (preceded by space or at start)
      const pre = lastAt === 0 ? ' ' : newValue[lastAt - 1];
      if ((pre === ' ' || pre === '\n' || lastAt === 0) && !after.includes(' ')) {
        atPosRef.current = lastAt;
        setMentionQuery(after);
        setAtMentionMode(true);
        setMentionIndex(0);
      } else {
        setAtMentionMode(false);
        setMentionQuery('');
        atPosRef.current = -1;
      }
    } else {
      setAtMentionMode(false);
      setMentionQuery('');
      atPosRef.current = -1;
    }

    if (newValue.startsWith('/')) {
      if (onSlashDetected) onSlashDetected(newValue);
    } else {
      if (onSlashCleared) onSlashCleared();
    }
    const match = findCompletion(newValue);
    setSuggestion(match && match !== newValue ? match : '');
  };

  return (
    <Box flexDirection="column" paddingX={1}>
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
      {/* @-mention dropdown */}
      {atMentionMode && filteredCrews.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2} marginBottom={1}>
          <Text color={COLORS.textDim} dimColor>Select a crew member:</Text>
          {filteredCrews.map((crew, i) => (
            <Box key={crew.id}>
              <Text color={i === mentionIndex ? COLORS.primary : COLORS.text}>
                {i === mentionIndex ? '❯ ' : '  '}@{crew.name}
              </Text>
              {crew.expertise && crew.expertise.length > 0 && (
                <Text color={COLORS.textDim}> — {crew.expertise.join(', ')}</Text>
              )}
            </Box>
          ))}
          <Text color={COLORS.textDim} dimColor>  ↑↓ navigate · ⏎/⭾ select</Text>
        </Box>
      )}
    </Box>
  );
};
