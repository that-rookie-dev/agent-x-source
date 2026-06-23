import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../theme';

/** Tick every second between server heartbeats so the counter doesn't jump 40 → 42. */
function useSmoothElapsedSec(elapsedMs?: number): number | undefined {
  const [displaySec, setDisplaySec] = useState<number | undefined>(() =>
    elapsedMs != null ? Math.floor(elapsedMs / 1000) : undefined,
  );
  const syncRef = useRef({ baseMs: 0, syncAt: 0 });

  useEffect(() => {
    if (elapsedMs == null) {
      setDisplaySec(undefined);
      return;
    }

    const serverSec = Math.floor(elapsedMs / 1000);
    syncRef.current = { baseMs: elapsedMs, syncAt: Date.now() };
    setDisplaySec((prev) => (prev == null ? serverSec : Math.max(prev, serverSec)));

    const tick = () => {
      const { baseMs, syncAt } = syncRef.current;
      const computed = Math.floor((baseMs + Date.now() - syncAt) / 1000);
      setDisplaySec((prev) => Math.max(prev ?? 0, computed));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [elapsedMs]);

  return displaySec;
}

export function ExecutionStatusChip({
  stage,
  step,
  elapsedMs,
}: {
  stage?: string;
  step?: number;
  elapsedMs?: number;
}) {
  const elapsedSec = useSmoothElapsedSec(elapsedMs);

  const label =
    stage != null && step != null && elapsedSec != null
      ? `${stage} · step ${step} · ${elapsedSec}s`
      : 'executing…';

  const chipColor = colors.accent.blue;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.35,
        borderRadius: '999px',
        bgcolor: `${chipColor}10`,
        border: `1px solid ${chipColor}28`,
        animation: 'agentx-fadeIn 0.25s ease-out',
      }}
    >
      <Box
        component="span"
        sx={{
          fontSize: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 500,
          letterSpacing: '0.02em',
          lineHeight: 1,
          background: `linear-gradient(90deg, ${chipColor}99 0%, ${chipColor} 38%, #ffffff 50%, ${chipColor} 62%, ${chipColor}99 100%)`,
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          animation: 'agentx-shimmer 2.5s infinite linear',
        }}
      >
        {label}
      </Box>
    </Box>
  );
}
