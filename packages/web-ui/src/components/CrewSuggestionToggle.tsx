import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import GroupsIcon from '@mui/icons-material/Groups';
import { colors, alphaColor } from '../theme';

const STORAGE_KEY = 'agentx-crew-suggestion-requested';

export function readCrewSuggestionRequestedPreference(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCrewSuggestionRequestedPreference(enabled: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

interface CrewSuggestionToggleProps {
  available: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function CrewSuggestionToggle({ available, enabled, onToggle }: CrewSuggestionToggleProps) {
  const tooltip = available
    ? (enabled
      ? 'Crew suggestion on — every message asks for specialist recommendations'
      : 'Suggest a crew — force crew suggestion evaluation on each message')
    : 'Crew Hub catalog unavailable — enable in Settings → Crews';

  return (
    <Tooltip title={tooltip} arrow>
      <span>
        <IconButton
          size="small"
          disabled={!available}
          onClick={() => onToggle(!enabled)}
          aria-label="Toggle crew suggestion"
          aria-pressed={enabled}
          sx={{
            p: 0.25,
            width: 22,
            height: 22,
            borderRadius: '50%',
            color: enabled ? colors.accent.purple : colors.text.dim,
            bgcolor: enabled ? alphaColor(colors.accent.purple, '18') : 'transparent',
            border: `1px solid ${enabled ? alphaColor(colors.accent.purple, '40') : 'transparent'}`,
            '&:hover': {
              color: available ? (enabled ? colors.accent.purple : colors.text.secondary) : colors.text.dim,
              bgcolor: available ? (enabled ? alphaColor(colors.accent.purple, '28') : colors.bg.tertiary) : 'transparent',
            },
            '&.Mui-disabled': { opacity: 0.45 },
          }}
        >
          <GroupsIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </span>
    </Tooltip>
  );
}
