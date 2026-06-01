import { type FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { Plan } from '@agentx/shared';

interface PlanOverlayProps {
  plan: Plan;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onToggleStep: (stepId: string) => void;
  onCancel: () => void;
}

export const PlanOverlay: FC<PlanOverlayProps> = ({ plan, onApproveAll, onRejectAll, onToggleStep, onCancel }) => {
  const [cursor, setCursor] = useState(0);
  const items = [
    { id: 'approve_all', label: 'Approve All', action: 'approve' },
    { id: 'reject_all', label: 'Reject All', action: 'reject' },
    ...plan.steps.map((s) => ({
      id: s.id,
      label: `${s.status === 'approved' ? '✓' : s.status === 'rejected' ? '✗' : '○'} ${s.description}`,
      action: 'toggle' as const,
    })),
    { id: 'cancel', label: 'Cancel / Exit Plan Mode', action: 'cancel' },
  ];

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (key.return) {
      const item = items[cursor];
      if (!item) return;
      if (item.action === 'approve') onApproveAll();
      else if (item.action === 'reject') onRejectAll();
      else if (item.action === 'toggle') onToggleStep(item.id);
      else if (item.action === 'cancel') onCancel();
    } else if (key.escape) {
      onCancel();
    }
  });

  const approvedCount = plan.steps.filter((s) => s.status === 'approved').length;
  const totalCount = plan.steps.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} padding={1}>
      <Text color={COLORS.primary} bold>Plan Mode</Text>
      <Text color={COLORS.textDim}>{plan.title}</Text>
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>Steps: {approvedCount}/{totalCount} approved</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {items.map((item, idx) => (
          <Box key={item.id}>
            <Text color={cursor === idx ? COLORS.primary : COLORS.textDim}>
              {cursor === idx ? '▸ ' : '  '}
            </Text>
            <Text color={cursor === idx ? COLORS.text : COLORS.textDim}>
              {item.label}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
};
