import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { CrewMatchCandidate, CrewSuggestionEvaluation } from '@agentx/shared/browser';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';
import { crewTheme } from '../../styles/crew-theme';
import { CrewRecruitCard } from './CrewRecruitCard';

export interface CrewRosterPickerRecord {
  id: string;
  status: 'pending' | 'answered' | 'skipped';
  evaluation: CrewSuggestionEvaluation;
  pendingUserText: string;
  selectedCandidateIds?: string[];
}

export interface CrewRosterPickerMessageProps {
  record: CrewRosterPickerRecord;
  planMode?: boolean;
  onSubmit?: (selected: CrewMatchCandidate[]) => void;
  onSkip?: () => void;
  onViewDossier?: (candidate: CrewMatchCandidate) => void;
}

export function CrewRosterPickerMessage({
  record,
  planMode = false,
  onSubmit,
  onSkip,
  onViewDossier,
}: CrewRosterPickerMessageProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const candidates = record.evaluation.candidates.slice(0, 5);
  const readonly = record.status !== 'pending';

  const toggle = (id: string) => {
    if (readonly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (readonly) {
    const picked = candidates.filter((c) => record.selectedCandidateIds?.includes(c.id));
    return (
      <Box sx={{
        border: `1px solid ${crewTheme.border.subtle}`,
        borderRadius: '8px',
        bgcolor: crewTheme.bg.void,
        p: 1.25,
      }}>
        <Typography sx={{ fontSize: '0.58rem', color: crewTheme.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px', mb: 0.5 }}>
          CREW ROSTER · {record.status === 'skipped' ? 'CONTINUED WITH AGENT-X' : 'DEPLOYED'}
        </Typography>
        {record.status === 'answered' && picked.length > 0 ? (
          <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary }}>
            Selected: {picked.map((c) => `@${c.callsign}`).join(', ')}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary }}>
            No crew selected — Agent-X handled this turn.
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{
      border: `1px solid ${crewTheme.border.default}`,
      borderRadius: '8px',
      bgcolor: crewTheme.bg.card,
      overflow: 'hidden',
    }}>
      <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, borderBottom: `1px solid ${crewTheme.border.subtle}` }}>
        <Typography sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.58rem',
          letterSpacing: '2px',
          color: crewTheme.text.secondary,
          mb: 0.35,
        }}>
          PERSONNEL ACQUISITION · IN CHAT
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary, lineHeight: 1.5 }}>
          These operatives match your request. Select one or more to add to this session, or continue with Agent-X only.
        </Typography>
        {planMode && (
          <Typography sx={{ fontSize: '0.58rem', color: crewTheme.text.dim, mt: 0.5 }}>
            Plan mode: crew will contribute domain plans in chat (read-only).
          </Typography>
        )}
        {record.evaluation.taskSummary && (
          <Box sx={{ mt: 1, p: 0.85, borderRadius: '4px', border: `1px dashed ${crewTheme.border.default}`, bgcolor: crewTheme.bg.void }}>
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.25 }}>TASK BRIEF</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: crewTheme.text.secondary, fontStyle: 'italic' }}>
              {record.evaluation.taskSummary}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 1.25,
        p: 1.25,
      }}>
        {candidates.map((c, i) => (
          <CrewRecruitCard
            key={c.id}
            candidate={c}
            rank={i + 1}
            selected={selected.has(c.id)}
            onToggle={() => toggle(c.id)}
            onViewDossier={onViewDossier ? () => onViewDossier(c) : undefined}
            isMedical={crewRequiresMedicalDisclaimer({
              categoryId: c.categoryId,
              requiresMedicalDisclaimer: c.requiresMedicalDisclaimer,
              catalogId: c.catalogId ?? c.id,
            })}
          />
        ))}
      </Box>

      <Box sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 1,
        px: 1.5,
        py: 1.25,
        borderTop: `1px solid ${crewTheme.border.subtle}`,
      }}>
        <Button
          size="small"
          onClick={onSkip}
          sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary, textTransform: 'none' }}
        >
          Continue with Agent-X
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={selected.size === 0}
          onClick={() => onSubmit?.(candidates.filter((c) => selected.has(c.id)))}
          sx={{
            fontSize: '0.62rem',
            textTransform: 'none',
            bgcolor: crewTheme.text.primary,
            color: crewTheme.bg.void,
            '&:hover': { bgcolor: '#e0e0e0' },
            '&.Mui-disabled': { opacity: 0.4 },
          }}
        >
          Add selected ({selected.size})
        </Button>
      </Box>
    </Box>
  );
}
