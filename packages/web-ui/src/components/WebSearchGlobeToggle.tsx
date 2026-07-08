import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import PublicIcon from '@mui/icons-material/Public';
import { colors, alphaColor } from '../theme';

const STORAGE_KEY = 'agentx-web-search-force';

export function readWebSearchForcePreference(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWebSearchForcePreference(enabled: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

interface WebSearchGlobeToggleProps {
  available: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function WebSearchGlobeToggle({ available, enabled, onToggle }: WebSearchGlobeToggleProps) {
  const tooltip = available
    ? (enabled
      ? 'Web search on — every message searches the internet'
      : 'Search the web — force internet search on each message')
    : 'Enable a web search provider in Settings → Tools';

  return (
    <Tooltip title={tooltip} arrow>
      <span>
        <IconButton
          size="small"
          disabled={!available}
          onClick={() => onToggle(!enabled)}
          aria-label="Toggle web search"
          aria-pressed={enabled}
          sx={{
            p: 0.25,
            width: 22,
            height: 22,
            borderRadius: '50%',
            color: enabled ? colors.accent.blue : colors.text.dim,
            bgcolor: enabled ? alphaColor(colors.accent.blue, '18') : 'transparent',
            border: `1px solid ${enabled ? alphaColor(colors.accent.blue, '40') : 'transparent'}`,
            '&:hover': {
              color: available ? (enabled ? colors.accent.blue : colors.text.secondary) : colors.text.dim,
              bgcolor: available ? (enabled ? alphaColor(colors.accent.blue, '28') : colors.bg.tertiary) : 'transparent',
            },
            '&.Mui-disabled': { opacity: 0.45 },
          }}
        >
          <PublicIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </span>
    </Tooltip>
  );
}
