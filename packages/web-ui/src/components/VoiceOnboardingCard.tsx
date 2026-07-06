import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { VOICE_ONBOARDING_KEY } from '../voice/constants';

export function isVoiceOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(VOICE_ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissVoiceOnboarding(): void {
  try {
    localStorage.setItem(VOICE_ONBOARDING_KEY, '1');
  } catch {
    // ignore
  }
}

export interface VoiceOnboardingCardProps {
  onEnableMic: () => void;
  onDismiss: () => void;
}

export function VoiceOnboardingCard({ onEnableMic, onDismiss }: VoiceOnboardingCardProps) {
  return (
    <Alert severity="info" sx={{ mx: 1.25, mb: 1, bgcolor: colors.bg.tertiary, color: colors.text.secondary }}>
      <Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, mb: 0.5 }}>Talk to Agent-X locally</Typography>
        <Typography sx={{ fontSize: '0.65rem', mb: 1 }}>
          Voice stays on your machine. The mic is active only while you talk. During long tasks, Agent-X may speak short progress updates.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="contained" onClick={onEnableMic}>Enable microphone</Button>
          <Button size="small" onClick={() => { dismissVoiceOnboarding(); onDismiss(); }}>Keep text only</Button>
        </Box>
      </Box>
    </Alert>
  );
}
