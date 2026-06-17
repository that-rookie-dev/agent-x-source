import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';
import { STATUS_MESSAGES } from '@agentx/shared';

interface PermissionPromptProps {
  toolName: string;
  targetPath: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  pendingCount: number;
  requestId: string;
  onDecision: (requestId: string, decision: 'allow_once' | 'allow_always' | 'deny') => void;
  onApproveAll: (decision: 'allow_once' | 'allow_always') => void;
}

export function PermissionPrompt({ toolName, targetPath, riskLevel, pendingCount, requestId, onDecision, onApproveAll }: PermissionPromptProps) {
  const [selected, setSelected] = useState(0);
  const options = ['Allow Once', 'Allow Always', 'Deny'] as const;
  const decisions = ['allow_once', 'allow_always', 'deny'] as const;

  const riskColor = riskLevel === 'critical' ? COLORS.error
    : riskLevel === 'high' ? COLORS.warning
    : riskLevel === 'medium' ? COLORS.primary
    : COLORS.success;

  useInput(useCallback((_input: string, key: { leftArrow?: boolean; rightArrow?: boolean; return?: boolean; a?: boolean }) => {
    if (key.leftArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.rightArrow) setSelected((s) => Math.min(options.length - 1, s + 1));
    if (key.return) onDecision(requestId, decisions[selected]!);
    if (key.a && pendingCount > 1) onApproveAll('allow_once');
  }, [selected, onDecision, requestId, pendingCount, onApproveAll]));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={riskColor} paddingX={1}>
      <Box>
        <Text color={COLORS.accent} bold>{STATUS_MESSAGES.permissionRequired}</Text>
        {pendingCount > 1 && (
          <Text color={COLORS.warning}> ({pendingCount - 1} more pending — press <Text color={COLORS.primary} bold>A</Text> to approve all)</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.text}>Probe: </Text>
        <Text color={COLORS.primary} bold>{toolName}</Text>
      </Box>
      <Box>
        <Text color={COLORS.text}>Target: </Text>
        <Text color={COLORS.textDim}>{targetPath}</Text>
      </Box>
      <Box>
        <Text color={COLORS.text}>Threat Level: </Text>
        <Text color={riskColor}>{riskLevel.toUpperCase()}</Text>
      </Box>
      <Box marginTop={1} gap={2}>
        {options.map((opt, i) => (
          <Box key={opt}>
            <Text
              color={i === selected ? COLORS.primary : COLORS.textDim}
              bold={i === selected}
              inverse={i === selected}
            >
              {` ${opt} `}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>← → to select, Enter to confirm{pendingCount > 1 ? ', A to approve all' : ''}</Text>
      </Box>
    </Box>
  );
}
