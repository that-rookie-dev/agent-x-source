import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';

export const PANEL_HEADER_HEIGHT = 56;

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** Combine title and subtitle on one line: "Title - subtitle" */
  inline?: boolean;
}

export function PanelHeader({ title, subtitle, icon, action, inline }: PanelHeaderProps) {
  return (
    <Box sx={{
      flexShrink: 0,
      height: PANEL_HEADER_HEIGHT,
      px: 3,
      boxSizing: 'border-box',
      borderBottom: `1px solid ${colors.border.default}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      bgcolor: colors.bg.secondary,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', color: colors.accent.blue, flexShrink: 0 }}>
            {icon}
          </Box>
        )}
        {inline && subtitle ? (
          <Typography sx={{
            fontSize: '0.8rem',
            fontWeight: 500,
            color: colors.text.primary,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <Box component="span" sx={{ fontWeight: 600 }}>{title}</Box>
            <Box component="span" sx={{ color: colors.text.dim, fontWeight: 400 }}> — {subtitle}</Box>
          </Typography>
        ) : (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: colors.text.primary, lineHeight: 1.2 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, lineHeight: 1.3 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        )}
      </Box>
      {action && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {action}
        </Box>
      )}
    </Box>
  );
}
