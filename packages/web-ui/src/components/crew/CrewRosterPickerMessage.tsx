import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import GroupsIcon from '@mui/icons-material/Groups';
import type { CrewMatchCandidate, CrewSuggestionEvaluation } from '@agentx/shared/browser';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';
import { crewTheme } from '../../styles/crew-theme';
import { colors, alphaColor } from '../../theme';
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
  onSubmit?: (selected: CrewMatchCandidate[]) => void;
  onSkip?: (dismissForSession?: boolean) => void;
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
      bgcolor: selected ? alphaColor(colors.ink, 0.04) : 'transparent',
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
  onSubmit,
  onSkip,
  onViewDossier,
}: CrewRosterPickerMessageProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissSession, setDismissSession] = useState(false);
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
    onSkip?.(dismissSession);
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
      borderRadius: 1,
      overflow: 'hidden',
      border: `1px solid ${crewTheme.border.default}`,
      bgcolor: crewTheme.bg.inset,
    }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.625,
        px: 1,
        py: 0.75,
        borderBottom: `1px solid ${crewTheme.border.subtle}`,
      }}>
        <Typography sx={{
          fontSize: '0.65rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: crewTheme.accent.tactical,
          lineHeight: 1,
        }}>
          ◌
        </Typography>
        <GroupsIcon sx={{ fontSize: 13, color: crewTheme.accent.tactical }} />
        <Typography sx={{
          fontSize: '0.6rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
          color: crewTheme.text.primary,
          flexShrink: 0,
        }}>
          Crew match
        </Typography>
        <Typography sx={{
          fontSize: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: crewTheme.text.dim,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}>
          {record.evaluation.taskSummary || 'Specialists matched for this request'}
        </Typography>
      </Box>

      <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
        <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary, lineHeight: 1.5 }}>
          Select specialists to add to this session, or continue with Agent-X only.
        </Typography>
      </Box>

      <Box sx={{
        display: 'flex',
        gap: 1,
        px: 1.25,
        pb: 1.25,
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        '&::-webkit-scrollbar': { height: 6 },
        '&::-webkit-scrollbar-thumb': { bgcolor: crewTheme.border.default, borderRadius: 3 },
      }}>
        {candidates.map((c, i) => (
          <Box key={c.id} sx={{ minWidth: 248, maxWidth: 272, flexShrink: 0, scrollSnapAlign: 'start' }}>
            <CrewRecruitCard
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
          </Box>
        ))}
      </Box>

      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1.25,
        py: 1,
        borderTop: `1px solid ${crewTheme.border.subtle}`,
      }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={dismissSession}
              onChange={(e) => setDismissSession(e.target.checked)}
              sx={{ '&.Mui-checked': { color: crewTheme.accent.tactical } }}
            />
          }
          label={(
            <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim }}>
              Don&apos;t suggest crew again this session
            </Typography>
          )}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
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
              '&:hover': { bgcolor: alphaColor(crewTheme.text.primary, 0.85) },
              '&.Mui-disabled': { opacity: 0.4 },
            }}
          >
            Add selected ({selected.size})
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
