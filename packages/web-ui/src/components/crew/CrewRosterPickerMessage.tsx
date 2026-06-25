import { useEffect, useState } from 'react';
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

function CompactCrewRow({
  candidate,
  selected,
  dimmed,
}: {
  candidate: CrewMatchCandidate;
  selected?: boolean;
  dimmed?: boolean;
}) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.75,
      py: 0.45,
      px: 0.65,
      borderRadius: '4px',
      bgcolor: selected ? 'rgba(255,255,255,0.04)' : 'transparent',
      opacity: dimmed ? 0.42 : 0.9,
      border: selected ? `1px solid ${crewTheme.border.default}` : '1px solid transparent',
    }}>
      {selected && (
        <Typography sx={{ fontSize: '0.55rem', color: crewTheme.accent.tactical, lineHeight: 1 }}>✓</Typography>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.primary, fontWeight: 600, lineHeight: 1.3 }}>
          {candidate.name}
        </Typography>
        <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, lineHeight: 1.3 }}>
          {candidate.title} · @{candidate.callsign}
        </Typography>
      </Box>
    </Box>
  );
}

function ResolvedCrewRosterPicker({
  record,
  status,
  selectedCandidateIds,
}: {
  record: CrewRosterPickerRecord;
  status: 'answered' | 'skipped';
  selectedCandidateIds?: string[];
}) {
  const candidates = record.evaluation.candidates.slice(0, 5);
  const picked = candidates.filter((c) => selectedCandidateIds?.includes(c.id));
  const skipped = status === 'skipped';

  return (
    <Box sx={{
      border: `1px solid ${crewTheme.border.subtle}`,
      borderRadius: '8px',
      bgcolor: crewTheme.bg.void,
      p: 1.1,
      opacity: 0.88,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <Typography sx={{
        fontSize: '0.58rem',
        color: crewTheme.text.dim,
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '1px',
        mb: 0.65,
      }}>
        CREW ROSTER · {skipped ? 'CONTINUED WITH AGENT-X' : 'DEPLOYED'}
      </Typography>

      {skipped ? (
        <>
          <Typography sx={{ fontSize: '0.6rem', color: crewTheme.text.secondary, mb: 0.75, lineHeight: 1.45 }}>
            Agent-X is handling this request. Suggested specialists were not added to the session.
          </Typography>
          {candidates.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
              {candidates.map((c) => (
                <CompactCrewRow key={c.id} candidate={c} dimmed />
              ))}
            </Box>
          )}
        </>
      ) : picked.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
          {picked.map((c) => (
            <CompactCrewRow key={c.id} candidate={c} selected />
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary }}>
          No crew selected — Agent-X handled this turn.
        </Typography>
      )}
    </Box>
  );
}

export function CrewRosterPickerMessage({
  record,
  planMode = false,
  onSubmit,
  onSkip,
  onViewDossier,
}: CrewRosterPickerMessageProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localResolved, setLocalResolved] = useState<{
    status: 'answered' | 'skipped';
    selectedCandidateIds?: string[];
  } | null>(null);

  const candidates = record.evaluation.candidates.slice(0, 5);
  const effectiveStatus = localResolved?.status ?? record.status;
  const effectiveSelectedIds = localResolved?.selectedCandidateIds ?? record.selectedCandidateIds;
  const readonly = effectiveStatus !== 'pending';

  useEffect(() => {
    if (record.status !== 'pending') setLocalResolved(null);
  }, [record.status]);

  const toggle = (id: string) => {
    if (readonly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    const picked = candidates.filter((c) => selected.has(c.id));
    if (picked.length === 0) return;
    const ids = picked.map((c) => c.id);
    setLocalResolved({ status: 'answered', selectedCandidateIds: ids });
    onSubmit?.(picked);
  };

  const handleSkip = () => {
    setLocalResolved({ status: 'skipped' });
    onSkip?.();
  };

  if (readonly) {
    return (
      <ResolvedCrewRosterPicker
        record={record}
        status={effectiveStatus as 'answered' | 'skipped'}
        selectedCandidateIds={effectiveSelectedIds}
      />
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
          onClick={handleSkip}
          sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary, textTransform: 'none' }}
        >
          Continue with Agent-X
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={selected.size === 0}
          onClick={handleSubmit}
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
