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
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CloseIcon from '@mui/icons-material/Close';
import type { CrewMatchCandidate, CrewSuggestionEvaluation } from '@agentx/shared/browser';
import { crewTheme, crewDialogPaperSx } from '../../styles/crew-theme';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';
import { CrewRecruitCard } from './CrewRecruitCard';

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
