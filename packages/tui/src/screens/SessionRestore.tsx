import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface SessionEntry {
  id: string;
  title: string;
  provider: string;
  model: string;
  tokensUsed: number;
  messageCount: number;
  updatedAt: string;
}

interface SessionRestoreProps {
  sessions: SessionEntry[];
  onRestore: (sessionId: string) => void;
  onNew: () => void;
  onBack: () => void;
}

export function SessionRestore({ sessions, onRestore, onNew, onBack }: SessionRestoreProps) {
  const [selected, setSelected] = useState(0);
  // +2 for "New Session" and "Back" options at top
  const totalItems = sessions.length + 2;

  useInput(useCallback((_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(totalItems - 1, s + 1));
    if (key.escape) onBack();
    if (key.return) {
      if (selected === 0) onNew();
      else if (selected === 1) onBack();
      else onRestore(sessions[selected - 2]!.id);
    }
  }, [selected, totalItems, onRestore, onNew, onBack, sessions]));

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={COLORS.primary} bold>Sessions</Text>
      <Text color={COLORS.textDim}>Select a session to restore or start a new one.</Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={selected === 0 ? COLORS.primary : COLORS.text} bold={selected === 0}>
            {selected === 0 ? '▸ ' : '  '}✦ New Session
          </Text>
        </Box>
        <Box>
          <Text color={selected === 1 ? COLORS.primary : COLORS.textDim} bold={selected === 1}>
            {selected === 1 ? '▸ ' : '  '}← Back
          </Text>
        </Box>
        {sessions.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.textDim}>Recent sessions:</Text>
            {sessions.map((s, i) => {
              const idx = i + 2;
              const isSelected = selected === idx;
              const dateStr = new Date(s.updatedAt).toLocaleDateString();
              return (
                <Box key={s.id}>
                  <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                    {isSelected ? '▸ ' : '  '}{s.title}
                  </Text>
                  <Text color={COLORS.textDim}> — {s.provider}/{s.model} • {s.messageCount} msgs • {dateStr}</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>↑↓ navigate • Enter select • Esc back</Text>
      </Box>
    </Box>
  );
}
