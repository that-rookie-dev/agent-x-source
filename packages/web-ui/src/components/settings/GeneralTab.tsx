import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import TuneIcon from '@mui/icons-material/Tune';
import { useColorScheme } from '@mui/material/styles';
import type { AgentXConfig } from '../../api';
import { WorkspaceCard } from './WorkspaceCard';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  settingsHelperSx,
  settingsTextFieldSx,
  settingsToggleGroupSx,
  settingsTheme,
} from '../../styles/settings-theme';

const MODES = ['dark', 'light', 'system'] as const;
type ThemeMode = typeof MODES[number];

interface Props {
  cfg: AgentXConfig;
  onChange: (cfg: AgentXConfig) => void;
}

export function GeneralTab({ cfg, onChange }: Props) {
  const { mode, setMode } = useColorScheme();
  const current = (mode ?? 'dark') as ThemeMode;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<TuneIcon sx={{ fontSize: 16 }} />}
        title="General"
        subtitle="Workspace, profile, and appearance"
      />

      <WorkspaceCard embedded />

      <SettingsCard title="Profile" subtitle="Callsign for crew comms and logs">
        <TextField
          size="small"
          label="Callsign"
          value={cfg.user?.callsign ?? ''}
          onChange={(e) => onChange({ ...cfg, user: { callsign: e.target.value } })}
          sx={{ ...settingsTextFieldSx, maxWidth: 320 }}
          placeholder="e.g. Commander"
        />
        <Typography sx={{ ...settingsHelperSx, mt: 0.75 }}>Used in crew communication and log entries.</Typography>
      </SettingsCard>

      <SettingsCard title="Theme" subtitle="Applies instantly" accent={settingsTheme.accent.hud} active>
        <ToggleButtonGroup
          exclusive
          value={current}
          onChange={(_, v: ThemeMode | null) => { if (v) setMode(v); }}
          sx={{ ...settingsToggleGroupSx, mb: 0.75 }}
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
        <Typography sx={{ ...settingsHelperSx, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem' }}>
          Active: {current === 'system' ? 'system → auto' : current}
        </Typography>
      </SettingsCard>
    </Box>
  );
}
