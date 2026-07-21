import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';

/**
 * Collapsible reasoning block.
 * - `live`: currently streaming thought → label "Thinking", forced open
 * - past thoughts → label "Thought", forced closed when a newer one becomes live
 */
export function ThoughtCollapse({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  const [open, setOpen] = useState(live);
  const trimmed = text.trim();

  useEffect(() => {
    setOpen(live);
  }, [live]);

  if (!trimmed) return null;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
          py: 0.15,
          '&:hover .thought-label': { color: colors.text.secondary },
        }}
      >
        <Typography
          className="thought-label"
          sx={{
            fontSize: '0.68rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: live ? colors.text.secondary : colors.text.dim,
            letterSpacing: '0.02em',
            fontWeight: live ? 600 : 400,
          }}
        >
          {live ? 'Thinking' : 'Thought'}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.62rem',
            color: colors.text.dim,
            opacity: 0.7,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
            lineHeight: 1,
          }}
        >
          ›
        </Typography>
      </Box>
      {open && (
        <Typography
          component="pre"
          sx={{
            mt: 0.5,
            mb: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.68rem',
            lineHeight: 1.55,
            color: colors.text.dim,
            opacity: 0.85,
            m: 0,
          }}
        >
          {trimmed}
        </Typography>
      )}
    </Box>
  );
}
