import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ScrollableListProps<T> {
  items: T[];
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  onSelect: (item: T) => void;
  onCancel?: () => void;
  maxVisible?: number;
  label?: string;
}

export function ScrollableList<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
  maxVisible = 10,
  label,
}: ScrollableListProps<T>): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item !== undefined) {
        onSelect(item);
      }
    } else if (key.escape && onCancel) {
      onCancel();
    }
  });

  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible));
  const visibleItems = items.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text color={COLORS.primary} bold>{label}</Text>
          <Text color={COLORS.textDim}> ({items.length} items)</Text>
        </Box>
      )}
      {startIndex > 0 && (
        <Text color={COLORS.textDim}>  ↑ more</Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = startIndex + i;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={actualIndex}>
            <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
              {isSelected ? '❯ ' : '  '}
            </Text>
            {renderItem(item, isSelected)}
          </Box>
        );
      })}
      {startIndex + maxVisible < items.length && (
        <Text color={COLORS.textDim}>  ↓ more</Text>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>
          ↑↓ navigate • Enter select{onCancel ? ' • Esc cancel' : ''}
        </Text>
      </Box>
    </Box>
  );
}
