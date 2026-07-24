import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import type { TodoItem } from '../../api';
import { colors, alphaColor } from '../../theme';

export type TodoDisposition = 'continue' | 'skip' | 'defer';

interface Props {
  todos: TodoItem[];
  onChoose: (disposition: TodoDisposition) => void;
  onCancel: () => void;
}

/** Pre-send gate when leftover incomplete TASKS exist — mirrors questionnaire / permission cards. */
export const PendingTodosBanner = memo(function PendingTodosBanner({ todos, onChoose, onCancel }: Props) {
  const incomplete = todos.filter((t) => t.status === 'not-started' || t.status === 'in-progress');
  const preview = incomplete.slice(0, 4);

  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${alphaColor(colors.accent.orange, '40')}`,
        bgcolor: colors.bg.secondary,
        animation: 'agentx-fadeIn 0.2s ease-out',
      }}
    >
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: colors.accent.orange, mb: 0.35 }}>
        Incomplete checklist ({incomplete.length})
      </Typography>
      <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary, mb: 0.75, lineHeight: 1.45 }}>
        This session still has open TASKS from a previous turn. How should Agent-X treat them before your new message?
      </Typography>

      <Box
        component="ul"
        sx={{ m: 0, pl: 1.75, mb: 0.85, display: 'flex', flexDirection: 'column', gap: 0.2 }}
      >
        {preview.map((t) => (
          <Typography
            key={t.id}
            component="li"
            sx={{
              fontSize: '0.5rem',
              color: colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.4,
            }}
          >
            {t.status === 'in-progress' ? '[~]' : '[ ]'} #{t.id} {t.title}
          </Typography>
        ))}
        {incomplete.length > preview.length && (
          <Typography component="li" sx={{ fontSize: '0.48rem', color: colors.text.dim }}>
            +{incomplete.length - preview.length} more…
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label="Continue checklist"
          onClick={() => onChoose('continue')}
          sx={{
            cursor: 'pointer', height: 22, fontSize: '0.5rem', fontWeight: 600,
            bgcolor: alphaColor(colors.accent.green, '16'), color: colors.accent.green,
            '&:hover': { bgcolor: alphaColor(colors.accent.green, '28') },
          }}
        />
        <Chip
          size="small"
          label="New task only — clear list"
          onClick={() => onChoose('skip')}
          sx={{
            cursor: 'pointer', height: 22, fontSize: '0.5rem', fontWeight: 600,
            bgcolor: alphaColor(colors.accent.blue, '16'), color: colors.accent.blue,
            '&:hover': { bgcolor: alphaColor(colors.accent.blue, '28') },
          }}
        />
        <Chip
          size="small"
          label="New task — keep list for later"
          onClick={() => onChoose('defer')}
          sx={{
            cursor: 'pointer', height: 22, fontSize: '0.5rem', fontWeight: 600,
            bgcolor: alphaColor(colors.accent.cyan, '16'), color: colors.accent.cyan,
            '&:hover': { bgcolor: alphaColor(colors.accent.cyan, '28') },
          }}
        />
        <Chip
          size="small"
          label="Cancel"
          onClick={onCancel}
          sx={{
            cursor: 'pointer', height: 22, fontSize: '0.5rem',
            bgcolor: alphaColor(colors.accent.red, '12'), color: colors.accent.red,
            '&:hover': { bgcolor: alphaColor(colors.accent.red, '22') },
          }}
        />
      </Box>
    </Box>
  );
});
