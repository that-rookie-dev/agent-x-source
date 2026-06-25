
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined';
import ThumbDownAltOutlinedIcon from '@mui/icons-material/ThumbDownAltOutlined';
import type { TurnFeedbackRating } from '@agentx/shared/browser';
import { colors } from '../theme';

interface TurnFeedbackBarProps {
  onRate: (rating: TurnFeedbackRating) => void;
  disabled?: boolean;
}

export function TurnFeedbackBar({ onRate, disabled }: TurnFeedbackBarProps) {
  return (
    <Box
      sx={{
        mt: 1,
        px: 1,
        py: 0.75,
        borderRadius: 1,
        border: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
      }}
    >
      <Typography sx={{ fontSize: '0.6rem', color: colors.text.secondary, mr: 0.25 }}>
        Did this response meet your expectations?
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
        <Tooltip title="Yes, helpful">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              onClick={() => onRate('positive')}
              aria-label="Thumbs up"
              sx={{ color: colors.accent.green, p: 0.4 }}
            >
              <ThumbUpAltOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="No, needs improvement">
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              onClick={() => onRate('negative')}
              aria-label="Thumbs down"
              sx={{ color: colors.accent.red, p: 0.4 }}
            >
              <ThumbDownAltOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          component="button"
          type="button"
          disabled={disabled}
          onClick={() => onRate('skipped')}
          sx={{
            border: 'none',
            background: 'none',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '0.55rem',
            color: colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
            px: 0.75,
            py: 0.25,
            opacity: disabled ? 0.4 : 0.75,
            '&:hover': disabled ? {} : { opacity: 1, color: colors.text.secondary },
          }}
        >
          Skip for now
        </Typography>
      </Box>
    </Box>
  );
}
