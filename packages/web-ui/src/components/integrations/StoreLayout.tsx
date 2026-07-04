import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

export interface StoreSectionTitleProps {
  title: string;
  count?: number;
  subtitle?: string;
}

export function StoreSectionTitle({ title, count, subtitle }: StoreSectionTitleProps) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{
        fontSize: { xs: '1.75rem', md: '2.25rem' },
        fontWeight: 800,
        color: settingsTheme.text.primary,
        letterSpacing: '-0.03em',
        lineHeight: 1.1,
      }}>
        {title}
      </Typography>
      {(subtitle || typeof count === 'number') && (
        <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, mt: 0.75, ...settingsMonoSx }}>
          {subtitle ?? `${count} integration${count === 1 ? '' : 's'}`}
        </Typography>
      )}
    </Box>
  );
}

export function StoreCardGrid({ children }: { children: ReactNode }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 1,
      mb: 4,
    }}>
      {children}
    </Box>
  );
}
