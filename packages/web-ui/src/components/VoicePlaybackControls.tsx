import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import StopIcon from '@mui/icons-material/Stop';
import ReplayIcon from '@mui/icons-material/Replay';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import { colors } from '../theme';

export interface VoicePlaybackControlsProps {
  visible: boolean;
  onStop: () => void;
  onReplay?: () => void;
  onTextOnly?: () => void;
}

export function VoicePlaybackControls({ visible, onStop, onReplay, onTextOnly }: VoicePlaybackControlsProps) {
  if (!visible) return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.75, px: 1.25, pb: 0.5, alignItems: 'center' }}>
      <Button size="small" startIcon={<StopIcon sx={{ fontSize: 14 }} />} onClick={onStop} sx={{ fontSize: '0.6rem', color: colors.accent.red }}>
        Stop playback
      </Button>
      {onReplay && (
        <Button size="small" startIcon={<ReplayIcon sx={{ fontSize: 14 }} />} onClick={onReplay} sx={{ fontSize: '0.6rem' }}>
          Replay
        </Button>
      )}
      {onTextOnly && (
        <Button size="small" startIcon={<TextFieldsIcon sx={{ fontSize: 14 }} />} onClick={onTextOnly} sx={{ fontSize: '0.6rem' }}>
          Text only
        </Button>
      )}
    </Box>
  );
}
