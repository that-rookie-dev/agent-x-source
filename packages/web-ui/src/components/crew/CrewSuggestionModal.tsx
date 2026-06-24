import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import type { CrewMatchCandidate, CrewSuggestionEvaluation } from '@agentx/shared/browser';
import { crewTheme, crewDialogPaperSx } from '../../styles/crew-theme';
import { MedicalDisclaimerStripe } from './MedicalDisclaimerBanner';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';

export interface CrewSuggestionModalProps {
  open: boolean;
  evaluation: CrewSuggestionEvaluation | null;
  planMode?: boolean;
  onDeploy: (selected: CrewMatchCandidate[], dismissForSession: boolean) => void;
  onSkip: (dismissForSession: boolean) => void;
  onClose: () => void;
  onViewDossier?: (candidate: CrewMatchCandidate) => void;
  onReenableSuggestions?: () => void;
}

function originLabel(origin: CrewMatchCandidate['origin']): string {
  if (origin === 'custom') return 'CLASSIFIED · CUSTOM';
  if (origin === 'hub_roster') return 'ROSTER · ACTIVE';
  return 'HUB · RECRUIT';
}

function rankAccent(rank: number): string {
  if (rank === 1) return crewTheme.text.primary;
  if (rank === 2) return crewTheme.text.secondary;
  return crewTheme.text.dim;
}

function RecruitCard({
  candidate,
  rank,
  selected,
  onToggle,
  onViewDossier,
  isMedical,
}: {
  candidate: CrewMatchCandidate;
  rank: number;
  selected: boolean;
  onToggle: () => void;
  onViewDossier?: () => void;
  isMedical: boolean;
}) {
  const pct = Math.round(candidate.matchScore * 100);
  const topReason = candidate.reasons[0];

  return (
    <Box
      onClick={onToggle}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 196,
        border: `1px solid ${selected ? crewTheme.accent.tactical : crewTheme.border.default}`,
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: selected ? 'rgba(255,255,255,0.04)' : crewTheme.bg.card,
        transition: 'border-color 0.15s, background-color 0.15s',
        '&:hover': { borderColor: crewTheme.border.strong, bgcolor: crewTheme.bg.cardHover },
      }}
    >
      {isMedical && <MedicalDisclaimerStripe height={3} />}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: 1.35, position: 'relative', minHeight: 0 }}>
        <Box sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: rank === 1 ? '0.82rem' : '0.68rem',
          fontWeight: rank <= 2 ? 700 : 500,
          color: rankAccent(rank),
          opacity: rank === 1 ? 0.9 : 0.55,
          lineHeight: 1,
          letterSpacing: '-0.5px',
        }}>
          {String(rank).padStart(2, '0')}
        </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', mb: 0.5, minHeight: 22 }}>
        <Checkbox
          size="small"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggle}
          sx={{ p: 0.25, mt: -0.25, color: crewTheme.text.dim, '&.Mui-checked': { color: crewTheme.accent.tactical } }}
        />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, pl: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.45, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={originLabel(candidate.origin)}
            sx={{
              height: 18,
              fontSize: '0.48rem',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.4px',
              bgcolor: 'transparent',
              border: `1px solid ${crewTheme.border.default}`,
              color: crewTheme.text.dim,
            }}
          />
          {candidate.onRoster && (
            <Chip
              size="small"
              label="ON ROSTER"
              sx={{
                height: 18,
                fontSize: '0.48rem',
                fontFamily: "'JetBrains Mono', monospace",
                bgcolor: 'transparent',
                border: `1px solid ${crewTheme.border.subtle}`,
                color: crewTheme.text.dim,
              }}
            />
          )}
        </Box>

        <Typography sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.74rem',
          fontWeight: 700,
          color: crewTheme.text.primary,
          lineHeight: 1.25,
          mb: 0.25,
        }}>
          {candidate.name}
        </Typography>

        <Typography sx={{
          fontSize: '0.6rem',
          color: crewTheme.text.secondary,
          lineHeight: 1.35,
          mb: 0.5,
        }}>
          {candidate.title}
          {candidate.categoryLabel ? ` · ${candidate.categoryLabel}` : ''}
        </Typography>

        {candidate.description && (
          <Typography sx={{
            fontSize: '0.58rem',
            color: crewTheme.text.dim,
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 0.6,
          }}>
            {candidate.description}
          </Typography>
        )}

        {topReason && (
          <Typography sx={{
            fontSize: '0.55rem',
            color: crewTheme.text.secondary,
            fontStyle: 'italic',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 0.65,
          }}>
            {topReason}
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.35, mb: 0.75 }}>
          {candidate.expertise.slice(0, 4).map((e) => (
            <Chip key={e} label={e} size="small" sx={{
              height: 18,
              fontSize: '0.5rem',
              bgcolor: crewTheme.bg.void,
              color: crewTheme.text.dim,
              border: `1px solid ${crewTheme.border.subtle}`,
            }} />
          ))}
        </Box>
      </Box>

      <Box sx={{ mt: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.52rem',
            color: crewTheme.text.dim,
            letterSpacing: '0.5px',
          }}>
            {pct}% FIT
          </Typography>
          {onViewDossier && (
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => { e.stopPropagation(); onViewDossier(); }}
              sx={{
                minWidth: 0,
                py: 0.15,
                px: 0.85,
                fontSize: '0.52rem',
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: 'none',
                letterSpacing: '0.3px',
                color: crewTheme.text.secondary,
                borderColor: crewTheme.border.default,
                '&:hover': { borderColor: crewTheme.border.strong, bgcolor: crewTheme.bg.void },
              }}
            >
              View details
            </Button>
          )}
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{
            height: 3,
            borderRadius: 2,
            bgcolor: crewTheme.bg.void,
            '& .MuiLinearProgress-bar': { bgcolor: rank === 1 ? crewTheme.accent.tactical : crewTheme.text.dim },
          }}
        />
      </Box>
      </Box>
      {isMedical && <MedicalDisclaimerStripe height={3} />}
    </Box>
  );
}

export default function CrewSuggestionModal({
  open,
  evaluation,
  planMode = false,
  onDeploy,
  onSkip,
  onClose,
  onViewDossier,
  onReenableSuggestions,
}: CrewSuggestionModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissSession, setDismissSession] = useState(false);

  const candidates = evaluation?.candidates ?? [];

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeploy = () => {
    const picked = candidates.filter((c) => selected.has(c.id));
    onDeploy(picked, dismissSession);
    setSelected(new Set());
    setDismissSession(false);
  };

  const handleSkip = () => {
    onSkip(dismissSession);
    setSelected(new Set());
    setDismissSession(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          ...crewDialogPaperSx,
          width: 'min(1080px, 94vw)',
          maxHeight: '88vh',
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5, borderBottom: `1px solid ${crewTheme.border.subtle}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.58rem',
              letterSpacing: '2px',
              color: crewTheme.text.secondary,
              mb: 0.5,
            }}>
              PERSONNEL ACQUISITION · SUGGESTED
            </Typography>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.85rem',
              fontWeight: 700,
              color: crewTheme.text.primary,
            }}>
              Specialist match detected
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: crewTheme.text.dim }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important', pb: 1 }}>
        {planMode && (
          <Alert severity="info" sx={{ mb: 1.25, fontSize: '0.62rem', py: 0.25 }}>
            Plan mode: crew will research and contribute domain-specific markdown plans in chat. Read-only — no file writes or edits.
          </Alert>
        )}
        {evaluation?.dismissed && evaluation.shouldSuggest && (
          <Alert severity="success" sx={{ mb: 1.25, fontSize: '0.62rem', py: 0.25 }}>
            Session suggestions were re-enabled because you explicitly requested crew help.
          </Alert>
        )}
        <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary, mb: 1.25, lineHeight: 1.5 }}>
          These operatives match your task. Select one or more to deploy for this mission, or continue with Agent-X only.
        </Typography>
        {evaluation?.taskSummary && (
          <Box sx={{
            mb: 1.5,
            p: 1,
            borderRadius: '4px',
            border: `1px dashed ${crewTheme.border.default}`,
            bgcolor: crewTheme.bg.void,
          }}>
            <Typography sx={{ fontSize: '0.58rem', color: crewTheme.text.dim, mb: 0.35 }}>TASK BRIEF</Typography>
            <Typography sx={{ fontSize: '0.62rem', color: crewTheme.text.secondary, fontStyle: 'italic' }}>
              {evaluation.taskSummary}
            </Typography>
          </Box>
        )}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 1.25,
          mb: 1.25,
        }}>
          {candidates.map((c, i) => (
            <RecruitCard
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
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={dismissSession}
              onChange={(e) => setDismissSession(e.target.checked)}
              sx={{ '&.Mui-checked': { color: crewTheme.accent.tactical } }}
            />
          }
          label={
            <Typography sx={{ fontSize: '0.58rem', color: crewTheme.text.dim }}>
              Don't suggest crew again this session
            </Typography>
          }
        />
        {onReenableSuggestions && (
          <Button
            size="small"
            onClick={onReenableSuggestions}
            sx={{ display: 'block', mt: 0.5, p: 0, minWidth: 0, fontSize: '0.55rem', color: crewTheme.text.secondary, textTransform: 'none' }}
          >
            Re-enable crew suggestions this session
          </Button>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, gap: 1, borderTop: `1px solid ${crewTheme.border.subtle}` }}>
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
          onClick={handleDeploy}
          sx={{
            fontSize: '0.62rem',
            textTransform: 'none',
            bgcolor: crewTheme.text.primary,
            color: crewTheme.bg.void,
            '&:hover': { bgcolor: '#e0e0e0' },
            '&.Mui-disabled': { opacity: 0.4 },
          }}
        >
          Deploy selected ({selected.size})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
