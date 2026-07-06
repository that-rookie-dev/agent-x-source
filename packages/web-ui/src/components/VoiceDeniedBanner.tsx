import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';

export interface VoiceDeniedBannerProps {
  instructions: string[];
  onTryAgain: () => void;
  onOpenSettings?: () => void;
  onUseText: () => void;
}

export function VoiceDeniedBanner({ instructions, onTryAgain, onOpenSettings, onUseText }: VoiceDeniedBannerProps) {
  return (
    <Alert severity="warning" sx={{ mx: 1.25, mb: 1, bgcolor: colors.bg.tertiary }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, mb: 0.5 }}>
        Microphone access is blocked. Agent-X can&apos;t listen until you allow microphone access.
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2, mb: 1 }}>
        {instructions.map((line) => (
          <Typography key={line} component="li" sx={{ fontSize: '0.65rem', color: colors.text.secondary }}>
            {line}
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="contained" onClick={onTryAgain}>Try again</Button>
        {onOpenSettings && (
          <Button size="small" onClick={onOpenSettings}>Open settings</Button>
        )}
        <Button size="small" onClick={onUseText}>Use text instead</Button>
      </Box>
    </Alert>
  );
}
