import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import SpeedIcon from '@mui/icons-material/Speed';
import type { AgentXConfig } from '../../api';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { settingsTheme, settingsHelperSx, settingsMonoSx } from '../../styles/settings-theme';

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <SettingsSectionHeader icon={<SpeedIcon sx={{ fontSize: 16 }} />} title="Runtime & Performance" />

      <Alert severity="info" sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>
        Changes on this tab require an application restart to take effect.
      </Alert>

      <SettingsCard>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 1 }}>
          CPU budget
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, mb: 2, ...settingsHelperSx }}>
          Controls ONNX thread count and background worker concurrency. Default 40% targets roughly one third to half of a CPU core on typical machines.
        </Typography>
        <Slider
          value={cpuBudget}
          min={10}
          max={80}
          step={5}
          marks={[
            { value: 30, label: '30%' },
            { value: 40, label: '40%' },
            { value: 50, label: '50%' },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v}%`}
          onChange={(_, v) => patchRuntime({ cpuBudgetPercent: v as number })}
          sx={{ maxWidth: 420, mb: 1 }}
        />
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          Current: {cpuBudget}% · ONNX threads scale automatically · Background pool capped at 4
        </Typography>
      </SettingsCard>

      <SettingsCard>
        <FormControlLabel
          control={
            <Switch
              checked={lazyCache}
              onChange={(e) => patchRuntime({ lazyStorageCache: e.target.checked })}
            />
          }
          label={
            <Box>
              <Typography sx={{ fontSize: '0.78rem', color: settingsTheme.text.primary }}>
                Lazy storage cache
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.dim, ...settingsHelperSx }}>
                Load session messages on demand instead of hydrating the full database at startup. Faster boot on large histories.
              </Typography>
            </Box>
          }
        />
      </SettingsCard>
    </Box>
  );
}
