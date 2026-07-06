import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import SpeedIcon from '@mui/icons-material/Speed';
import type { AgentXConfig } from '../../api';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  settingsTheme,
  settingsHelperSx,
  settingsMonoSx,
  settingsOverlineSx,
  settingsScanlineSx,
  settingsStripSx,
} from '../../styles/settings-theme';

interface RuntimeTabProps {
  cfg: AgentXConfig;
  onChange: (cfg: AgentXConfig) => void;
}

export function RuntimeTab({ cfg, onChange }: RuntimeTabProps) {
  const runtime = cfg.runtime ?? {};
  const cpuBudget = runtime.cpuBudgetPercent ?? 40;
  const lazyCache = runtime.lazyStorageCache !== false;

  const patchRuntime = (patch: NonNullable<AgentXConfig['runtime']>) => {
    onChange({ ...cfg, runtime: { ...runtime, ...patch } });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<SpeedIcon sx={{ fontSize: 16 }} />}
        title="Runtime"
        subtitle="Processor budget and boot performance"
      />

      <Box sx={{ ...settingsStripSx, mb: 2, py: 1 }}>
        <Box sx={settingsScanlineSx} />
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim, position: 'relative', zIndex: 1 }}>
          Changes require an application restart.
        </Typography>
      </Box>

      <SettingsCard title="Processor budget" accent={settingsTheme.accent.amber} active>
        <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
          Limits background workers and ONNX threads. Default 40% keeps Agent-X responsive on typical hardware.
        </Typography>
        <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>CPU allocation · {cpuBudget}%</Typography>
        <Slider
          value={cpuBudget}
          min={10}
          max={80}
          step={5}
          marks={[
            { value: 30, label: '30' },
            { value: 40, label: '40' },
            { value: 50, label: '50' },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}%`}
          onChange={(_, v) => patchRuntime({ cpuBudgetPercent: v as number })}
          sx={{
            maxWidth: 420,
            mb: 1,
            color: settingsTheme.accent.amber,
            '& .MuiSlider-markLabel': {
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.55rem',
              color: settingsTheme.text.dim,
            },
          }}
        />
        <Typography sx={{ ...settingsHelperSx, color: settingsTheme.text.dim }}>
          ONNX threads scale automatically · Background pool capped at 4
        </Typography>
      </SettingsCard>

      <SettingsCard title="Boot profile" accent={settingsTheme.accent.hud}>
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={lazyCache}
              onChange={(e) => patchRuntime({ lazyStorageCache: e.target.checked })}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.hud },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: settingsTheme.accent.hud },
              }}
            />
          )}
          label={(
            <Box>
              <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                Lazy storage cache
              </Typography>
              <Typography sx={{ ...settingsHelperSx, mt: 0.25 }}>
                Load session history on demand — faster startup on large archives.
              </Typography>
            </Box>
          )}
        />
      </SettingsCard>
    </Box>
  );
}
