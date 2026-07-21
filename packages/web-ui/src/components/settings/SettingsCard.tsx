import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  settingsCardSx,
  settingsOverlineSx,
  settingsScanlineSx,
  settingsHelperSx,
} from '../../styles/settings-theme';

interface SettingsCardProps {
  title?: string;
  subtitle?: string;
  accent?: string;
  active?: boolean;
  children: React.ReactNode;
  sx?: object;
}

export function SettingsCard({ title, subtitle, accent, active, children, sx }: SettingsCardProps) {
  return (
    <Box sx={{ ...settingsCardSx(accent, active), ...sx }}>
      <Box sx={settingsScanlineSx} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {title && (
          <Typography sx={{ ...settingsOverlineSx, mb: subtitle ? 0.2 : 1 }}>{title}</Typography>
        )}
        {subtitle && (
          <Typography sx={{ ...settingsHelperSx, mb: 1 }}>{subtitle}</Typography>
        )}
        {children}
      </Box>
    </Box>
  );
}
