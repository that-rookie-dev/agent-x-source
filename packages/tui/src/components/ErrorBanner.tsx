import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RemediationAction } from '@agentx/shared';
import { STATUS_MESSAGES } from '@agentx/shared';
import { COLORS } from '../theme/colors.js';

interface ErrorBannerProps {
  message: string;
  actions: RemediationAction[];
  onAction: (action: RemediationAction) => void;
  isActive?: boolean;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  actions,
  onAction,
  isActive = true,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(
    (input, key) => {
      if (key.leftArrow || input === 'h') {
        setSelectedIndex((i) => (i > 0 ? i - 1 : actions.length - 1));
      } else if (key.rightArrow || input === 'l') {
        setSelectedIndex((i) => (i < actions.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const action = actions[selectedIndex];
        if (action) onAction(action);
      } else if (key.escape) {
        // Dismiss on escape
        const dismiss = actions.find((a) => a.type === 'dismiss');
        if (dismiss) onAction(dismiss);
        else onAction(actions[actions.length - 1]!);
      } else {
        // Number key shortcut (1-9)
        const num = parseInt(input, 10);
        if (num >= 1 && num <= actions.length) {
          onAction(actions[num - 1]!);
        }
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Error message */}
      <Box>
        <Text color={COLORS.error}>✗ </Text>
        <Text color={COLORS.error} bold>{STATUS_MESSAGES.errorPrefix}: </Text>
        <Text color={COLORS.text}>{message}</Text>
      </Box>

      {/* Action buttons */}
      <Box marginTop={1} gap={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={i}>
              <Text color={COLORS.textDim}>[</Text>
              <Text color={isSelected ? COLORS.primary : COLORS.textDim} bold={isSelected}>
                {i + 1}
              </Text>
              <Text color={COLORS.textDim}>] </Text>
              <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                {action.label}
              </Text>
              {i < actions.length - 1 && <Text color={COLORS.textDim}>  </Text>}
            </Box>
          );
        })}
      </Box>

      {/* Help hint */}
      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>
          ←→ navigate • Enter select • 1-{actions.length} quick pick • Esc dismiss
        </Text>
      </Box>
    </Box>
  );
};
