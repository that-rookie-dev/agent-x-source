import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import { useColorScheme } from '@mui/material/styles';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  settingsTheme,
  settingsHelperSx,
  settingsToggleGroupSx,
} from '../../styles/settings-theme';

const MODES = ['dark', 'light', 'system'] as const;
type ThemeMode = typeof MODES[number];

export function AppearanceTab() {
  const { mode, setMode } = useColorScheme();
  const current = (mode ?? 'dark') as ThemeMode;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<PaletteOutlinedIcon sx={{ fontSize: 16 }} />}
        title="Appearance"
        subtitle="Color scheme — applies instantly, no restart"
      />

      <SettingsCard title="Theme" accent={settingsTheme.accent.hud} active>
        <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
          Dark, light, or follow your system preference. Stored locally in this browser.
        </Typography>
        <ToggleButtonGroup
          exclusive
          value={current}
          onChange={(_, v: ThemeMode | null) => { if (v) setMode(v); }}
          sx={settingsToggleGroupSx}
        >
          <ToggleButton value="dark">
            <DarkModeOutlinedIcon sx={{ fontSize: 14, mr: 0.75 }} />
            Dark
          </ToggleButton>
          <ToggleButton value="light">
            <LightModeOutlinedIcon sx={{ fontSize: 14, mr: 0.75 }} />
            Light
          </ToggleButton>
          <ToggleButton value="system">
            <ContrastIcon sx={{ fontSize: 14, mr: 0.75 }} />
            System
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography sx={{ ...settingsHelperSx, mt: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>
          Active scheme: {current === 'system' ? 'system → auto' : current}
        </Typography>
      </SettingsCard>
    </Box>
  );
}
