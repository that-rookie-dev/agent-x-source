import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import { colors } from '../theme';

export interface VoiceControlProps {
  enabled: boolean;
  blocked?: boolean;
  active?: boolean;
  duplex?: boolean;
  disabledReason?: string;
  onPressStart: () => void;
  onPressEnd: () => void;
  onBlockedClick?: () => void;
}

export function VoiceControl({
  enabled,
  blocked = false,
  active = false,
  duplex = false,
  disabledReason,
  onPressStart,
  onPressEnd,
  onBlockedClick,
}: VoiceControlProps) {
  if (!enabled) return null;

  const title = blocked
    ? 'Microphone blocked — click to fix'
    : active
      ? duplex ? 'Stop voice session (Esc)' : 'Release to send'
      : disabledReason || (duplex ? 'Start voice session (⌘⇧M)' : 'Hold to talk (Space when composer empty)');

  const handlePrimary = () => {
    if (blocked) {
      onBlockedClick?.();
      return;
    }
    if (duplex) {
      if (active) onPressEnd();
      else onPressStart();
      return;
    }
    onPressStart();
  };

  return (
    <Tooltip title={title} arrow>
      <span>
        <IconButton
          size="small"
          aria-pressed={duplex ? active : active}
          aria-label={blocked ? 'Microphone blocked' : duplex ? 'Toggle voice session' : 'Push to talk'}
          disabled={Boolean(disabledReason) && !blocked}
          onMouseDown={(e) => { if (!duplex) e.preventDefault(); if (!duplex && !blocked) handlePrimary(); }}
          onMouseUp={() => { if (!duplex && !blocked && active) onPressEnd(); }}
          onMouseLeave={() => { if (!duplex && active && !blocked) onPressEnd(); }}
          onTouchStart={(e) => { if (!duplex) e.preventDefault(); if (!duplex && !blocked) handlePrimary(); }}
          onTouchEnd={() => { if (!duplex && !blocked && active) onPressEnd(); }}
          onClick={() => { if (duplex || blocked) handlePrimary(); }}
          sx={{
            color: active ? colors.accent.red : blocked ? colors.accent.orange : colors.text.dim,
            p: 0.5,
            '&.Mui-disabled': { color: colors.text.dim },
          }}
        >
          {blocked ? <MicOffIcon sx={{ fontSize: 20 }} /> : <MicIcon sx={{ fontSize: 20 }} />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
