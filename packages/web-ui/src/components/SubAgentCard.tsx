import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SearchIcon from '@mui/icons-material/Search';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TerminalIcon from '@mui/icons-material/Terminal';
import PsychologyIcon from '@mui/icons-material/Psychology';
import type { SubAgentActivity, SubAgentStep } from '../types';
import { palette } from '../theme';

interface SubAgentCardProps {
  agent: SubAgentActivity;
}

const stepIcons: Record<string, typeof DescriptionOutlinedIcon> = {
  read: DescriptionOutlinedIcon,
  search: SearchIcon,
  edit: EditNoteIcon,
  run: TerminalIcon,
  think: PsychologyIcon,
};

function StepLine({ step }: { step: SubAgentStep }) {
  const Icon = stepIcons[step.type] ?? DescriptionOutlinedIcon;
  const isRunning = step.status === 'running';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.4,
        pl: 2,
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '2px',
          bgcolor: palette.border.subtle,
        },
      }}
    >
      {isRunning ? (
        <CircularProgress size={12} thickness={5} sx={{ color: palette.accent.blue }} />
      ) : (
        <CheckCircleIcon sx={{ fontSize: 12, color: palette.text.dim }} />
      )}
      <Icon sx={{ fontSize: 13, color: palette.text.dim }} />
      <Typography
        sx={{
          flex: 1,
          fontSize: '0.72rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: isRunning ? palette.text.secondary : palette.text.tertiary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {step.label}
      </Typography>
      {step.detail && (
        <Typography
          component="span"
          sx={{
            fontSize: '0.62rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: palette.text.dim,
            bgcolor: palette.bg.elevated,
            px: 0.75,
            py: 0.2,
            borderRadius: 0.5,
            border: `1px solid ${palette.border.subtle}`,
          }}
        >
          {step.detail}
        </Typography>
      )}
    </Box>
  );
}

export function SubAgentCard({ agent }: SubAgentCardProps) {
  const [expanded, setExpanded] = useState(true);
  const isRunning = agent.status === 'running';
  const stepCount = agent.steps?.length ?? 0;

  return (
    <Box
      sx={{
        border: `1px solid ${isRunning ? palette.border.default : palette.border.subtle}`,
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: palette.bg.secondary,
        transition: 'border-color 0.3s',
      }}
    >
      {/* Header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 0.75,
          px: 1.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: palette.bg.elevated },
          transition: 'background-color 0.15s',
        }}
      >
        {isRunning ? (
          <CircularProgress size={14} thickness={5} sx={{ color: palette.accent.purple }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 14, color: palette.accent.green }} />
        )}
        <AccountTreeIcon sx={{ fontSize: 14, color: palette.accent.purple }} />
        <Typography
          sx={{
            flex: 1,
            fontSize: '0.75rem',
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            color: palette.text.secondary,
          }}
        >
          {agent.name}
        </Typography>

        {stepCount > 0 && (
          <Typography
            component="span"
            sx={{
              fontSize: '0.62rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: palette.text.dim,
            }}
          >
            {stepCount} step{stepCount > 1 ? 's' : ''}
          </Typography>
        )}

        {isRunning && (
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: palette.accent.purple,
              animation: 'pulse 1.5s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.3 },
              },
            }}
          />
        )}

        <IconButton size="small" sx={{ p: 0.25 }}>
          <ExpandMoreIcon
            sx={{
              fontSize: 14,
              color: palette.text.dim,
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </IconButton>
      </Box>

      {/* Steps */}
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1 }}>
          {agent.steps?.map((step, idx) => (
            <StepLine key={idx} step={step} />
          ))}

          {/* Processing indicator when running with no steps yet */}
          {isRunning && stepCount === 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: 2 }}>
              <CircularProgress size={12} thickness={5} sx={{ color: palette.accent.purple }} />
              <Typography sx={{ fontSize: '0.72rem', color: palette.text.dim, fontStyle: 'italic' }}>
                Processing...
              </Typography>
            </Box>
          )}

          {/* Summary when done */}
          {agent.summary && !isRunning && (
            <Box
              sx={{
                mt: 0.5,
                pt: 0.5,
                borderTop: `1px solid ${palette.border.subtle}`,
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.72rem',
                  color: palette.text.tertiary,
                  fontStyle: 'italic',
                  pl: 2,
                }}
              >
                {agent.summary}
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
