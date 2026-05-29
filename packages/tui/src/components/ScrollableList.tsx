import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
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
  maxVisible: maxVisibleProp,
  label,
}: ScrollableListProps<T>): React.ReactElement {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  // Reserve rows for label, indicators, help text, padding
  const availableRows = Math.max(4, terminalRows - 8);
  const maxVisible = Math.min(maxVisibleProp ?? 15, availableRows, items.length);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const TRACE = process.env.AGENTX_TRACE === '1' || process.env.AGENTX_TRACE === 'true';

  useInput((input, key) => {
    const seq = (key as unknown as Record<string, string | undefined>).sequence ?? input;
    if (TRACE) console.log(`[TRACE] ScrollableList useInput seq=${JSON.stringify(seq)} input=${JSON.stringify(input)} up=${key.upArrow} down=${key.downArrow} return=${key.return} esc=${key.escape} sel=${selectedIndex} offset=${scrollOffset} rows=${terminalRows} ts=${Date.now()}`);

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => {
        const prev = i;
        const next = i > 0 ? i - 1 : items.length - 1;
        // Scroll up if cursor goes above visible area
        if (next < scrollOffset) {
          if (TRACE) console.log(`[TRACE] ScrollableList scrollOffset -> ${next} (up)`);
          setScrollOffset(next);
        }
        // Wrap: if we jumped to end, scroll to show it
        if (next === items.length - 1) {
          const newOff = Math.max(0, items.length - maxVisible);
          if (TRACE) console.log(`[TRACE] ScrollableList wrap to end setScrollOffset -> ${newOff}`);
          setScrollOffset(newOff);
        }
        if (TRACE) console.log(`[TRACE] ScrollableList change prev=${prev} next=${next} action=up ts=${Date.now()}`);
        return next;
      });
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => {
        const prev = i;
        const next = i < items.length - 1 ? i + 1 : 0;
        // Scroll down if cursor goes below visible area
        if (next >= scrollOffset + maxVisible) {
          const newOff = next - maxVisible + 1;
          if (TRACE) console.log(`[TRACE] ScrollableList setScrollOffset -> ${newOff} (down)`);
          setScrollOffset(newOff);
        }
        // Wrap: if we jumped to start, reset scroll
        if (next === 0) {
          if (TRACE) console.log(`[TRACE] ScrollableList wrap to start setScrollOffset -> 0`);
          setScrollOffset(0);
        }
        if (TRACE) console.log(`[TRACE] ScrollableList change prev=${prev} next=${next} action=down ts=${Date.now()}`);
        return next;
      });
    } else if (key.return) {
      if (TRACE) console.log(`[TRACE] ScrollableList select idx=${selectedIndex} ts=${Date.now()}`);
      const item = items[selectedIndex];
      if (item !== undefined) {
        onSelect(item);
      }
    } else if (input === ' ') {
      // Spacebar also selects
      if (TRACE) console.log(`[TRACE] ScrollableList space select idx=${selectedIndex} ts=${Date.now()}`);
      const item = items[selectedIndex];
      if (item !== undefined) {
        onSelect(item);
      }
    } else if (key.escape && onCancel) {
      if (TRACE) console.log(`[TRACE] ScrollableList cancel ts=${Date.now()}`);
      onCancel();
    }
  });

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  const page = Math.floor(scrollOffset / maxVisible) + 1;
  const totalPages = Math.ceil(items.length / maxVisible);

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text color={COLORS.primary} bold>{label}</Text>
          <Text color={COLORS.textDim}> ({items.length} items{totalPages > 1 ? ` • page ${page}/${totalPages}` : ''})</Text>
        </Box>
      )}
      {scrollOffset > 0 && (
        <Text color={COLORS.textDim}>  ↑ {scrollOffset} more above</Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
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
      {scrollOffset + maxVisible < items.length && (
        <Text color={COLORS.textDim}>  ↓ {items.length - scrollOffset - maxVisible} more below</Text>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>
          ↑↓/jk navigate • Enter select{onCancel ? ' • Esc cancel' : ''}
        </Text>
      </Box>
    </Box>
  );
}
