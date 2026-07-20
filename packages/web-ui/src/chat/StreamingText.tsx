import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';

/** Lightweight plain-text renderer for in-flight assistant content. */
export const StreamingText = memo(function StreamingText({ content }: { content: string }) {
  if (!content) return null;
  return (
    <Box sx={{ position: 'relative' }}>
      <Typography
        component="pre"
        sx={{
          m: 0,
          fontFamily: "'Inter', sans-serif",
          fontSize: '0.8rem',
          color: colors.text.primary,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content}
      </Typography>
    </Box>
  );
});
