import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import DeleteIcon from '@mui/icons-material/Delete';
import SecurityIcon from '@mui/icons-material/Security';
import { settingsPermissions } from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsBtnPrimarySx,
  settingsCardSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';

type ToolDecision = 'allow' | 'deny' | 'ask';

export interface PermissionsTabProps {
  value: Record<string, ToolDecision> | undefined;
  onChange: (next: Record<string, ToolDecision>) => void;
}

const DECISION_LABELS: Record<ToolDecision, string> = {
  allow: 'Allow always',
  deny: 'Deny',
  ask: 'Ask every time',
};

const DECISION_COLORS: Record<ToolDecision, string> = {
  allow: settingsTheme.accent.signal,
  deny: settingsTheme.accent.alert,
  ask: settingsTheme.accent.amber,
};

export function PermissionsTab({ value, onChange }: PermissionsTabProps) {
  const [loading, setLoading] = useState(false);
  const [newTool, setNewTool] = useState('');

  useEffect(() => {
    if (value) return;
    setLoading(true);
    settingsPermissions.get()
      .then((result) => onChange(result.permissions ?? {}))
      .catch(() => onChange({}))
      .finally(() => setLoading(false));
  }, [value, onChange]);

  const permissions = value ?? {};
  const entries = Object.entries(permissions);

  const setDecision = (tool: string, decision: ToolDecision) => {
    onChange({ ...permissions, [tool]: decision });
  };

  const removeTool = (tool: string) => {
    const next = { ...permissions };
    delete next[tool];
    onChange(next);
  };

  const addTool = () => {
    const key = newTool.trim();
    if (!key || permissions[key]) return;
    onChange({ ...permissions, [key]: 'ask' });
    setNewTool('');
  };

  return (
    <Box>
      <SettingsSectionHeader
        icon={<SecurityIcon sx={{ fontSize: 16 }} />}
        title="Default Tool Permissions"
        subtitle="Choose how Agent-X handles each tool before a session is started"
      />
      <SettingsCard title="Tool defaults" active={false}>
        {loading && (
          <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, ...settingsMonoSx, mb: 1 }}>
            Loading permissions…
          </Typography>
        )}
        {!loading && entries.length === 0 && (
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            No default permissions set. Add a tool below to configure its default behavior.
          </Typography>
        )}
        {entries.map(([tool, decision]) => (
          <Box
            key={tool}
            sx={{
              ...settingsCardSx(DECISION_COLORS[decision], false),
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 1,
              px: 1.25,
              py: 0.75,
            }}
          >
            <Typography
              sx={{
                fontSize: '0.65rem',
                fontFamily: "'JetBrains Mono', monospace",
                color: settingsTheme.text.primary,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {tool}
            </Typography>
            <Select
              size="small"
              value={decision}
              onChange={(e) => setDecision(tool, e.target.value as ToolDecision)}
              sx={{
                ...settingsTextFieldSx,
                minWidth: 140,
                '& .MuiSelect-select': { fontSize: '0.65rem', py: 0.5 },
              }}
            >
              <MenuItem value="allow" sx={{ fontSize: '0.65rem' }}>{DECISION_LABELS.allow}</MenuItem>
              <MenuItem value="ask" sx={{ fontSize: '0.65rem' }}>{DECISION_LABELS.ask}</MenuItem>
              <MenuItem value="deny" sx={{ fontSize: '0.65rem' }}>{DECISION_LABELS.deny}</MenuItem>
            </Select>
            <IconButton size="small" onClick={() => removeTool(tool)} sx={{ color: settingsTheme.text.dim, '&:hover': { color: settingsTheme.accent.alert } }}>
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}

        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            placeholder="tool_name"
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTool(); }}
            sx={{ ...settingsTextFieldSx, flex: 1, minWidth: 120 }}
          />
          <Button size="small" variant="outlined" onClick={addTool} sx={settingsBtnPrimarySx}>
            Add tool
          </Button>
        </Box>

        <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
          <strong>Allow always</strong> grants the tool without prompts. <strong>Ask</strong> prompts each time. <strong>Deny</strong> blocks the tool.
          Session-level overrides are available in the chat toolbar.
        </Typography>
      </SettingsCard>
    </Box>
  );
}

export default PermissionsTab;
