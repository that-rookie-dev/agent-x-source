import { type FC, useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface TokenBarProps {
  used: number;
  total: number;
  label?: string;
}

export const TokenBar: FC<TokenBarProps> = ({ used, total, label }) => {
  const [displayUsed, setDisplayUsed] = useState(used);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth animation toward target
  useEffect(() => {
    if (animRef.current) clearTimeout(animRef.current);

    const step = () => {
      setDisplayUsed((prev) => {
        const diff = used - prev;
        if (Math.abs(diff) < 50) return used;
        const next = prev + Math.sign(diff) * Math.max(50, Math.abs(diff) * 0.2);
        animRef.current = setTimeout(step, 50);
        return Math.round(next);
      });
    };

    step();
    return () => {
      if (animRef.current) clearTimeout(animRef.current);
    };
  }, [used]);

  const percentage = total > 0 ? Math.min(displayUsed / total, 1) : 0;
  const barWidth = 30;
  const filledWidth = Math.round(barWidth * percentage);
  const emptyWidth = barWidth - filledWidth;

  // Color-coded: green < 50%, amber 50-80%, red > 80%
  let barColor: string = COLORS.tokenGreen;
  if (percentage > 0.8) barColor = COLORS.tokenRed;
  else if (percentage > 0.5) barColor = COLORS.tokenAmber;

  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  const pctStr = `${Math.round(percentage * 100)}%`;

  return (
    <Box>
      {label && <Text color={COLORS.textDim}>{label} </Text>}
      <Text color={barColor}>{filled}</Text>
      <Text color={COLORS.border}>{empty}</Text>
      <Text color={barColor}> {pctStr}</Text>
      <Text color={COLORS.textDim}> ({formatTokens(displayUsed)}/{formatTokens(total)})</Text>
    </Box>
  );
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
