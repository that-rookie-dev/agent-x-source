import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  settingsStripSx,
  settingsScanlineSx,
  settingsOverlineSx,
  settingsMonoSx,
  settingsTheme,
} from '../../styles/settings-theme';

interface SettingsSectionHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function SettingsSectionHeader({ icon, title, subtitle, action }: SettingsSectionHeaderProps) {
  return (
    <Box sx={settingsStripSx}>
      <Box sx={settingsScanlineSx} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, position: 'relative', zIndex: 1, minWidth: 0 }}>
        {icon && (
          <Box sx={{ color: settingsTheme.accent.hud, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...settingsOverlineSx, color: settingsTheme.accent.hud, mb: subtitle ? 0.2 : 0 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
      {action && <Box sx={{ position: 'relative', zIndex: 1, flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
